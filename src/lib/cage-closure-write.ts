import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { validateProjectedSexComposition, validateQuarantineAssignments } from "@/lib/cage-assignment-rules";
import { getCageCapacityState } from "@/lib/cage-capacity";
import { endActiveCageResponsibilities } from "@/lib/cage-responsibility-write";
import { canonicalJsonHash, executeIdempotentCommand } from "@/lib/command-foundation";
import { moveAnimalToCage, reconcileBreedingCageStatuses } from "@/lib/colony-write";
import { canManageLab, getActorLabAccess } from "@/lib/lab-access";
import type { ResolvedActor } from "@/lib/session";

const OPEN_QUARANTINE_STATUSES = ["admitted", "under_observation", "exception_open", "release_requested"] as const;

export type CageClosureAssignment = {
  animalId: string;
  toCageId: string;
};

export type CloseCageCommand = {
  cageId: string;
  labId: string;
  closedAt: string;
  reason: string;
  expectedChargePeriodId: string;
  expectedChargeCategoryId: string;
  expectedChargePeriodStartedAt: string;
  expectedDailyRateCents: number;
  expectedCurrencyCode: string;
  assignments: CageClosureAssignment[];
};

function parseCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function latestDate(values: Array<Date | null | undefined>) {
  return values
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}

export function hasOverlappingChargePeriods(
  periods: Array<{ id: string; startedAt: Date; endedAt: Date | null }>,
) {
  return periods.some((left, index) => periods.slice(index + 1).some((right) => {
    const leftEnd = left.endedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightEnd = right.endedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return left.startedAt.getTime() < rightEnd && right.startedAt.getTime() < leftEnd;
  }));
}

function validateAssignments(
  occupants: Array<{ id: string; animalId: string }>,
  assignments: CageClosureAssignment[],
) {
  const assignmentByAnimalId = new Map<string, string>();

  for (const assignment of assignments) {
    if (!assignment.animalId.trim() || !assignment.toCageId.trim() || assignmentByAnimalId.has(assignment.animalId)) {
      return { ok: false as const, message: "Assign every current occupant exactly once before reviewing closure." };
    }
    assignmentByAnimalId.set(assignment.animalId, assignment.toCageId);
  }

  const missing = occupants.filter((animal) => !assignmentByAnimalId.has(animal.id));
  if (assignmentByAnimalId.size !== occupants.length || missing.length) {
    return {
      ok: false as const,
      message: missing.length
        ? `Move all live occupants before closure. Missing: ${missing.map((animal) => animal.animalId).join(", ")}.`
        : "The closure plan includes an animal that is no longer assigned to this cage. Refresh and review it again.",
    };
  }

  return { ok: true as const, assignmentByAnimalId };
}

async function performCageClosure(input: {
  tx: Prisma.TransactionClient;
  actor: ResolvedActor;
  command: CloseCageCommand;
  expectedVersion: number;
  reviewSnapshotId: string;
  receiptId: string;
}) {
  const reason = input.command.reason.trim();
  const closedAt = parseCalendarDate(input.command.closedAt);
  if (!closedAt || reason.length < 3 || reason.length > 500) {
    return { ok: false as const, code: "validation_error", message: "Choose a valid closure date and enter a concise reason." };
  }
  const today = new Date(process.env.COLONY_REFERENCE_DATE ?? Date.now());
  if (dateKey(closedAt) > dateKey(today)) {
    return { ok: false as const, code: "validation_error", message: "Cage closure cannot be dated in the future." };
  }

  const cageIdsToLock = [
    input.command.cageId,
    ...input.command.assignments.map((assignment) => assignment.toCageId),
  ].filter((cageId, index, cageIds) => cageIds.indexOf(cageId) === index).sort();
  await input.tx.$queryRaw(Prisma.sql`
    SELECT id FROM "Cage"
    WHERE id IN (${Prisma.join(cageIdsToLock)})
    ORDER BY id
    FOR UPDATE
  `);

  const cage = await input.tx.cage.findUnique({
    where: { id: input.command.cageId },
    include: {
      closure: { select: { id: true, closedAt: true } },
      quarantineCases: {
        where: { status: { in: [...OPEN_QUARANTINE_STATUSES] } },
        take: 1,
        select: { id: true },
      },
      animals: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          animalId: true,
          sex: true,
          dob: true,
          outcomeStatus: true,
          currentCageId: true,
          animalMovements: { orderBy: [{ movedAt: "desc" }, { id: "desc" }], take: 1, select: { movedAt: true } },
          breedingAdults: {
            where: { breedingSetup: { status: { in: ["planned", "active", "paused"] } } },
            select: { id: true },
          },
        },
      },
      cageMovements: { orderBy: [{ movedAt: "desc" }, { id: "desc" }], take: 1, select: { movedAt: true } },
      labTransfers: { orderBy: [{ movedAt: "desc" }, { id: "desc" }], take: 1, select: { movedAt: true } },
      chargePeriods: {
        orderBy: [{ startedAt: "asc" }, { id: "asc" }],
        include: {
          invoiceLines: {
            where: { invoice: { status: { in: ["draft", "finalized"] } } },
            select: {
              serviceEnd: true,
              invoice: { select: { invoiceNumber: true, status: true } },
            },
          },
        },
      },
    },
  });
  const access = await getActorLabAccess(input.actor, input.tx);
  if (!cage || !canManageLab(access, cage.labId)) {
    return { ok: false as const, code: "not_found", message: "Cage not found." };
  }
  if (input.command.labId !== cage.labId) {
    return { ok: false as const, code: "stale_conflict", message: "Cage ownership changed. Refresh and review closure again." };
  }
  if (cage.closure || !cage.active || cage.status === "closed") {
    return { ok: false as const, code: "invalid_transition", message: `${cage.barcode} is already closed.` };
  }
  if (cage.quarantineCases.length) {
    return { ok: false as const, code: "invalid_transition", message: "Use the quarantine release workflow before closing this cage." };
  }

  const assignmentResult = validateAssignments(cage.animals, input.command.assignments);
  if (!assignmentResult.ok) return { ...assignmentResult, code: "validation_error" as const };
  const terminalAssignment = cage.animals.find((animal) => animal.outcomeStatus !== "alive");
  if (terminalAssignment) {
    return {
      ok: false as const,
      code: "data_integrity_error",
      message: `${terminalAssignment.animalId} is no longer live but remains assigned to this cage. Reconcile the animal record before closure.`,
    };
  }
  if (cage.animals.some((animal) => animal.currentCageId !== cage.id)) {
    return { ok: false as const, code: "stale_conflict", message: "Cage occupancy changed. Refresh and review closure again." };
  }
  const linkedBreeder = cage.animals.find((animal) => animal.breedingAdults.length);
  if (linkedBreeder) {
    return {
      ok: false as const,
      code: "validation_error",
      message: `${linkedBreeder.animalId} belongs to an open breeding setup. Complete or retire it before closing the cage.`,
    };
  }

  const openChargePeriods = cage.chargePeriods.filter((period) => period.endedAt === null);
  if (hasOverlappingChargePeriods(cage.chargePeriods)) {
    return {
      ok: false as const,
      code: "billing_state_invalid",
      message: "Cage charge periods overlap. Reconcile billing history before closure.",
    };
  }
  if (openChargePeriods.length !== 1) {
    return {
      ok: false as const,
      code: "billing_state_invalid",
      message: "Cage closure requires exactly one active charge period. Reconcile billing before continuing.",
    };
  }
  const finalChargePeriod = openChargePeriods[0];
  if (finalChargePeriod.labId !== cage.labId) {
    return {
      ok: false as const,
      code: "billing_state_invalid",
      message: "The active charge period does not belong to the cage's current lab. Reconcile billing before closure.",
    };
  }
  const reviewedChargePeriodStartedAt = new Date(input.command.expectedChargePeriodStartedAt);
  if (
    input.command.expectedChargePeriodId !== finalChargePeriod.id
    || input.command.expectedChargeCategoryId !== finalChargePeriod.categoryId
    || Number.isNaN(reviewedChargePeriodStartedAt.getTime())
    || reviewedChargePeriodStartedAt.toISOString() !== finalChargePeriod.startedAt.toISOString()
    || input.command.expectedDailyRateCents !== finalChargePeriod.dailyRateCents
    || input.command.expectedCurrencyCode !== finalChargePeriod.currencyCode
  ) {
    return {
      ok: false as const,
      code: "stale_conflict",
      message: "The cage rate or active charge period changed. Refresh and review the final billing cutoff again.",
    };
  }
  const latestOperationalAt = latestDate([
    cage.lastUpdatedAt,
    cage.cageMovements[0]?.movedAt,
    cage.labTransfers[0]?.movedAt,
    ...cage.chargePeriods.flatMap((period) => [period.startedAt, period.endedAt]),
    ...cage.animals.flatMap((animal) => [animal.dob, animal.animalMovements[0]?.movedAt]),
  ]);
  if (latestOperationalAt && closedAt < latestOperationalAt) {
    return {
      ok: false as const,
      code: "validation_error",
      message: `Closure starts at 00:00 UTC and cannot predate cage, animal, or billing activity at ${latestOperationalAt.toISOString()}. Choose a later closure date.`,
    };
  }
  const conflictingInvoiceLine = cage.chargePeriods
    .flatMap((period) => period.invoiceLines)
    .find((line) => line.serviceEnd > closedAt);
  if (conflictingInvoiceLine) {
    const invoiceState = conflictingInvoiceLine.invoice.status === "draft" ? "Draft" : "Finalized";
    return {
      ok: false as const,
      code: "invoice_conflict",
      message: `${invoiceState} invoice ${conflictingInvoiceLine.invoice.invoiceNumber} bills beyond this cutoff. Regenerate or void it, or choose a later closure date.`,
    };
  }

  const destinationIds = [...new Set(input.command.assignments.map((assignment) => assignment.toCageId))];
  if (destinationIds.includes(cage.id)) {
    return { ok: false as const, code: "validation_error", message: "Choose a different destination cage for every occupant." };
  }
  const [destinations, mixedSexRule] = await Promise.all([
    input.tx.cage.findMany({
      where: { id: { in: destinationIds } },
      select: {
        id: true,
        labId: true,
        active: true,
        status: true,
        barcode: true,
        lastUpdatedAt: true,
        capacityOverride: true,
        room: { select: { facility: { select: { maxCageOccupancy: true } } } },
        animals: { where: { outcomeStatus: "alive" }, select: { id: true, sex: true } },
      },
    }),
    input.tx.ruleConfig.findUnique({ where: { key: "mixed_sex_holding_allowed" }, select: { value: true } }),
  ]);
  if (
    destinations.length !== destinationIds.length
    || destinations.some((destination) => destination.labId !== cage.labId || !destination.active || ["closed", "retired"].includes(destination.status))
  ) {
    return {
      ok: false as const,
      code: "validation_error",
      message: "Every closure destination must be an active cage in the same lab. Cross-lab moves require the approval workflow.",
    };
  }

  const incomingByDestination = new Map<string, number>();
  for (const animal of cage.animals) {
    const destinationId = assignmentResult.assignmentByAnimalId.get(animal.id)!;
    incomingByDestination.set(destinationId, (incomingByDestination.get(destinationId) ?? 0) + 1);
  }
  for (const destination of destinations) {
    const capacity = getCageCapacityState({
      facilityLimit: destination.room.facility.maxCageOccupancy,
      cageOverride: destination.capacityOverride,
      occupantCount: destination.animals.length,
    });
    const incomingCount = incomingByDestination.get(destination.id) ?? 0;
    if (capacity.isOverCapacity || destination.animals.length + incomingCount > capacity.effectiveLimit) {
      return {
        ok: false as const,
        code: "validation_error",
        message: `${destination.barcode} has capacity for ${capacity.remainingCapacity} more ${capacity.remainingCapacity === 1 ? "animal" : "animals"}; review the complete closure plan.`,
      };
    }
  }
  const ruleDestinations = destinations.map((destination) => ({
    key: `existing:${destination.id}`,
    label: destination.barcode,
    status: destination.status,
    occupants: destination.animals,
  }));
  const quarantineError = validateQuarantineAssignments({
    workflow: "new",
    destinations: ruleDestinations,
    usedDestinationKeys: new Set(ruleDestinations.map((destination) => destination.key)),
  });
  if (quarantineError) return { ok: false as const, code: "validation_error", message: quarantineError };
  const sexError = validateProjectedSexComposition({
    destinations: ruleDestinations,
    incoming: cage.animals.map((animal) => ({
      subjectId: animal.id,
      sex: animal.sex,
      destinationKey: `existing:${assignmentResult.assignmentByAnimalId.get(animal.id)!}`,
    })),
    mixedSexHoldingAllowed: mixedSexRule?.value === true,
  });
  if (sexError) return { ok: false as const, code: "validation_error", message: sexError };

  const latestDestinationAt = latestDate(destinations.map((destination) => destination.lastUpdatedAt));
  if (latestDestinationAt && closedAt < latestDestinationAt) {
    return {
      ok: false as const,
      code: "validation_error",
      message: `Closure transfers start at 00:00 UTC and cannot predate destination cage activity at ${latestDestinationAt.toISOString()}. Choose a later closure date.`,
    };
  }

  for (const animal of cage.animals) {
    const move = await moveAnimalToCage({
      animalId: animal.id,
      toCageId: assignmentResult.assignmentByAnimalId.get(animal.id)!,
      movedAt: input.command.closedAt,
      reason: `Cage closure: ${reason}`,
    }, {
      id: input.actor.id,
      role: input.actor.role,
      activeLabId: input.actor.activeLabId,
    }, input.tx, { deferCageMaintenance: true });
    if (!move.ok) {
      throw new Error(`Cage closure move preflight diverged for ${animal.id}: ${move.message}`);
    }
  }

  const remainingAssignments = await input.tx.animal.count({ where: { currentCageId: cage.id } });
  if (remainingAssignments) {
    throw new Error("Cage closure retained assigned animals after the reviewed movement plan.");
  }

  await input.tx.cageChargePeriod.update({
    where: { id: finalChargePeriod.id },
    data: { endedAt: closedAt },
  });
  await endActiveCageResponsibilities(input.tx, {
    cageId: cage.id,
    labId: cage.labId,
    actorId: input.actor.id,
    receiptId: input.receiptId,
    commandType: "cage.close",
    endedAt: closedAt,
    reason,
  });
  const cageClosed = await input.tx.cage.updateMany({
    where: { id: cage.id, version: input.expectedVersion },
    data: { active: false, status: "closed", lastUpdatedAt: new Date(), version: { increment: 1 } },
  });
  if (cageClosed.count !== 1) {
    throw new Error("Cage version changed after closure review; the transaction was rolled back.");
  }
  const closedCage = await input.tx.cage.findUniqueOrThrow({
    where: { id: cage.id },
    select: { version: true },
  });
  if (destinationIds.length) {
    const destinationUpdatedAt = new Date();
    await input.tx.cage.updateMany({
      where: { id: { in: destinationIds } },
      data: { lastUpdatedAt: destinationUpdatedAt },
    });
    await reconcileBreedingCageStatuses({
      tx: input.tx,
      labId: cage.labId,
      actorId: input.actor.id,
      effectiveAt: closedAt,
      auditTimestamp: destinationUpdatedAt,
      reason: `Cage closure: ${reason}`,
      candidateCageIds: destinationIds,
    });
  }
  const closure = await input.tx.cageClosure.create({
    data: {
      id: randomUUID(),
      cageId: cage.id,
      labId: cage.labId,
      chargePeriodId: finalChargePeriod.id,
      reviewSnapshotId: input.reviewSnapshotId,
      closedAt,
      billingCutoffAt: closedAt,
      reason,
      closedById: input.actor.id,
    },
  });
  const timestamp = new Date();
  await input.tx.auditLog.create({
    data: {
      id: randomUUID(),
      actorId: input.actor.id,
      entityType: "cage",
      entityId: cage.id,
      action: "close",
      previousValue: {
        active: cage.active,
        status: cage.status,
        version: cage.version,
        chargePeriodId: finalChargePeriod.id,
        billingCutoffAt: finalChargePeriod.endedAt,
      },
      newValue: {
        active: false,
        status: "closed",
        version: closedCage.version,
        closureId: closure.id,
        reviewSnapshotId: input.reviewSnapshotId,
        chargePeriodId: finalChargePeriod.id,
        closedAt: input.command.closedAt,
        billingCutoffAt: input.command.closedAt,
        billingBoundary: "half_open_end_exclusive",
        movedAnimals: cage.animals.map((animal) => ({
          animalId: animal.id,
          animalCode: animal.animalId,
          toCageId: assignmentResult.assignmentByAnimalId.get(animal.id),
        })),
        reason,
      },
      timestamp,
    },
  });

  return {
    ok: true as const,
    result: {
      cageId: cage.id,
      barcode: cage.barcode,
      closureId: closure.id,
      chargePeriodId: finalChargePeriod.id,
      closedAt: input.command.closedAt,
      billingCutoffAt: input.command.closedAt,
      message: `${cage.barcode} was closed and billing ended at the start of ${input.command.closedAt}.`,
    } as Prisma.InputJsonValue,
    resultingVersion: closedCage.version,
  };
}

export async function executeCloseCageCommand(input: {
  actor: ResolvedActor;
  command: CloseCageCommand;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
  workflowDraftId: string;
  reviewSnapshotId: string;
}) {
  const labId = input.command.labId;
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "cage.close",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: {
      command: input.command,
      expectedVersion: input.expectedVersion,
      reviewSnapshotId: input.reviewSnapshotId,
    } as unknown as Prisma.InputJsonValue,
    requiredCapability: "cages:manage",
    labId,
    workflowDraftId: input.workflowDraftId,
    aggregateType: "cage",
    aggregateId: input.command.cageId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      const snapshot = await tx.workflowReviewSnapshot.findUnique({
        where: { id: input.reviewSnapshotId },
        include: { draft: true },
      });
      const expectedPayload = { command: input.command, expectedVersion: input.expectedVersion };
      if (
        !snapshot
        || snapshot.draftId !== input.workflowDraftId
        || snapshot.createdById !== input.actor.id
        || snapshot.draft.actorId !== input.actor.id
        || snapshot.draft.labId !== labId
        || snapshot.draft.status !== "review"
        || snapshot.draft.version !== snapshot.draftVersion + 1
        || canonicalJsonHash(snapshot.payload) !== snapshot.payloadHash
        || canonicalJsonHash(snapshot.payload) !== canonicalJsonHash(expectedPayload)
      ) {
        return { ok: false as const, code: "invalid_review", message: "The reviewed cage closure is no longer current. Refresh and review it again." };
      }
      const reserved = await tx.workflowDraft.updateMany({
        where: {
          id: snapshot.draftId,
          actorId: input.actor.id,
          labId,
          status: "review",
          version: snapshot.draftVersion + 1,
        },
        data: { status: "submitted", submittedAt: new Date() },
      });
      if (reserved.count !== 1) {
        return { ok: false as const, code: "stale_conflict", message: "The cage closure review changed before submission." };
      }
      const restoreReview = async (code: string, message: string) => {
        const restored = await tx.workflowDraft.updateMany({
          where: {
            id: snapshot.draftId,
            actorId: input.actor.id,
            status: "submitted",
            version: snapshot.draftVersion + 2,
          },
          data: { status: "review", submittedAt: null },
        });
        if (restored.count !== 1) throw new Error("The failed cage closure review could not be restored atomically.");
        return { ok: false as const, code, message };
      };

      const closure = await performCageClosure({
        tx,
        actor: input.actor,
        command: input.command,
        expectedVersion: input.expectedVersion,
        reviewSnapshotId: input.reviewSnapshotId,
        receiptId: context.receiptId,
      });
      if (!closure.ok) return restoreReview(closure.code, closure.message);

      const committed = await tx.workflowDraft.updateMany({
        where: {
          id: snapshot.draftId,
          actorId: input.actor.id,
          labId,
          status: "submitted",
          version: snapshot.draftVersion + 2,
        },
        data: { status: "committed", committedAt: new Date() },
      });
      if (committed.count !== 1) throw new Error("The reviewed cage closure could not be committed atomically.");
      return {
        ok: true as const,
        result: closure.result,
        aggregateType: "cage",
        aggregateId: input.command.cageId,
        resultingVersion: closure.resultingVersion,
      };
    },
  });
}
