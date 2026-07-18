import { randomUUID } from "node:crypto";

import { Prisma, type AlertSeverity, type QuarantineObservationResult } from "@prisma/client";
import { addDays } from "date-fns";

import { validateProjectedSexComposition } from "@/lib/cage-assignment-rules";
import { getCageCapacityState } from "@/lib/cage-capacity";
import { canonicalJsonHash, executeIdempotentCommand } from "@/lib/command-foundation";
import { canManageLab, getActorLabAccess } from "@/lib/lab-access";
import { canRequestQuarantineRelease, nextQuarantineStatusForObservation, QUARANTINE_HEALTH_NOTE_ACTION_PREFIX } from "@/lib/quarantine-state-machine";
import type { ResolvedActor } from "@/lib/session";

function parseCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function commandLabId(actor: ResolvedActor) {
  return actor.canonicalRole === "lab_user" ? actor.activeLabId : null;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function openQuarantineHealthFollowupWhere(input: { labId: string; cageId: string; admittedAt: Date }): Prisma.HealthNoteWhereInput {
  return {
    labId: input.labId,
    cageId: input.cageId,
    createdAt: { gte: input.admittedAt },
    actionTaken: { startsWith: QUARANTINE_HEALTH_NOTE_ACTION_PREFIX },
    resolved: false,
    OR: [{ followupRequired: true }, { severity: { in: ["warning", "critical"] } }],
  };
}

export type AdmitQuarantineCaseCommand = {
  cageId: string;
  admittedAt: string;
  minimumHoldDays: number;
  reason: string;
};

export async function executeAdmitQuarantineCaseCommand(input: {
  actor: ResolvedActor;
  command: AdmitQuarantineCaseCommand;
  expectedCageVersion: number;
  idempotencyKey: string;
  requestId: string;
}) {
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "quarantine.case.admit",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { command: input.command, expectedCageVersion: input.expectedCageVersion } as unknown as Prisma.InputJsonValue,
    requiredCapability: "quarantine:manage",
    labId: commandLabId(input.actor),
    aggregateType: "cage",
    aggregateId: input.command.cageId,
    expectedVersion: input.expectedCageVersion,
    handler: async (tx) => {
      const reason = input.command.reason.trim();
      const admittedAt = parseCalendarDate(input.command.admittedAt);
      if (!admittedAt || reason.length < 3 || !Number.isInteger(input.command.minimumHoldDays) || input.command.minimumHoldDays < 1 || input.command.minimumHoldDays > 180) {
        return { ok: false as const, code: "validation_error", message: "Choose a valid admission date, holding period, and reason." };
      }
      if (dateKey(admittedAt) > dateKey(new Date())) {
        return { ok: false as const, code: "validation_error", message: "Quarantine admission cannot be dated in the future." };
      }
      const cage = await tx.cage.findUnique({
        where: { id: input.command.cageId },
        select: {
          id: true,
          labId: true,
          barcode: true,
          active: true,
          status: true,
          version: true,
          quarantineCases: {
            where: { status: { in: ["admitted", "under_observation", "exception_open", "release_requested"] } },
            select: { id: true },
          },
          animals: {
            where: { outcomeStatus: "alive" },
            select: {
              intakeBatch: { select: { id: true, labId: true, disposition: true, arrivalDate: true } },
            },
          },
          cageMovements: { orderBy: { movedAt: "desc" }, take: 1, select: { movedAt: true } },
        },
      });
      if (!cage || !canManageLab(await getActorLabAccess(input.actor, tx), cage.labId)) {
        return { ok: false as const, code: "not_found", message: "Quarantine cage not found." };
      }
      if (!cage.active || cage.status !== "quarantine") {
        return { ok: false as const, code: "validation_error", message: "Admission requires an active quarantine cage." };
      }
      if (cage.quarantineCases.length) {
        return { ok: false as const, code: "validation_error", message: "This cage already has an open quarantine case." };
      }
      const intakeBatches = cage.animals
        .map((animal) => animal.intakeBatch)
        .filter((batch): batch is NonNullable<typeof batch> => Boolean(batch));
      const batchIds = new Set(intakeBatches.map((batch) => batch.id));
      const intakeBatch = batchIds.size === 1 && intakeBatches.every((batch) => batch.labId === cage.labId && batch.disposition === "quarantine")
        ? intakeBatches[0]
        : null;
      const latestSourceDate = [cage.cageMovements[0]?.movedAt, intakeBatch?.arrivalDate]
        .filter((date): date is Date => Boolean(date))
        .sort((left, right) => right.getTime() - left.getTime())[0];
      if (latestSourceDate && dateKey(admittedAt) < dateKey(latestSourceDate)) {
        return { ok: false as const, code: "validation_error", message: "Admission cannot predate the latest cage movement or intake arrival." };
      }
      const quarantineCase = await tx.quarantineCase.create({
        data: {
          id: randomUUID(),
          labId: cage.labId,
          cageId: cage.id,
          intakeBatchId: intakeBatch?.id ?? null,
          admittedAt,
          minimumReleaseAt: addDays(admittedAt, input.command.minimumHoldDays),
          admissionReason: reason,
          admittedById: input.actor.id,
        },
      });
      const updatedCage = await tx.cage.update({
        where: { id: cage.id },
        data: { lastUpdatedAt: new Date() },
        select: { version: true },
      });
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: input.actor.id,
          entityType: "quarantine_case",
          entityId: quarantineCase.id,
          action: "admit",
          previousValue: Prisma.JsonNull,
          newValue: {
            cageId: cage.id,
            cageBarcode: cage.barcode,
            labId: cage.labId,
            intakeBatchId: intakeBatch?.id ?? null,
            admittedAt: input.command.admittedAt,
            minimumReleaseAt: dateKey(quarantineCase.minimumReleaseAt),
            reason,
          },
          timestamp: new Date(),
        },
      });
      return {
        ok: true as const,
        result: { caseId: quarantineCase.id, message: `${cage.barcode} admitted to quarantine.` },
        aggregateType: "cage",
        aggregateId: cage.id,
        resultingVersion: updatedCage.version,
      };
    },
  });
}

export type RecordQuarantineObservationCommand = {
  caseId: string;
  observedAt: string;
  result: QuarantineObservationResult;
  severity: AlertSeverity;
  note: string;
  followupRequired: boolean;
};

export async function executeRecordQuarantineObservationCommand(input: {
  actor: ResolvedActor;
  command: RecordQuarantineObservationCommand;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
}) {
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "quarantine.case.observe",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { command: input.command, expectedVersion: input.expectedVersion } as unknown as Prisma.InputJsonValue,
    requiredCapability: "quarantine:manage",
    labId: commandLabId(input.actor),
    aggregateType: "quarantine_case",
    aggregateId: input.command.caseId,
    expectedVersion: input.expectedVersion,
    handler: async (tx) => {
      const note = input.command.note.trim();
      const observedAt = parseCalendarDate(input.command.observedAt);
      if (!observedAt || note.length < 3) {
        return { ok: false as const, code: "validation_error", message: "Choose a valid observation date and enter a clear note." };
      }
      if (dateKey(observedAt) > dateKey(new Date())) {
        return { ok: false as const, code: "validation_error", message: "Observation date cannot be in the future." };
      }
      const quarantineCase = await tx.quarantineCase.findUnique({
        where: { id: input.command.caseId },
        include: {
          observations: { orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 1, select: { observedAt: true } },
          cage: { select: { id: true, barcode: true, status: true, active: true } },
        },
      });
      if (!quarantineCase || !canManageLab(await getActorLabAccess(input.actor, tx), quarantineCase.labId)) {
        return { ok: false as const, code: "not_found", message: "Quarantine case not found." };
      }
      if (!quarantineCase.cage.active || quarantineCase.cage.status !== "quarantine") {
        return { ok: false as const, code: "validation_error", message: "The case cage is no longer an active quarantine cage." };
      }
      const nextStatus = nextQuarantineStatusForObservation(quarantineCase.status, input.command.result);
      if (!nextStatus) {
        return { ok: false as const, code: "invalid_transition", message: "This observation is not valid for the current quarantine state." };
      }
      const latestDate = quarantineCase.observations[0]?.observedAt ?? quarantineCase.admittedAt;
      if (dateKey(observedAt) < dateKey(latestDate)) {
        return { ok: false as const, code: "validation_error", message: "Observation cannot predate the latest quarantine event." };
      }
      if (input.command.result === "exception" && input.command.severity === "info") {
        return { ok: false as const, code: "validation_error", message: "A quarantine exception must be warning or critical severity." };
      }
      const followupRequired = input.command.result === "exception" || input.command.followupRequired;
      const actionableHealthNote = followupRequired || input.command.severity === "warning" || input.command.severity === "critical";
      const healthNoteResolved = input.command.result === "exception_resolved"
        ? !input.command.followupRequired
        : !actionableHealthNote;
      const observation = await tx.quarantineObservation.create({
        data: {
          id: randomUUID(),
          caseId: quarantineCase.id,
          labId: quarantineCase.labId,
          observedAt,
          observedById: input.actor.id,
          result: input.command.result,
          severity: input.command.severity,
          note,
          followupRequired,
        },
      });
      const updatedCase = await tx.quarantineCase.update({
        where: { id: quarantineCase.id },
        data: { status: nextStatus },
        select: { version: true },
      });
      await tx.healthNote.create({
        data: {
          id: randomUUID(),
          labId: quarantineCase.labId,
          cageId: quarantineCase.cageId,
          noteType: input.command.result === "exception" ? "veterinary_concern" : "routine_welfare",
          severity: input.command.severity,
          note,
          followupRequired,
          actionTaken: `${QUARANTINE_HEALTH_NOTE_ACTION_PREFIX} ${input.command.result.replaceAll("_", " ")}`,
          resolved: healthNoteResolved,
          createdById: input.actor.id,
          createdAt: observedAt,
        },
      });
      if (input.command.result === "exception" || input.command.severity !== "info") {
        await tx.alert.create({
          data: {
            id: randomUUID(),
            labId: quarantineCase.labId,
            entityType: "quarantine_case",
            entityId: quarantineCase.id,
            alertType: "quarantine_exception",
            severity: input.command.severity,
            message: note,
            source: "quarantine_observation",
            generatedAt: observedAt,
          },
        });
      }
      if ((input.command.result === "clear" || input.command.result === "exception_resolved") && healthNoteResolved) {
        await Promise.all([
          tx.alert.updateMany({
            where: { entityType: "quarantine_case", entityId: quarantineCase.id, status: { in: ["open", "acknowledged"] } },
            data: { status: "resolved", resolvedAt: observedAt },
          }),
          tx.healthNote.updateMany({
            where: {
              labId: quarantineCase.labId,
              cageId: quarantineCase.cageId,
              actionTaken: { startsWith: QUARANTINE_HEALTH_NOTE_ACTION_PREFIX },
              createdAt: { gte: quarantineCase.admittedAt, lte: observedAt },
              resolved: false,
            },
            data: { resolved: true, followupRequired: false },
          }),
        ]);
      }
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: input.actor.id,
          entityType: "quarantine_case",
          entityId: quarantineCase.id,
          action: "observe",
          previousValue: { status: quarantineCase.status, version: quarantineCase.version },
          newValue: {
            status: nextStatus,
            observationId: observation.id,
            observedAt: input.command.observedAt,
            result: input.command.result,
            severity: input.command.severity,
            followupRequired,
          },
          timestamp: new Date(),
        },
      });
      return {
        ok: true as const,
        result: { caseId: quarantineCase.id, observationId: observation.id, message: `Observation recorded for ${quarantineCase.cage.barcode}.` },
        aggregateType: "quarantine_case",
        aggregateId: quarantineCase.id,
        resultingVersion: updatedCase.version,
      };
    },
  });
}

export type RequestQuarantineReleaseCommand = {
  caseId: string;
  requestedAt: string;
  reason: string;
};

export async function executeRequestQuarantineReleaseCommand(input: {
  actor: ResolvedActor;
  command: RequestQuarantineReleaseCommand;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
}) {
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "quarantine.case.request_release",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { command: input.command, expectedVersion: input.expectedVersion } as unknown as Prisma.InputJsonValue,
    requiredCapability: "quarantine:manage",
    labId: commandLabId(input.actor),
    aggregateType: "quarantine_case",
    aggregateId: input.command.caseId,
    expectedVersion: input.expectedVersion,
    handler: async (tx) => {
      const reason = input.command.reason.trim();
      const requestedAt = parseCalendarDate(input.command.requestedAt);
      if (!requestedAt || reason.length < 3 || dateKey(requestedAt) > dateKey(new Date())) {
        return { ok: false as const, code: "validation_error", message: "Choose a valid release-request date and reason." };
      }
      const quarantineCase = await tx.quarantineCase.findUnique({
        where: { id: input.command.caseId },
        include: {
          observations: { orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 1, select: { result: true, observedAt: true } },
          cage: { select: { barcode: true, active: true, status: true } },
        },
      });
      if (!quarantineCase || !canManageLab(await getActorLabAccess(input.actor, tx), quarantineCase.labId)) {
        return { ok: false as const, code: "not_found", message: "Quarantine case not found." };
      }
      if (!quarantineCase.cage.active || quarantineCase.cage.status !== "quarantine") {
        return { ok: false as const, code: "validation_error", message: "The case cage is no longer an active quarantine cage." };
      }
      const latestObservation = quarantineCase.observations[0] ?? null;
      const openFollowupCount = await tx.healthNote.count({
        where: openQuarantineHealthFollowupWhere({
          labId: quarantineCase.labId,
          cageId: quarantineCase.cageId,
          admittedAt: quarantineCase.admittedAt,
        }),
      });
      if (latestObservation && dateKey(requestedAt) < dateKey(latestObservation.observedAt)) {
        return { ok: false as const, code: "validation_error", message: "Release request cannot predate the latest observation." };
      }
      if (!canRequestQuarantineRelease({
        status: quarantineCase.status,
        minimumReleaseAt: quarantineCase.minimumReleaseAt,
        requestedAt,
        latestObservationResult: latestObservation?.result ?? null,
        openFollowupCount,
      })) {
        return { ok: false as const, code: "invalid_transition", message: "Release requires the minimum hold, a latest clear observation, and no unresolved welfare follow-up." };
      }
      const updatedCase = await tx.quarantineCase.update({
        where: { id: quarantineCase.id },
        data: {
          status: "release_requested",
          releaseRequestedAt: requestedAt,
          releaseRequestedById: input.actor.id,
          releaseRequestReason: reason,
        },
        select: { version: true },
      });
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: input.actor.id,
          entityType: "quarantine_case",
          entityId: quarantineCase.id,
          action: "request_release",
          previousValue: { status: quarantineCase.status, version: quarantineCase.version },
          newValue: { status: "release_requested", requestedAt: input.command.requestedAt, reason },
          timestamp: new Date(),
        },
      });
      return {
        ok: true as const,
        result: { caseId: quarantineCase.id, message: `Release requested for ${quarantineCase.cage.barcode}.` },
        aggregateType: "quarantine_case",
        aggregateId: quarantineCase.id,
        resultingVersion: updatedCase.version,
      };
    },
  });
}

export type FinalizeQuarantineReleaseCommand = {
  caseId: string;
  releasedAt: string;
  reason: string;
  assignments: Array<{ animalId: string; toCageId: string }>;
};

export async function executeFinalizeQuarantineReleaseCommand(input: {
  actor: ResolvedActor;
  command: FinalizeQuarantineReleaseCommand;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
  workflowDraftId: string;
  reviewSnapshotId: string;
}) {
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "quarantine.case.finalize_release",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { command: input.command, expectedVersion: input.expectedVersion, reviewSnapshotId: input.reviewSnapshotId } as unknown as Prisma.InputJsonValue,
    requiredCapability: "quarantine:manage",
    labId: commandLabId(input.actor),
    workflowDraftId: input.workflowDraftId,
    aggregateType: "quarantine_case",
    aggregateId: input.command.caseId,
    expectedVersion: input.expectedVersion,
    handler: async (tx) => {
      if (input.actor.canonicalRole !== "facility_admin" && input.actor.canonicalRole !== "cmu_staff") {
        return { ok: false as const, code: "forbidden", message: "Only CMU staff or Facility Admin can finalize quarantine release." };
      }
      const snapshot = await tx.workflowReviewSnapshot.findUnique({
        where: { id: input.reviewSnapshotId },
        include: { draft: true },
      });
      const expectedPayload = { command: input.command, expectedVersion: input.expectedVersion };
      const labId = commandLabId(input.actor);
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
        return { ok: false as const, code: "invalid_review", message: "The reviewed quarantine release is no longer current. Refresh and review it again." };
      }
      const reserved = await tx.workflowDraft.updateMany({
        where: { id: snapshot.draftId, actorId: input.actor.id, labId, status: "review", version: snapshot.draftVersion + 1 },
        data: { status: "submitted", submittedAt: new Date() },
      });
      if (reserved.count !== 1) return { ok: false as const, code: "stale_conflict", message: "The release review changed before submission." };

      const restoreReview = async (code: string, message: string) => {
        const restored = await tx.workflowDraft.updateMany({
          where: { id: snapshot.draftId, actorId: input.actor.id, status: "submitted", version: snapshot.draftVersion + 2 },
          data: { status: "review", submittedAt: null },
        });
        if (restored.count !== 1) throw new Error("The failed quarantine release review could not be restored atomically.");
        return { ok: false as const, code, message };
      };

      const releasedAt = parseCalendarDate(input.command.releasedAt);
      const reason = input.command.reason.trim();
      if (!releasedAt || reason.length < 3 || dateKey(releasedAt) > dateKey(new Date())) {
        return restoreReview("validation_error", "Choose a valid release date and reason.");
      }
      const quarantineCase = await tx.quarantineCase.findUnique({
        where: { id: input.command.caseId },
        include: {
          observations: { orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 1, select: { observedAt: true, result: true } },
          cage: {
            include: {
              animals: {
                where: { outcomeStatus: "alive" },
                orderBy: { id: "asc" },
                select: {
                  id: true,
                  animalId: true,
                  sex: true,
                  currentCageId: true,
                  breedingAdults: { where: { breedingSetup: { status: { in: ["planned", "active", "paused"] } } }, select: { id: true } },
                  experimentAssignments: { where: { status: { in: ["planned", "reserved", "active"] } }, select: { id: true } },
                },
              },
            },
          },
        },
      });
      if (!quarantineCase || !canManageLab(await getActorLabAccess(input.actor, tx), quarantineCase.labId)) {
        return restoreReview("not_found", "Quarantine case not found.");
      }
      if (quarantineCase.status !== "release_requested" || !quarantineCase.releaseRequestedAt) {
        return restoreReview("invalid_transition", "Release must be requested before finalization.");
      }
      if (!quarantineCase.cage.active || quarantineCase.cage.status !== "quarantine") {
        return restoreReview("invalid_transition", "The source cage must remain active and quarantined through finalization.");
      }
      const latestObservation = quarantineCase.observations[0] ?? null;
      if (!latestObservation || (latestObservation.result !== "clear" && latestObservation.result !== "exception_resolved")) {
        return restoreReview("invalid_transition", "The latest quarantine observation is no longer clearing. Record and review a new clear observation.");
      }
      const openFollowupCount = await tx.healthNote.count({
        where: openQuarantineHealthFollowupWhere({
          labId: quarantineCase.labId,
          cageId: quarantineCase.cageId,
          admittedAt: quarantineCase.admittedAt,
        }),
      });
      if (openFollowupCount > 0) {
        return restoreReview("validation_error", "Resolve every quarantine welfare follow-up before finalization.");
      }
      const latestEvent = [quarantineCase.releaseRequestedAt, quarantineCase.observations[0]?.observedAt]
        .filter((date): date is Date => Boolean(date))
        .sort((left, right) => right.getTime() - left.getTime())[0];
      if (latestEvent && dateKey(releasedAt) < dateKey(latestEvent)) {
        return restoreReview("validation_error", "Release cannot predate the release request or latest observation.");
      }
      const occupants = quarantineCase.cage.animals;
      if (occupants.some((animal) => animal.currentCageId !== quarantineCase.cageId)) {
        return restoreReview("stale_conflict", "Quarantine cage occupancy changed. Refresh the release plan.");
      }
      if (occupants.some((animal) => animal.breedingAdults.length || animal.experimentAssignments.length)) {
        return restoreReview("validation_error", "Resolve open breeding or experiment relationships before release.");
      }
      const assignmentByAnimal = new Map(input.command.assignments.map((assignment) => [assignment.animalId, assignment.toCageId]));
      if (assignmentByAnimal.size !== input.command.assignments.length || assignmentByAnimal.size !== occupants.length || occupants.some((animal) => !assignmentByAnimal.has(animal.id))) {
        return restoreReview("validation_error", "Assign every live quarantine occupant exactly once before release.");
      }
      const destinationIds = [...new Set(input.command.assignments.map((assignment) => assignment.toCageId))];
      if (destinationIds.includes(quarantineCase.cageId)) {
        return restoreReview("validation_error", "Choose non-quarantine destination cages.");
      }
      const destinations = await tx.cage.findMany({
        where: { id: { in: destinationIds } },
        select: {
          id: true,
          labId: true,
          barcode: true,
          status: true,
          active: true,
          capacityOverride: true,
          room: { select: { facility: { select: { maxCageOccupancy: true } } } },
          animals: { where: { outcomeStatus: "alive" }, select: { id: true, sex: true } },
        },
      });
      if (
        destinations.length !== destinationIds.length
        || destinations.some((cage) => cage.labId !== quarantineCase.labId || !cage.active || cage.status !== "active")
      ) {
        return restoreReview("validation_error", "Every release destination must be an active same-lab holding cage.");
      }
      const destinationById = new Map(destinations.map((destination) => [destination.id, destination]));
      const incomingCount = new Map<string, number>();
      for (const assignment of input.command.assignments) incomingCount.set(assignment.toCageId, (incomingCount.get(assignment.toCageId) ?? 0) + 1);
      for (const destination of destinations) {
        const capacity = getCageCapacityState({
          facilityLimit: destination.room.facility.maxCageOccupancy,
          cageOverride: destination.capacityOverride,
          occupantCount: destination.animals.length,
        });
        if (destination.animals.length + (incomingCount.get(destination.id) ?? 0) > capacity.effectiveLimit) {
          return restoreReview("capacity_exceeded", `${destination.barcode} does not have enough capacity for this release plan.`);
        }
      }
      const mixedSexRule = await tx.ruleConfig.findUnique({ where: { key: "mixed_sex_holding_allowed" }, select: { value: true } });
      const sexError = validateProjectedSexComposition({
        destinations: destinations.map((destination) => ({
          key: destination.id,
          label: destination.barcode,
          status: destination.status,
          occupants: destination.animals,
        })),
        incoming: occupants.map((animal) => ({ subjectId: animal.id, sex: animal.sex, destinationKey: assignmentByAnimal.get(animal.id)! })),
        mixedSexHoldingAllowed: mixedSexRule?.value === true,
      });
      if (sexError) return restoreReview("validation_error", sexError);

      const releasedCase = await tx.quarantineCase.update({
        where: { id: quarantineCase.id },
        data: { status: "released", releasedAt, releasedById: input.actor.id, releaseReason: reason },
        select: { version: true },
      });

      for (const animal of occupants) {
        const toCageId = assignmentByAnimal.get(animal.id)!;
        await tx.animalMovement.create({
          data: {
            id: randomUUID(),
            animalId: animal.id,
            fromCageId: quarantineCase.cageId,
            toCageId,
            movedById: input.actor.id,
            movedAt: releasedAt,
            reason,
          },
        });
        await tx.animal.update({ where: { id: animal.id }, data: { currentCageId: toCageId, healthStatus: "Released from quarantine" } });
      }
      const timestamp = new Date();
      await tx.cage.updateMany({ where: { id: { in: [quarantineCase.cageId, ...destinationIds] } }, data: { lastUpdatedAt: timestamp } });
      await tx.alert.updateMany({
        where: { entityType: "quarantine_case", entityId: quarantineCase.id, status: { in: ["open", "acknowledged"] } },
        data: { status: "resolved", resolvedAt: releasedAt },
      });
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: input.actor.id,
          entityType: "quarantine_case",
          entityId: quarantineCase.id,
          action: "finalize_release",
          previousValue: { status: quarantineCase.status, version: quarantineCase.version, cageId: quarantineCase.cageId },
          newValue: {
            status: "released",
            releasedAt: input.command.releasedAt,
            reason,
            assignments: occupants.map((animal) => ({ animalId: animal.id, animalCode: animal.animalId, toCageId: assignmentByAnimal.get(animal.id)!, destinationBarcode: destinationById.get(assignmentByAnimal.get(animal.id)!)?.barcode })),
          },
          timestamp,
        },
      });
      const committed = await tx.workflowDraft.updateMany({
        where: { id: snapshot.draftId, actorId: input.actor.id, labId, status: "submitted", version: snapshot.draftVersion + 2 },
        data: { status: "committed", committedAt: timestamp },
      });
      if (committed.count !== 1) throw new Error("The quarantine release review could not be committed atomically.");
      return {
        ok: true as const,
        result: { caseId: quarantineCase.id, movedAnimals: occupants.length, message: `Released ${occupants.length} ${occupants.length === 1 ? "animal" : "animals"} from ${quarantineCase.cage.barcode}.` },
        aggregateType: "quarantine_case",
        aggregateId: quarantineCase.id,
        resultingVersion: releasedCase.version,
      };
    },
  });
}
