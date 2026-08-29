import { Prisma } from "@prisma/client";

import {
  resolveEffectiveCageCapacity,
  validateCapacityOverride,
} from "@/lib/cage-capacity";
import {
  validateProjectedSexComposition,
  validateQuarantineAssignments,
  type AssignmentRuleDestination,
} from "@/lib/cage-assignment-rules";
import { cageIntakeDraftPayloadSchema } from "@/lib/cage-intake-draft";
import {
  allocateFacilityIdentifiers,
  canonicalJsonHash,
  executeIdempotentCommand,
} from "@/lib/command-foundation";
import {
  canManageLab,
  getActorLabAccess,
  type LabActor,
} from "@/lib/lab-access";
import { prisma } from "@/lib/prisma";
import {
  evaluateAndWriteComplianceEvidence,
  releaseProtocolReservation,
  withM13MutationSavepoint,
} from "@/lib/protocol-compliance";
import type { ResolvedActor } from "@/lib/session";
import type {
  AnimalIntakeDisposition,
  AnimalIntakeRow,
  CageAssignmentPlan,
  CageDestinationRef,
  CageDraft,
} from "@/lib/types";

type MutationResult =
  | { ok: true; message: string; entityId?: string; createdCageIds?: string[] }
  | { ok: false; message: string };

type PreparedCage = {
  clientId: string;
  id: string;
  facilityCageId: string;
  labId: string;
  roomId: string;
  rackId: string;
  cageNumber: string;
  barcode: string;
  status: CageDraft["status"];
  capacityOverride: number | null;
  effectiveCapacity: number;
  chargeCategory: {
    id: string;
    dailyRateCents: number;
    currencyCode: string;
  };
  startDate: Date;
  notes: string | null;
};

type PreparedDestination = {
  id: string;
  barcode: string;
  labId: string;
  active: boolean;
  status: string;
  effectiveCapacity: number;
  occupantCount: number;
  occupants: Array<{ id: string; sex: "male" | "female" | "unknown" }>;
};

export type WeanLitterWithCagePlanInput = {
  protocolAuthorizationId?: string;
  litterId: string;
  weanDate: string;
  strainId: string;
  pups: Array<{
    rowId: string;
    sex: "male" | "female";
    destination: CageDestinationRef;
  }>;
  cages: CageDraft[];
};

export type ReceivePurchasedAnimalsInput = {
  protocolAuthorizationId?: string;
  batchId?: string;
  labId: string;
  vendor: string;
  orderReference: string;
  arrivalDate: string;
  disposition: AnimalIntakeDisposition;
  notes?: string;
  animals: AnimalIntakeRow[];
  cages: CageDraft[];
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function canManageCageIntake(role: LabActor["role"]) {
  return (
    role === "admin" || role === "colony_manager" || role === "animal_staff"
  );
}

function normalizeBarcodePart(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function destinationKey(destination: CageDestinationRef) {
  return destination.kind === "new"
    ? `new:${destination.clientId}`
    : `existing:${destination.cageId}`;
}

export function parseCageIntakeDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false as const, message: `Choose a valid ${label}.` };
  }
  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? { ok: false as const, message: `Choose a valid ${label}.` }
    : { ok: true as const, date };
}

function parseYearlyAnimalSequence(animalId: string, yearPrefix: string) {
  const match = animalId.match(new RegExp(`^CM-${yearPrefix}(\\d{3})$`));
  return match ? Number(match[1]) : null;
}

function parseYearlyLabSequence(labId: string, year: number) {
  const match = labId.match(new RegExp(`^MC-${year}-(\\d{3})$`));
  return match ? Number(match[1]) : null;
}

function buildNextAnimalIdentifiers(
  existingAnimals: Array<{ animalId: string; labId: string }>,
  year: number,
  count: number,
) {
  const yearPrefix = String(year).slice(-2);
  let sequence =
    existingAnimals.reduce((highest, animal) => {
      return Math.max(
        highest,
        parseYearlyAnimalSequence(animal.animalId, yearPrefix) ?? 0,
        parseYearlyLabSequence(animal.labId, year) ?? 0,
      );
    }, 0) + 1;

  return Array.from({ length: count }, () => {
    const current = sequence++;
    return {
      animalId: `CM-${yearPrefix}${String(current).padStart(3, "0")}`,
      labId: `MC-${year}-${String(current).padStart(3, "0")}`,
    };
  });
}

async function runSerializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 25_000,
      });
    } catch (error) {
      const retry =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (!retry || attempt === 2) throw error;
    }
  }

  throw new Error("Serializable transaction retry limit reached.");
}

async function prepareNewCages(
  tx: Prisma.TransactionClient,
  drafts: CageDraft[],
  actor: LabActor,
  incomingByDestination: Map<string, number>,
): Promise<
  { ok: true; cages: PreparedCage[] } | { ok: false; message: string }
> {
  const access = await getActorLabAccess(actor, tx);
  const clientIds = drafts.map((draft) => draft.clientId.trim());

  if (
    new Set(clientIds).size !== clientIds.length ||
    clientIds.some((id) => !id)
  ) {
    return {
      ok: false,
      message: "Each proposed cage needs a unique planning ID.",
    };
  }

  const [rooms, racks, activeCategories] = await Promise.all([
    tx.room.findMany({
      where: { id: { in: drafts.map((draft) => draft.roomId) } },
      select: {
        id: true,
        roomNumber: true,
        facility: {
          select: {
            id: true,
            cageBarcodePrefix: true,
            maxCageOccupancy: true,
          },
        },
      },
    }),
    tx.rack.findMany({
      where: { id: { in: drafts.map((draft) => draft.rackId) } },
      select: { id: true, roomId: true, rackNumber: true },
    }),
    tx.cageChargeCategory.findMany({
      where: { active: true },
      orderBy: [{ code: "asc" }, { name: "asc" }],
      select: {
        id: true,
        code: true,
        dailyRateCents: true,
        currencyCode: true,
      },
    }),
  ]);
  const defaultCategory =
    activeCategories.find((category) => category.code === "STANDARD") ??
    activeCategories[0] ??
    null;
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const rackById = new Map(racks.map((rack) => [rack.id, rack]));
  const requestedCategoryIds = Array.from(
    new Set(
      drafts
        .map((draft) => draft.chargeCategoryId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const categories = requestedCategoryIds.length
    ? await tx.cageChargeCategory.findMany({
        where: { id: { in: requestedCategoryIds }, active: true },
        select: { id: true, dailyRateCents: true, currencyCode: true },
      })
    : [];
  const categoryById = new Map(
    categories.map((category) => [category.id, category]),
  );
  const prepared: Array<Omit<PreparedCage, "facilityCageId">> = [];

  for (const draft of drafts) {
    const room = roomById.get(draft.roomId);
    const rack = rackById.get(draft.rackId);
    const startDate = parseCageIntakeDate(draft.startDate, "cage start date");

    if (!room || !rack || rack.roomId !== room.id) {
      return {
        ok: false,
        message: "Choose a rack that belongs to the selected room.",
      };
    }

    if (!canManageLab(access, draft.labId)) {
      return {
        ok: false,
        message: "You can only create cages for labs you manage.",
      };
    }

    if (!startDate.ok) return startDate;

    const cageNumber = draft.cageNumber.trim();
    if (!cageNumber)
      return {
        ok: false,
        message: "Enter a cage number for every proposed cage.",
      };

    const capacityError = validateCapacityOverride(
      room.facility.maxCageOccupancy,
      draft.capacityOverride,
      incomingByDestination.get(`new:${draft.clientId}`) ?? 0,
    );
    if (capacityError) return { ok: false, message: capacityError };

    const effectiveCapacity = resolveEffectiveCageCapacity(
      room.facility.maxCageOccupancy,
      draft.capacityOverride,
    );
    const incoming = incomingByDestination.get(`new:${draft.clientId}`) ?? 0;
    if (incoming > effectiveCapacity) {
      return {
        ok: false,
        message: `Proposed cage ${cageNumber} has ${incoming} animals but a limit of ${effectiveCapacity}.`,
      };
    }

    const generatedBarcode = [
      room.facility.cageBarcodePrefix,
      room.roomNumber,
      rack.rackNumber,
      cageNumber,
    ]
      .map(normalizeBarcodePart)
      .filter(Boolean)
      .join("-");
    const barcode = normalizeBarcodePart(draft.barcode || generatedBarcode);
    const category = draft.chargeCategoryId
      ? categoryById.get(draft.chargeCategoryId)
      : defaultCategory;

    if (!barcode)
      return { ok: false, message: "Enter or generate a cage barcode." };
    if (!category)
      return {
        ok: false,
        message:
          "Configure an active cage charge category before creating cages.",
      };

    prepared.push({
      clientId: draft.clientId,
      id: createId("cage"),
      labId: draft.labId,
      roomId: room.id,
      rackId: rack.id,
      cageNumber,
      barcode,
      status: draft.status,
      capacityOverride: draft.capacityOverride ?? null,
      effectiveCapacity,
      chargeCategory: category,
      startDate: startDate.date,
      notes: draft.notes?.trim() || null,
    });
  }

  if (new Set(prepared.map((cage) => cage.barcode)).size !== prepared.length) {
    return { ok: false, message: "Proposed cage barcodes must be unique." };
  }

  if (
    new Set(prepared.map((cage) => `${cage.rackId}:${cage.cageNumber}`))
      .size !== prepared.length
  ) {
    return {
      ok: false,
      message: "A cage number can only be used once on the same rack.",
    };
  }

  const conflict = await tx.cage.findFirst({
    where: {
      OR: [
        { barcode: { in: prepared.map((cage) => cage.barcode) } },
        ...prepared.map((cage) => ({
          rackId: cage.rackId,
          cageNumber: cage.cageNumber,
        })),
      ],
    },
    select: { barcode: true },
  });

  if (conflict) {
    return {
      ok: false,
      message: `Cage ID or rack position already exists (${conflict.barcode}).`,
    };
  }

  if (!prepared.length) return { ok: true, cages: [] };
  const facilityCageIds = await allocateFacilityIdentifiers(
    tx,
    "cage",
    prepared.length,
  );
  return {
    ok: true,
    cages: prepared.map((cage, index) => ({
      ...cage,
      facilityCageId: facilityCageIds[index],
    })),
  };
}

async function prepareExistingDestinations(
  tx: Prisma.TransactionClient,
  destinationIds: string[],
  actor: LabActor,
): Promise<
  | { ok: true; cages: Map<string, PreparedDestination> }
  | { ok: false; message: string }
> {
  const access = await getActorLabAccess(actor, tx);
  const cages = await tx.cage.findMany({
    where: { id: { in: destinationIds } },
    select: {
      id: true,
      barcode: true,
      labId: true,
      active: true,
      status: true,
      capacityOverride: true,
      room: { select: { facility: { select: { maxCageOccupancy: true } } } },
      _count: { select: { animals: { where: { outcomeStatus: "alive" } } } },
      animals: {
        where: { outcomeStatus: "alive" },
        select: { id: true, sex: true },
      },
    },
  });

  if (cages.length !== new Set(destinationIds).size) {
    return {
      ok: false,
      message: "One or more destination cages could not be found.",
    };
  }

  const result = new Map<string, PreparedDestination>();
  for (const cage of cages) {
    if (!cage.labId || !canManageLab(access, cage.labId)) {
      return {
        ok: false,
        message: `You cannot assign animals to ${cage.barcode}.`,
      };
    }
    if (!cage.active || cage.status === "closed" || cage.status === "retired") {
      return {
        ok: false,
        message: `${cage.barcode} is not an active operational cage.`,
      };
    }

    result.set(cage.id, {
      id: cage.id,
      barcode: cage.barcode,
      labId: cage.labId,
      active: cage.active,
      status: cage.status,
      effectiveCapacity: resolveEffectiveCageCapacity(
        cage.room.facility.maxCageOccupancy,
        cage.capacityOverride,
      ),
      occupantCount: cage._count.animals,
      occupants: cage.animals,
    });
  }

  return { ok: true, cages: result };
}

async function createPreparedCages(
  tx: Prisma.TransactionClient,
  cages: PreparedCage[],
  actorId: string,
) {
  for (const cage of cages) {
    await tx.cage.create({
      data: {
        id: cage.id,
        facilityCageId: cage.facilityCageId,
        labId: cage.labId,
        roomId: cage.roomId,
        rackId: cage.rackId,
        cageNumber: cage.cageNumber,
        barcode: cage.barcode,
        capacityOverride: cage.capacityOverride,
        status: cage.status,
        active: true,
        notes: cage.notes,
        welfareFlags: [],
        lastUpdatedAt: cage.startDate,
      },
    });
    await tx.cageChargePeriod.create({
      data: {
        id: createId("charge-period"),
        cageId: cage.id,
        labId: cage.labId,
        categoryId: cage.chargeCategory.id,
        dailyRateCents: cage.chargeCategory.dailyRateCents,
        currencyCode: cage.chargeCategory.currencyCode,
        startedAt: cage.startDate,
        notes: "Charge period started when cage was created.",
      },
    });
    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId,
        entityType: "cage",
        entityId: cage.id,
        action: "create",
        newValue: {
          barcode: cage.barcode,
          labId: cage.labId,
          roomId: cage.roomId,
          rackId: cage.rackId,
          cageNumber: cage.cageNumber,
          capacityOverride: cage.capacityOverride,
          status: cage.status,
          chargeCategoryId: cage.chargeCategory.id,
        },
        timestamp: cage.startDate,
      },
    });
  }
}

function resolveDestinationId(
  destination: CageDestinationRef,
  newCageByClientId: Map<string, PreparedCage>,
) {
  return destination.kind === "new"
    ? (newCageByClientId.get(destination.clientId)?.id ?? null)
    : destination.cageId;
}

function buildIncomingCounts(destinations: CageDestinationRef[]) {
  return destinations.reduce<Map<string, number>>((counts, destination) => {
    const key = destinationKey(destination);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map());
}

function validateDestinationCapacities(
  preparedNewCages: PreparedCage[],
  existingCages: Map<string, PreparedDestination>,
  incomingByDestination: Map<string, number>,
  outgoingByCageId: Map<string, number> = new Map(),
) {
  for (const cage of preparedNewCages) {
    const incoming = incomingByDestination.get(`new:${cage.clientId}`) ?? 0;
    if (incoming > cage.effectiveCapacity) {
      return `Proposed cage ${cage.barcode} exceeds its ${cage.effectiveCapacity}-animal capacity.`;
    }
  }

  for (const cage of existingCages.values()) {
    const incoming = incomingByDestination.get(`existing:${cage.id}`) ?? 0;
    const outgoing = outgoingByCageId.get(cage.id) ?? 0;
    const projected = cage.occupantCount - outgoing + incoming;
    if (projected > cage.effectiveCapacity) {
      const available = Math.max(
        0,
        cage.effectiveCapacity - cage.occupantCount + outgoing,
      );
      return `${cage.barcode} has capacity for ${available} more ${available === 1 ? "animal" : "animals"}.`;
    }
  }

  return null;
}

function validateDestinationReferences(
  destinations: CageDestinationRef[],
  preparedNewCages: PreparedCage[],
  existingCages: Map<string, PreparedDestination>,
) {
  const newClientIds = new Set(preparedNewCages.map((cage) => cage.clientId));

  for (const destination of destinations) {
    if (destination.kind === "new" && !newClientIds.has(destination.clientId)) {
      return "One or more assignments reference a proposed cage that is not in this plan.";
    }
    if (
      destination.kind === "existing" &&
      !existingCages.has(destination.cageId)
    ) {
      return "One or more assignments reference an unavailable existing cage.";
    }
  }

  return null;
}

function assignmentRuleDestinations(
  preparedNewCages: PreparedCage[],
  existingCages: Map<string, PreparedDestination>,
): AssignmentRuleDestination[] {
  return [
    ...preparedNewCages.map((cage) => ({
      key: `new:${cage.clientId}`,
      label: cage.barcode,
      status: cage.status,
      occupants: [],
    })),
    ...[...existingCages.values()].map((cage) => ({
      key: `existing:${cage.id}`,
      label: cage.barcode,
      status: cage.status as AssignmentRuleDestination["status"],
      occupants: cage.occupants,
    })),
  ];
}

async function mixedSexHoldingAllowed(tx: Prisma.TransactionClient) {
  const rule = await tx.ruleConfig.findUnique({
    where: { key: "mixed_sex_holding_allowed" },
    select: { value: true },
  });
  return rule?.value === true;
}

export async function createCageWithAssignments(
  input: CageAssignmentPlan,
  actor: LabActor,
  transaction?: Prisma.TransactionClient,
): Promise<MutationResult> {
  if (!canManageCageIntake(actor.role)) {
    return {
      ok: false,
      message: "Your role cannot create cages or assign animals.",
    };
  }
  if (!input.cages.length)
    return { ok: false, message: "Add at least one cage to the plan." };

  const movedAt = parseCageIntakeDate(input.movedAt, "assignment date");
  const reason = input.reason.trim();
  if (!movedAt.ok) return movedAt;
  if (reason.length < 3)
    return {
      ok: false,
      message: "Enter a concise reason for the cage assignment.",
    };
  if (
    new Set(input.assignments.map((assignment) => assignment.subjectId))
      .size !== input.assignments.length
  ) {
    return {
      ok: false,
      message: "Each animal can only be assigned once in a cage plan.",
    };
  }

  const operation = async (
    tx: Prisma.TransactionClient,
  ): Promise<MutationResult> => {
    const incoming = buildIncomingCounts(
      input.assignments.map((assignment) => assignment.destination),
    );
    const prepared = await prepareNewCages(tx, input.cages, actor, incoming);
    if (!prepared.ok) return prepared;

    const existingDestinationIds = input.assignments.flatMap((assignment) =>
      assignment.destination.kind === "existing"
        ? [assignment.destination.cageId]
        : [],
    );
    const existingDestinations = await prepareExistingDestinations(
      tx,
      existingDestinationIds,
      actor,
    );
    if (!existingDestinations.ok) return existingDestinations;

    const animals = input.assignments.length
      ? await tx.animal.findMany({
          where: {
            id: {
              in: input.assignments.map((assignment) => assignment.subjectId),
            },
          },
          select: {
            id: true,
            animalId: true,
            sex: true,
            outcomeStatus: true,
            currentCageId: true,
            owningLabId: true,
            currentCage: { select: { id: true, barcode: true, labId: true } },
          },
        })
      : [];
    if (animals.length !== input.assignments.length) {
      return {
        ok: false as const,
        message: "One or more selected animals could not be found.",
      };
    }

    const animalById = new Map(animals.map((animal) => [animal.id, animal]));
    const outgoing = animals.reduce<Map<string, number>>((counts, animal) => {
      if (animal.currentCageId)
        counts.set(
          animal.currentCageId,
          (counts.get(animal.currentCageId) ?? 0) + 1,
        );
      return counts;
    }, new Map());
    const capacityError = validateDestinationCapacities(
      prepared.cages,
      existingDestinations.cages,
      incoming,
      outgoing,
    );
    if (capacityError) return { ok: false as const, message: capacityError };

    const newCageByClientId = new Map(
      prepared.cages.map((cage) => [cage.clientId, cage]),
    );
    const destinationError = validateDestinationReferences(
      input.assignments.map((assignment) => assignment.destination),
      prepared.cages,
      existingDestinations.cages,
    );
    if (destinationError)
      return { ok: false as const, message: destinationError };

    for (const assignment of input.assignments) {
      const animal = animalById.get(assignment.subjectId);
      const destinationId = resolveDestinationId(
        assignment.destination,
        newCageByClientId,
      );
      const destination =
        assignment.destination.kind === "new"
          ? newCageByClientId.get(assignment.destination.clientId)
          : existingDestinations.cages.get(assignment.destination.cageId);
      if (!animal || !destinationId || !destination) {
        return {
          ok: false as const,
          message: "Every selected animal needs a valid destination cage.",
        };
      }
      if (
        animal.outcomeStatus !== "alive" ||
        !animal.currentCageId ||
        !animal.currentCage
      ) {
        return {
          ok: false as const,
          message: `${animal.animalId} is not an assignable live colony animal.`,
        };
      }
      if (animal.currentCageId === destinationId) {
        return {
          ok: false as const,
          message: `${animal.animalId} is already in ${destination.barcode}.`,
        };
      }
      const sourceLabId = animal.currentCage.labId ?? animal.owningLabId;
      if (sourceLabId && sourceLabId !== destination.labId) {
        return {
          ok: false as const,
          message:
            "Use the cross-lab transfer approval workflow to change animal ownership.",
        };
      }
    }

    const ruleDestinations = assignmentRuleDestinations(
      prepared.cages,
      existingDestinations.cages,
    );
    const quarantineError = validateQuarantineAssignments({
      workflow: "new",
      destinations: ruleDestinations,
      usedDestinationKeys: new Set(
        input.assignments.map((assignment) =>
          destinationKey(assignment.destination),
        ),
      ),
    });
    if (quarantineError)
      return { ok: false as const, message: quarantineError };
    const sexError = validateProjectedSexComposition({
      destinations: ruleDestinations,
      incoming: input.assignments.flatMap((assignment) => {
        const animal = animalById.get(assignment.subjectId);
        return animal
          ? [
              {
                subjectId: animal.id,
                sex: animal.sex,
                destinationKey: destinationKey(assignment.destination),
              },
            ]
          : [];
      }),
      outgoingSubjectIds: new Set(animals.map((animal) => animal.id)),
      mixedSexHoldingAllowed: await mixedSexHoldingAllowed(tx),
    });
    if (sexError) return { ok: false as const, message: sexError };

    await createPreparedCages(tx, prepared.cages, actor.id);

    for (const assignment of input.assignments) {
      const animal = animalById.get(assignment.subjectId);
      const destinationId = resolveDestinationId(
        assignment.destination,
        newCageByClientId,
      );
      const destination =
        assignment.destination.kind === "new"
          ? newCageByClientId.get(assignment.destination.clientId)
          : existingDestinations.cages.get(assignment.destination.cageId);
      if (!animal || !destinationId || !destination || !animal.currentCageId)
        continue;
      await tx.animal.update({
        where: { id: animal.id },
        data: { currentCageId: destinationId, owningLabId: destination.labId },
      });
      await tx.animalMovement.create({
        data: {
          id: createId("animal-move"),
          animalId: animal.id,
          fromCageId: animal.currentCageId,
          toCageId: destinationId,
          movedById: actor.id,
          movedAt: movedAt.date,
          reason,
        },
      });
    }

    await tx.cage.updateMany({
      where: {
        id: {
          in: [
            ...prepared.cages.map((cage) => cage.id),
            ...existingDestinationIds,
          ],
        },
      },
      data: { lastUpdatedAt: movedAt.date },
    });

    return {
      ok: true as const,
      message: `${prepared.cages.length} ${prepared.cages.length === 1 ? "cage" : "cages"} created${
        input.assignments.length
          ? ` and ${input.assignments.length} animals assigned`
          : ""
      }.`,
      entityId: prepared.cages[0]?.id,
      createdCageIds: prepared.cages.map((cage) => cage.id),
    };
  };
  return transaction
    ? operation(transaction)
    : runSerializableTransaction(operation);
}

export async function weanLitterWithCagePlan(
  input: WeanLitterWithCagePlanInput,
  actor: LabActor,
  transaction?: Prisma.TransactionClient,
): Promise<MutationResult> {
  if (!canManageCageIntake(actor.role)) {
    return { ok: false, message: "Your role cannot record litter weaning." };
  }
  if (!input.pups.length)
    return { ok: false, message: "Add at least one pup to the weaning plan." };
  if (new Set(input.pups.map((pup) => pup.rowId)).size !== input.pups.length) {
    return { ok: false, message: "Each pup row must be unique." };
  }
  const weanDate = parseCageIntakeDate(input.weanDate, "weaning date");
  if (!weanDate.ok) return weanDate;
  const operation = async (
    tx: Prisma.TransactionClient,
  ): Promise<MutationResult> => {
    const actorAccess = await getActorLabAccess(actor, tx);
    const [litter, strain, existingAnimals] = await Promise.all([
      tx.litter.findUnique({
        where: { id: input.litterId },
        select: {
          id: true,
          birthDate: true,
          litterSizeBirth: true,
          litterSizeWean: true,
          breedingSetup: {
            select: {
              labId: true,
              adults: {
                select: {
                  role: true,
                  animal: {
                    select: {
                      id: true,
                      projectSummary: true,
                      owningLabId: true,
                    },
                  },
                },
              },
            },
          },
          _count: { select: { litterAnimals: true } },
        },
      }),
      tx.strain.findUnique({
        where: { id: input.strainId },
        select: { id: true },
      }),
      tx.animal.findMany({ select: { animalId: true, labId: true } }),
    ]);
    if (!litter) return { ok: false as const, message: "Litter not found." };
    if (!strain)
      return { ok: false as const, message: "Choose a valid strain." };
    if (litter.litterSizeWean !== null || litter._count.litterAnimals > 0) {
      return {
        ok: false as const,
        message: "This litter already has a recorded weaning outcome.",
      };
    }
    if (weanDate.date < litter.birthDate) {
      return {
        ok: false as const,
        message: "Weaning date cannot be earlier than the litter birth date.",
      };
    }
    if (input.pups.length > litter.litterSizeBirth) {
      return {
        ok: false as const,
        message: "Weaning count cannot exceed litter size at birth.",
      };
    }
    const parentLabIds = Array.from(
      new Set(
        litter.breedingSetup.adults
          .map((adult) => adult.animal.owningLabId)
          .filter((labId): labId is string => Boolean(labId)),
      ),
    );
    const breedingLabId = litter.breedingSetup.labId;
    if (
      parentLabIds.length !== 1 ||
      parentLabIds[0] !== breedingLabId ||
      !canManageLab(actorAccess, breedingLabId)
    ) {
      return {
        ok: false as const,
        message: "You cannot wean a litter owned by another lab.",
      };
    }

    const incoming = buildIncomingCounts(
      input.pups.map((pup) => pup.destination),
    );
    const prepared = await prepareNewCages(
      tx,
      input.cages.map((cage) => ({
        ...cage,
        startDate: input.weanDate,
        status: "active",
      })),
      actor,
      incoming,
    );
    if (!prepared.ok) return prepared;
    const existingIds = input.pups.flatMap((pup) =>
      pup.destination.kind === "existing" ? [pup.destination.cageId] : [],
    );
    const existingDestinations = await prepareExistingDestinations(
      tx,
      existingIds,
      actor,
    );
    if (!existingDestinations.ok) return existingDestinations;
    const destinationError = validateDestinationReferences(
      input.pups.map((pup) => pup.destination),
      prepared.cages,
      existingDestinations.cages,
    );
    if (destinationError)
      return { ok: false as const, message: destinationError };
    const destinationLabIds = new Set([
      ...prepared.cages.map((cage) => cage.labId),
      ...[...existingDestinations.cages.values()].map((cage) => cage.labId),
    ]);
    if ([...destinationLabIds].some((labId) => labId !== breedingLabId)) {
      return {
        ok: false as const,
        message: "Wean progeny into cages owned by the breeding setup's lab.",
      };
    }
    const capacityError = validateDestinationCapacities(
      prepared.cages,
      existingDestinations.cages,
      incoming,
    );
    if (capacityError) return { ok: false as const, message: capacityError };

    const ruleDestinations = assignmentRuleDestinations(
      prepared.cages,
      existingDestinations.cages,
    );
    const quarantineError = validateQuarantineAssignments({
      workflow: "wean",
      destinations: ruleDestinations,
      usedDestinationKeys: new Set(
        input.pups.map((pup) => destinationKey(pup.destination)),
      ),
    });
    if (quarantineError)
      return { ok: false as const, message: quarantineError };
    const sexError = validateProjectedSexComposition({
      destinations: ruleDestinations,
      incoming: input.pups.map((pup) => ({
        subjectId: pup.rowId,
        sex: pup.sex,
        destinationKey: destinationKey(pup.destination),
      })),
      mixedSexHoldingAllowed: await mixedSexHoldingAllowed(tx),
    });
    if (sexError) return { ok: false as const, message: sexError };

    const newCageByClientId = new Map(
      prepared.cages.map((cage) => [cage.clientId, cage]),
    );
    const destinations = input.pups.map((pup) => ({
      ...pup,
      cageId: resolveDestinationId(pup.destination, newCageByClientId),
    }));
    if (destinations.some((destination) => !destination.cageId)) {
      return {
        ok: false as const,
        message: "Every pup must have a valid destination cage.",
      };
    }

    const sire =
      litter.breedingSetup.adults.find((adult) => adult.role === "sire")
        ?.animal ?? null;
    const dam =
      litter.breedingSetup.adults.find((adult) => adult.role === "dam")
        ?.animal ?? null;
    const projectSummaries = new Set(
      litter.breedingSetup.adults
        .map((adult) => adult.animal.projectSummary)
        .filter((value): value is string => Boolean(value)),
    );
    const projectSummary =
      projectSummaries.size === 1 ? [...projectSummaries][0] : null;
    const identifiers = buildNextAnimalIdentifiers(
      existingAnimals,
      litter.birthDate.getUTCFullYear(),
      input.pups.length,
    );
    const facilityAnimalIds = await allocateFacilityIdentifiers(
      tx,
      "animal",
      input.pups.length,
    );
    const animals = destinations.map((pup, index) => ({
      id: createId("animal"),
      facilityAnimalId: facilityAnimalIds[index],
      ...pup,
      identifiers: identifiers[index],
    }));

    await createPreparedCages(tx, prepared.cages, actor.id);
    for (const animal of animals) {
      const destination =
        animal.destination.kind === "new"
          ? newCageByClientId.get(animal.destination.clientId)
          : existingDestinations.cages.get(animal.destination.cageId);
      if (!destination || !animal.cageId) continue;
      await tx.animal.create({
        data: {
          id: animal.id,
          facilityAnimalId: animal.facilityAnimalId,
          animalId: animal.identifiers.animalId,
          labId: animal.identifiers.labId,
          owningLabId: destination.labId,
          sex: animal.sex,
          dob: litter.birthDate,
          strainId: strain.id,
          currentCageId: animal.cageId,
          status: "weaned",
          originType: `litter ${litter.id}`,
          sireId: sire?.id,
          damId: dam?.id,
          healthStatus: "Healthy",
          projectSummary,
          experimentalStatus: "Awaiting genotype",
          outcomeStatus: "alive",
          notes: `Created during weaning from ${litter.id}.`,
        },
      });
      await tx.litterAnimal.create({
        data: {
          id: createId("litter-animal"),
          litterId: litter.id,
          animalId: animal.id,
        },
      });
      await tx.animalStatusEvent.create({
        data: {
          id: createId("status"),
          animalId: animal.id,
          toStatus: "weaned",
          happenedAt: weanDate.date,
          actorId: actor.id,
          reason: `Weaned from ${litter.id} into ${destination.barcode}.`,
        },
      });
    }
    await tx.litter.update({
      where: { id: litter.id },
      data: { litterSizeWean: animals.length },
    });
    await tx.cage.updateMany({
      where: {
        id: {
          in: Array.from(
            new Set(destinations.map((destination) => destination.cageId!)),
          ),
        },
      },
      data: { lastUpdatedAt: weanDate.date },
    });
    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "litter",
        entityId: litter.id,
        action: "wean",
        previousValue: {
          litterSizeWean: litter.litterSizeWean,
          progenyCount: litter._count.litterAnimals,
        },
        newValue: {
          litterSizeWean: animals.length,
          cageIds: destinations.map((destination) => destination.cageId),
          animalIds: animals.map((animal) => animal.identifiers.animalId),
        },
        timestamp: weanDate.date,
      },
    });

    return {
      ok: true as const,
      message: `${animals.length} pups were weaned into ${new Set(destinations.map((item) => item.cageId)).size} cages.`,
      entityId: litter.id,
      createdCageIds: prepared.cages.map((cage) => cage.id),
    };
  };
  return transaction
    ? operation(transaction)
    : runSerializableTransaction(operation);
}

export async function receivePurchasedAnimals(
  input: ReceivePurchasedAnimalsInput,
  actor: LabActor,
  transaction?: Prisma.TransactionClient,
): Promise<MutationResult> {
  if (!canManageCageIntake(actor.role)) {
    return {
      ok: false,
      message: "Your role cannot receive purchased animals.",
    };
  }
  const vendor = input.vendor.trim();
  const orderReference = input.orderReference.trim();
  const arrivalDate = parseCageIntakeDate(input.arrivalDate, "arrival date");
  if (vendor.length < 2)
    return { ok: false, message: "Enter the vendor or source." };
  if (orderReference.length < 2)
    return { ok: false, message: "Enter the order or receipt reference." };
  if (!arrivalDate.ok) return arrivalDate;
  if (!input.animals.length)
    return { ok: false, message: "Add at least one purchased animal." };
  if (
    new Set(input.animals.map((animal) => animal.rowId)).size !==
    input.animals.length
  ) {
    return { ok: false, message: "Each purchased animal row must be unique." };
  }
  const sourceIds = input.animals
    .map((animal) => animal.sourceAnimalId?.trim())
    .filter((id): id is string => Boolean(id));
  if (new Set(sourceIds).size !== sourceIds.length) {
    return {
      ok: false,
      message: "Vendor animal IDs must be unique within a delivery.",
    };
  }

  const operation = async (
    tx: Prisma.TransactionClient,
  ): Promise<MutationResult> => {
    const access = await getActorLabAccess(actor, tx);
    if (!canManageLab(access, input.labId)) {
      return {
        ok: false,
        message: "You can only receive animals for labs you manage.",
      };
    }
    const lab = await tx.lab.findUnique({
      where: { id: input.labId },
      select: { id: true, active: true },
    });
    if (!lab?.active)
      return { ok: false as const, message: "Choose an active owning lab." };

    const incoming = buildIncomingCounts(
      input.animals.map((animal) => animal.destination),
    );
    if (input.cages.some((cage) => cage.labId !== input.labId)) {
      return {
        ok: false as const,
        message: "Purchased intake cages must belong to the receiving lab.",
      };
    }
    const prepared = await prepareNewCages(
      tx,
      input.cages.map((cage) => ({
        ...cage,
        labId: input.labId,
        startDate: input.arrivalDate,
        status: input.disposition === "quarantine" ? "quarantine" : "active",
      })),
      actor,
      incoming,
    );
    if (!prepared.ok) return prepared;
    const existingIds = input.animals.flatMap((animal) =>
      animal.destination.kind === "existing" ? [animal.destination.cageId] : [],
    );
    const existingDestinations = await prepareExistingDestinations(
      tx,
      existingIds,
      actor,
    );
    if (!existingDestinations.ok) return existingDestinations;
    const destinationError = validateDestinationReferences(
      input.animals.map((animal) => animal.destination),
      prepared.cages,
      existingDestinations.cages,
    );
    if (destinationError)
      return { ok: false as const, message: destinationError };
    if (
      [...existingDestinations.cages.values()].some(
        (cage) => cage.labId !== input.labId,
      )
    ) {
      return {
        ok: false as const,
        message:
          "Purchased animals must be assigned to cages in the receiving lab.",
      };
    }
    const capacityError = validateDestinationCapacities(
      prepared.cages,
      existingDestinations.cages,
      incoming,
    );
    if (capacityError) return { ok: false as const, message: capacityError };

    const ruleDestinations = assignmentRuleDestinations(
      prepared.cages,
      existingDestinations.cages,
    );
    const quarantineError = validateQuarantineAssignments({
      workflow: "purchase",
      disposition: input.disposition,
      destinations: ruleDestinations,
      usedDestinationKeys: new Set(
        input.animals.map((animal) => destinationKey(animal.destination)),
      ),
    });
    if (quarantineError)
      return { ok: false as const, message: quarantineError };
    const sexError = validateProjectedSexComposition({
      destinations: ruleDestinations,
      incoming: input.animals.map((animal) => ({
        subjectId: animal.rowId,
        sex: animal.sex,
        destinationKey: destinationKey(animal.destination),
      })),
      mixedSexHoldingAllowed: await mixedSexHoldingAllowed(tx),
    });
    if (sexError) return { ok: false as const, message: sexError };

    const strainIds = Array.from(
      new Set(input.animals.map((animal) => animal.strainId)),
    );
    const strains = await tx.strain.findMany({
      where: { id: { in: strainIds } },
      select: { id: true },
    });
    if (strains.length !== strainIds.length)
      return {
        ok: false as const,
        message: "Choose a valid strain for every row.",
      };
    for (const row of input.animals) {
      const dob = parseCageIntakeDate(row.dob, "date of birth");
      if (!dob.ok)
        return {
          ok: false as const,
          message: `Row ${row.rowId}: ${dob.message}`,
        };
      if (dob.date > arrivalDate.date) {
        return {
          ok: false as const,
          message: `Row ${row.rowId}: date of birth cannot be after arrival.`,
        };
      }
    }

    const existingAnimals = await tx.animal.findMany({
      select: { animalId: true, labId: true },
    });
    const identifiers = buildNextAnimalIdentifiers(
      existingAnimals,
      arrivalDate.date.getUTCFullYear(),
      input.animals.length,
    );
    const facilityAnimalIds = await allocateFacilityIdentifiers(
      tx,
      "animal",
      input.animals.length,
    );
    const batchId = input.batchId ?? createId("intake");
    const newCageByClientId = new Map(
      prepared.cages.map((cage) => [cage.clientId, cage]),
    );
    await createPreparedCages(tx, prepared.cages, actor.id);
    await tx.animalIntakeBatch.create({
      data: {
        id: batchId,
        labId: input.labId,
        vendor,
        orderReference,
        arrivalDate: arrivalDate.date,
        disposition: input.disposition,
        notes: input.notes?.trim() || null,
        createdById: actor.id,
      },
    });

    const createdAnimalIds: string[] = [];
    const touchedCageIds = new Set<string>();
    for (const [index, row] of input.animals.entries()) {
      const destination =
        row.destination.kind === "new"
          ? newCageByClientId.get(row.destination.clientId)
          : existingDestinations.cages.get(row.destination.cageId);
      const destinationId = resolveDestinationId(
        row.destination,
        newCageByClientId,
      );
      if (!destination || !destinationId) continue;
      const id = createId("animal");
      createdAnimalIds.push(id);
      touchedCageIds.add(destinationId);
      await tx.animal.create({
        data: {
          id,
          facilityAnimalId: facilityAnimalIds[index],
          animalId: identifiers[index].animalId,
          labId: identifiers[index].labId,
          owningLabId: input.labId,
          intakeBatchId: batchId,
          sourceAnimalId: row.sourceAnimalId?.trim() || null,
          sex: row.sex,
          dob: new Date(row.dob),
          strainId: row.strainId,
          currentCageId: destinationId,
          status: "colony_holding",
          originType: `purchased from ${vendor}`,
          healthStatus:
            input.disposition === "quarantine"
              ? "Quarantine intake"
              : "Healthy",
          experimentalStatus: "Not assigned",
          outcomeStatus: "alive",
          notes: row.healthNotes?.trim() || null,
        },
      });
      await tx.animalStatusEvent.create({
        data: {
          id: createId("status"),
          animalId: id,
          toStatus: "colony_holding",
          happenedAt: arrivalDate.date,
          actorId: actor.id,
          reason: `Received from ${vendor}, order ${orderReference}, into ${destination.barcode}.`,
        },
      });
    }

    await tx.cage.updateMany({
      where: { id: { in: [...touchedCageIds] } },
      data: { lastUpdatedAt: arrivalDate.date },
    });
    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "animal_intake_batch",
        entityId: batchId,
        action: "create",
        newValue: {
          labId: input.labId,
          vendor,
          orderReference,
          disposition: input.disposition,
          animalCount: createdAnimalIds.length,
          cageIds: [...touchedCageIds],
        },
        timestamp: arrivalDate.date,
      },
    });

    return {
      ok: true as const,
      message: `${createdAnimalIds.length} purchased animals received into ${touchedCageIds.size} cages.`,
      entityId: batchId,
      createdCageIds: prepared.cages.map((cage) => cage.id),
    };
  };
  return transaction
    ? operation(transaction)
    : runSerializableTransaction(operation);
}

export type CageIntakeCommand =
  | { mode: "new"; payload: CageAssignmentPlan }
  | { mode: "wean"; payload: WeanLitterWithCagePlanInput }
  | { mode: "purchase"; payload: ReceivePurchasedAnimalsInput };

function commandLabId(command: CageIntakeCommand, actor: ResolvedActor) {
  if (command.mode === "purchase") return command.payload.labId;
  const proposedLabs = [
    ...new Set(command.payload.cages.map((cage) => cage.labId).filter(Boolean)),
  ];
  return proposedLabs.length === 1 ? proposedLabs[0] : actor.activeLabId;
}

export async function executeCageIntakeCommand(input: {
  command: CageIntakeCommand;
  actor: ResolvedActor;
  idempotencyKey: string;
  requestId: string;
  workflowDraftId?: string | null;
  reviewSnapshotId?: string | null;
  expectedVersion?: number;
}) {
  const labId = commandLabId(input.command, input.actor);
  const purchaseBatchId =
    input.command.mode === "purchase" ? createId("intake") : null;
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: `cage_intake.${input.command.mode}`,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: {
      command: input.command,
      reviewSnapshotId: input.reviewSnapshotId,
    } as unknown as Prisma.InputJsonValue,
    requiredCapability: "cages:manage",
    labId,
    workflowDraftId: input.workflowDraftId,
    aggregateType:
      input.command.mode === "wean"
        ? "litter"
        : input.command.mode === "purchase"
          ? "intake_batch"
          : undefined,
    aggregateId:
      input.command.mode === "wean"
        ? input.command.payload.litterId
        : (purchaseBatchId ?? undefined),
    expectedVersion:
      input.command.mode === "wean" ? input.expectedVersion : undefined,
    handler: async (tx, context) => {
      if (!input.workflowDraftId || !input.reviewSnapshotId) {
        return {
          ok: false as const,
          code: "invalid_review",
          message: "Create an intake review snapshot before confirming.",
        };
      }
      const snapshot = await tx.workflowReviewSnapshot.findUnique({
        where: { id: input.reviewSnapshotId },
        include: { draft: true },
      });
      const reviewedPayload = snapshot
        ? cageIntakeDraftPayloadSchema.safeParse(snapshot.payload)
        : null;
      if (
        !snapshot ||
        snapshot.draftId !== input.workflowDraftId ||
        snapshot.createdById !== input.actor.id ||
        snapshot.draft.actorId !== input.actor.id ||
        snapshot.draft.labId !== labId ||
        snapshot.draft.status !== "review" ||
        snapshot.draft.version !== snapshot.draftVersion + 1 ||
        canonicalJsonHash(snapshot.payload) !== snapshot.payloadHash ||
        !reviewedPayload?.success ||
        canonicalJsonHash(reviewedPayload.data.command) !==
          canonicalJsonHash(input.command)
      ) {
        return {
          ok: false as const,
          code: "invalid_review",
          message: "The reviewed intake changed. Refresh and review it again.",
        };
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
        return {
          ok: false as const,
          code: "stale_conflict",
          message: "The intake review changed before it could be submitted.",
        };
      }
      const operationalActor = {
        id: input.actor.id,
        role: input.actor.role,
        activeLabId: input.actor.activeLabId,
      };
      const result =
        input.command.mode === "new"
          ? await createCageWithAssignments(
              input.command.payload,
              operationalActor,
              tx,
            )
          : await withM13MutationSavepoint(tx, async () => {
              if (input.command.mode === "wean") {
                const litter = await tx.litter.findUnique({
                  where: { id: input.command.payload.litterId },
                  select: {
                    protocolCountAllocationId: true,
                    protocolCountAllocation: {
                      select: {
                        reservedQuantity: true,
                        consumedQuantity: true,
                        releasedQuantity: true,
                      },
                    },
                    breedingSetup: {
                      select: { labId: true, protocolAuthorizationId: true },
                    },
                  },
                });
                if (
                  !litter?.protocolCountAllocationId ||
                  !litter.protocolCountAllocation
                ) {
                  return {
                    ok: false as const,
                    message:
                      "The litter has no exact protocol count reservation.",
                  };
                }
                const remaining =
                  litter.protocolCountAllocation.reservedQuantity -
                  litter.protocolCountAllocation.consumedQuantity -
                  litter.protocolCountAllocation.releasedQuantity;
                if (remaining < input.command.payload.pups.length) {
                  return {
                    ok: false as const,
                    message:
                      "The litter protocol reservation no longer covers this weaning.",
                  };
                }
                const compliance = await evaluateAndWriteComplianceEvidence(
                  tx,
                  {
                    actor: input.actor,
                    receiptId: context.receiptId,
                    commandType: "cage_intake.wean",
                    labId: litter.breedingSetup.labId,
                    aggregateType: "litter",
                    aggregateId: input.command.payload.litterId,
                    protocolAuthorizationId:
                      input.command.payload.protocolAuthorizationId ??
                      litter.breedingSetup.protocolAuthorizationId,
                    strainIds: [input.command.payload.strainId],
                    procedureCode: "intake",
                    requiredPersonnelRoles: ["intake_operator"],
                    countOperation: "consume",
                    quantity: input.command.payload.pups.length,
                    sourceAllocationId: litter.protocolCountAllocationId,
                    allocationKey: `litter:${input.command.payload.litterId}:wean:consume`,
                    evidenceKey: "wean-consume",
                  },
                );
                if (!compliance.ok)
                  return { ok: false as const, message: compliance.message };
                const mutation = await weanLitterWithCagePlan(
                  input.command.payload,
                  operationalActor,
                  tx,
                );
                if (!mutation.ok) return mutation;
                const mortality = remaining - input.command.payload.pups.length;
                if (mortality > 0) {
                  const released = await releaseProtocolReservation(tx, {
                    actor: input.actor,
                    receiptId: context.receiptId,
                    protocolAuthorizationId: compliance.protocolAuthorizationId,
                    allocationId: litter.protocolCountAllocationId,
                    quantity: mortality,
                    allocationKey: `litter:${input.command.payload.litterId}:wean:release`,
                    aggregateType: "litter",
                    aggregateId: input.command.payload.litterId,
                  });
                  if (!released.ok)
                    return { ok: false as const, message: released.message };
                }
                return mutation;
              }
              if (!purchaseBatchId)
                return {
                  ok: false as const,
                  message: "The intake batch identity is unavailable.",
                };
              if (input.command.mode !== "purchase") {
                return {
                  ok: false as const,
                  message:
                    "Only animal intake requires protocol count settlement.",
                };
              }
              const payload = input.command.payload;
              const reserved = await evaluateAndWriteComplianceEvidence(tx, {
                actor: input.actor,
                receiptId: context.receiptId,
                commandType: "cage_intake.purchase",
                labId: payload.labId,
                aggregateType: "intake_batch",
                aggregateId: purchaseBatchId,
                protocolAuthorizationId: payload.protocolAuthorizationId,
                strainIds: payload.animals.map((animal) => animal.strainId),
                procedureCode: "intake",
                requiredPersonnelRoles: ["intake_operator"],
                countOperation: "reserve",
                quantity: payload.animals.length,
                allocationKey: `intake_batch:${purchaseBatchId}:reserve`,
                evidenceKey: "reserve",
              });
              if (!reserved.ok)
                return { ok: false as const, message: reserved.message };
              if (!reserved.allocationId)
                return {
                  ok: false as const,
                  message: "The intake reservation could not be frozen.",
                };
              const mutation = await receivePurchasedAnimals(
                { ...payload, batchId: purchaseBatchId },
                operationalActor,
                tx,
              );
              if (!mutation.ok) return mutation;
              const consumed = await evaluateAndWriteComplianceEvidence(tx, {
                actor: input.actor,
                receiptId: context.receiptId,
                commandType: "cage_intake.purchase",
                labId: payload.labId,
                aggregateType: "intake_batch",
                aggregateId: purchaseBatchId,
                protocolAuthorizationId: reserved.protocolAuthorizationId,
                strainIds: payload.animals.map((animal) => animal.strainId),
                procedureCode: "intake",
                requiredPersonnelRoles: ["intake_operator"],
                countOperation: "consume",
                quantity: payload.animals.length,
                sourceAllocationId: reserved.allocationId,
                allocationKey: `intake_batch:${purchaseBatchId}:consume`,
                evidenceKey: "consume",
              });
              if (!consumed.ok)
                return { ok: false as const, message: consumed.message };
              await tx.animalIntakeBatch.update({
                where: { id: purchaseBatchId },
                data: {
                  protocolAuthorizationId: consumed.protocolAuthorizationId,
                  complianceEvidenceSnapshotId: consumed.evidenceSnapshotId,
                  protocolCountAllocationId: reserved.allocationId,
                },
              });
              return mutation;
            });
      if (!result.ok) {
        const restored = await tx.workflowDraft.updateMany({
          where: {
            id: snapshot.draftId,
            actorId: input.actor.id,
            status: "submitted",
            version: snapshot.draftVersion + 2,
          },
          data: { status: "review", submittedAt: null },
        });
        if (restored.count !== 1)
          throw new Error(
            "The failed intake review could not be restored atomically.",
          );
        return {
          ok: false as const,
          code: "validation_error",
          message: result.message,
        };
      }
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
      if (committed.count !== 1)
        throw new Error(
          "The reviewed intake could not be committed atomically.",
        );
      return {
        ok: true as const,
        result: {
          message: result.message,
          entityId: result.entityId ?? null,
          createdCageIds: result.createdCageIds ?? [],
        },
        aggregateType:
          input.command.mode === "wean"
            ? "litter"
            : input.command.mode === "purchase"
              ? "intake_batch"
              : "cage_intake",
        aggregateId: result.entityId,
      };
    },
  });
}
