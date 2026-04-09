import { prisma } from "@/lib/prisma";
import type { HealthNoteType, Sex, UserRole } from "@/lib/types";

type MutationResult =
  | {
      ok: true;
      message: string;
      entityId?: string;
    }
  | {
      ok: false;
      message: string;
    };

type CreateAnimalInput = {
  animalId: string;
  labId: string;
  sex: Sex;
  dob: string;
  strainId: string;
  cageId: string;
  projectId?: string;
  notes?: string;
};

type AddCageHealthNoteInput = {
  cageId: string;
  noteType: HealthNoteType;
  severity: "info" | "warning" | "critical";
  note: string;
  followupRequired: boolean;
  actionTaken?: string;
};

type ReserveAnimalInput = {
  animalId: string;
  experimentId: string;
  startDate: string;
  treatmentGroup?: string;
  notes?: string;
};

type CreateBreedingSetupInput = {
  sireId: string;
  damId: string;
  startDate: string;
  targetGenotype: string;
  targetSex?: Sex;
  notes?: string;
  allowOverride?: boolean;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function canCreateAnimal(role: UserRole) {
  return role === "admin" || role === "colony_manager" || role === "animal_staff";
}

function canCreateHealthNote(role: UserRole) {
  return role === "admin" || role === "colony_manager" || role === "animal_staff";
}

function canReserveAnimal(role: UserRole) {
  return role === "admin" || role === "colony_manager" || role === "researcher";
}

function canCreateBreeding(role: UserRole) {
  return role !== "read_only";
}

function getReferenceDate() {
  return process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString();
}

export async function createAnimalRecord(
  input: CreateAnimalInput,
  actor: { id: string; role: UserRole },
): Promise<MutationResult> {
  if (!canCreateAnimal(actor.role)) {
    return { ok: false, message: "Your role cannot create new animal records." };
  }

  const [existingAnimalId, existingLabId, cage, strain] = await prisma.$transaction([
    prisma.animal.findUnique({
      where: { animalId: input.animalId },
      select: {
        id: true,
        animalId: true,
        labId: true,
        currentCageId: true,
        strainId: true,
        projectSummary: true,
      },
    }),
    prisma.animal.findUnique({
      where: { labId: input.labId },
      select: {
        id: true,
        animalId: true,
        labId: true,
        currentCageId: true,
        strainId: true,
        projectSummary: true,
      },
    }),
    prisma.cage.findUnique({
      where: { id: input.cageId },
      select: { id: true, status: true, barcode: true },
    }),
    prisma.strain.findUnique({ where: { id: input.strainId }, select: { id: true } }),
  ]);
  const project = input.projectId
    ? await prisma.project.findUnique({
        where: { id: input.projectId },
        select: { id: true, projectCode: true },
      })
    : null;

  const matchingExistingRecord =
    existingAnimalId &&
    existingLabId &&
    existingAnimalId.id === existingLabId.id &&
    existingAnimalId.currentCageId === input.cageId &&
    existingAnimalId.strainId === input.strainId &&
    existingAnimalId.projectSummary === (project?.projectCode ?? null)
      ? existingAnimalId
      : null;

  if (matchingExistingRecord) {
    return {
      ok: true,
      message: `${input.animalId} was added to the active colony.`,
      entityId: matchingExistingRecord.id,
    };
  }

  if (existingAnimalId) {
    return { ok: false, message: "Animal ID already exists." };
  }

  if (existingLabId) {
    return { ok: false, message: "Lab ID already exists." };
  }

  if (!cage || cage.status === "closed" || cage.status === "retired") {
    return { ok: false, message: "Choose an active operational cage." };
  }

  if (!strain) {
    return { ok: false, message: "Choose a valid strain." };
  }

  if (input.projectId && !project) {
    return { ok: false, message: "Choose a valid project." };
  }

  const timestamp = new Date();
  const animalId = createId("animal");

  await prisma.$transaction(async (tx) => {
    await tx.animal.create({
      data: {
        id: animalId,
        animalId: input.animalId,
        labId: input.labId,
        sex: input.sex,
        dob: new Date(input.dob),
        strainId: input.strainId,
        currentCageId: input.cageId,
        status: "colony_holding",
        originType: "manual entry",
        healthStatus: "Healthy",
        projectSummary: project?.projectCode,
        experimentalStatus: "Not assigned",
        outcomeStatus: "alive",
        notes: input.notes?.trim() || undefined,
      },
    });

    if (project) {
      await tx.animalProjectAllocation.create({
        data: {
          id: createId("alloc"),
          animalId,
          projectId: project.id,
          startedAt: timestamp,
          chargeable: true,
          notes: "Created with initial project attribution.",
        },
      });
    }

    await tx.animalStatusEvent.create({
      data: {
        id: createId("status"),
        animalId,
        toStatus: "colony_holding",
        happenedAt: timestamp,
        actorId: actor.id,
        reason: "Animal record created from the colony table workspace.",
      },
    });

    await tx.cage.update({
      where: { id: input.cageId },
      data: { lastUpdatedAt: timestamp },
    });

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "animal",
        entityId: animalId,
        action: "create",
        newValue: {
          animalId: input.animalId,
          cageId: input.cageId,
          strainId: input.strainId,
          projectId: input.projectId,
        },
        timestamp,
      },
    });
  });

  return {
    ok: true,
    message: `${input.animalId} was added to the active colony.`,
    entityId: animalId,
  };
}

export async function addCageHealthNote(
  input: AddCageHealthNoteInput,
  actor: { id: string; role: UserRole },
): Promise<MutationResult> {
  if (!canCreateHealthNote(actor.role)) {
    return { ok: false, message: "Your role cannot add cage health notes." };
  }

  const cage = await prisma.cage.findUnique({
    where: { id: input.cageId },
    select: { id: true, barcode: true },
  });
  const existingNote = await prisma.healthNote.findFirst({
    where: {
      cageId: input.cageId,
      createdById: actor.id,
      noteType: input.noteType,
      severity: input.severity,
      note: input.note.trim(),
      followupRequired: input.followupRequired,
      actionTaken: input.actionTaken?.trim() || null,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });

  if (!cage) {
    return { ok: false, message: "Cage not found." };
  }

  const timestamp = new Date();
  if (existingNote && timestamp.getTime() - existingNote.createdAt.getTime() < 2 * 60 * 1000) {
    return {
      ok: true,
      message: `Health note logged for ${cage.barcode}.`,
      entityId: existingNote.id,
    };
  }

  const noteId = createId("health");

  await prisma.$transaction(async (tx) => {
    await tx.healthNote.create({
      data: {
        id: noteId,
        cageId: input.cageId,
        noteType: input.noteType,
        severity: input.severity,
        note: input.note.trim(),
        followupRequired: input.followupRequired,
        actionTaken: input.actionTaken?.trim() || undefined,
        resolved: false,
        createdById: actor.id,
        createdAt: timestamp,
      },
    });

    await tx.cage.update({
      where: { id: input.cageId },
      data: { lastUpdatedAt: timestamp },
    });

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "health_note",
        entityId: noteId,
        action: "create",
        newValue: {
          cageId: input.cageId,
          noteType: input.noteType,
          severity: input.severity,
          followupRequired: input.followupRequired,
        },
        timestamp,
      },
    });
  });

  return {
    ok: true,
    message: `Health note logged for ${cage.barcode}.`,
    entityId: noteId,
  };
}

export async function reserveAnimalForExperiment(
  input: ReserveAnimalInput,
  actor: { id: string; role: UserRole },
): Promise<MutationResult> {
  if (!canReserveAnimal(actor.role)) {
    return { ok: false, message: "Your role cannot reserve animals for experiments." };
  }

  const [animal, experiment, alleles, conflictingAssignment] = await prisma.$transaction([
    prisma.animal.findUnique({
      where: { id: input.animalId },
      select: {
        id: true,
        animalId: true,
        status: true,
        outcomeStatus: true,
        projectSummary: true,
      },
    }),
    prisma.experiment.findUnique({
      where: { id: input.experimentId },
      select: {
        id: true,
        experimentCode: true,
        projectId: true,
        project: {
          select: {
            projectCode: true,
          },
        },
        status: true,
      },
    }),
    prisma.animalAllele.findMany({
      where: { animalId: input.animalId },
      select: { callStatus: true },
    }),
    prisma.experimentAssignment.findFirst({
      where: {
        animalId: input.animalId,
        status: { in: ["reserved", "active"] },
      },
      select: {
        id: true,
        experimentId: true,
        status: true,
        treatmentGroup: true,
        startDate: true,
      },
    }),
  ]);

  if (!animal) {
    return { ok: false, message: "Animal not found." };
  }

  if (!experiment || experiment.status === "completed" || experiment.status === "cancelled") {
    return { ok: false, message: "Choose an active or planned experiment." };
  }

  const normalizedStartDate = new Date(input.startDate);
  const sameReservation =
    conflictingAssignment &&
    conflictingAssignment.experimentId === input.experimentId &&
    conflictingAssignment.status === "reserved" &&
    conflictingAssignment.treatmentGroup === (input.treatmentGroup?.trim() || null) &&
    conflictingAssignment.startDate.toISOString().slice(0, 10) === normalizedStartDate.toISOString().slice(0, 10);

  if (sameReservation) {
    return {
      ok: true,
      message: `${animal.animalId} reserved for ${experiment.experimentCode}.`,
      entityId: conflictingAssignment.id,
    };
  }

  if (animal.outcomeStatus !== "alive") {
    return { ok: false, message: "Only live animals can be reserved." };
  }

  if (animal.status !== "colony_holding") {
    return { ok: false, message: `${animal.animalId} is not available for a new reservation.` };
  }

  if (!alleles.length || alleles.some((allele) => allele.callStatus !== "confirmed")) {
    return { ok: false, message: `${animal.animalId} still needs genotype confirmation before reservation.` };
  }

  if (conflictingAssignment) {
    return { ok: false, message: `${animal.animalId} already has an active or reserved experiment assignment.` };
  }

  const timestamp = new Date();
  const assignmentId = createId("assign");
  const previousStatus = animal.status;

  await prisma.$transaction(async (tx) => {
    await tx.experimentAssignment.create({
      data: {
        id: assignmentId,
        animalId: animal.id,
        experimentId: experiment.id,
        status: "reserved",
        startDate: normalizedStartDate,
        treatmentGroup: input.treatmentGroup?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        isPrimary: true,
      },
    });

    await tx.animal.update({
      where: { id: animal.id },
      data: {
        status: "reserved",
        experimentalStatus: `Reserved for ${experiment.experimentCode}`,
        projectSummary: experiment.project.projectCode,
      },
    });

    const hasProjectAllocation = await tx.animalProjectAllocation.findFirst({
      where: {
        animalId: animal.id,
        projectId: experiment.projectId,
        endedAt: null,
      },
      select: { id: true },
    });

    if (!hasProjectAllocation) {
      await tx.animalProjectAllocation.create({
        data: {
          id: createId("alloc"),
          animalId: animal.id,
          projectId: experiment.projectId,
          startedAt: timestamp,
          chargeable: true,
          notes: `Added automatically during reservation for ${experiment.experimentCode}.`,
        },
      });
    }

    await tx.animalStatusEvent.create({
      data: {
        id: createId("status"),
        animalId: animal.id,
        fromStatus: previousStatus,
        toStatus: "reserved",
        happenedAt: timestamp,
        actorId: actor.id,
        reason: `Reserved for ${experiment.experimentCode}.`,
      },
    });

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "experiment_assignment",
        entityId: assignmentId,
        action: "reserve",
        previousValue: { animalStatus: previousStatus },
        newValue: {
          experimentId: experiment.id,
          startDate: input.startDate,
          treatmentGroup: input.treatmentGroup,
        },
        timestamp,
      },
    });
  });

  return {
    ok: true,
    message: `${animal.animalId} reserved for ${experiment.experimentCode}.`,
    entityId: assignmentId,
  };
}

export async function createBreedingSetup(
  input: CreateBreedingSetupInput,
  actor: { id: string; role: UserRole },
): Promise<MutationResult> {
  if (!canCreateBreeding(actor.role)) {
    return { ok: false, message: "Your role cannot create breeding setups." };
  }

  if (input.allowOverride && actor.role !== "admin") {
    return { ok: false, message: "Only admins can override duplicate breeding safeguards." };
  }

  if (input.sireId === input.damId) {
    return { ok: false, message: "Choose two different animals for the breeding setup." };
  }

  const [sire, dam, minAgeRule] = await prisma.$transaction([
    prisma.animal.findUnique({
      where: { id: input.sireId },
      include: {
        breedingAdults: {
          where: {
            breedingSetup: {
              status: { in: ["planned", "active", "paused"] },
            },
          },
          select: { id: true },
        },
      },
    }),
    prisma.animal.findUnique({
      where: { id: input.damId },
      include: {
        breedingAdults: {
          where: {
            breedingSetup: {
              status: { in: ["planned", "active", "paused"] },
            },
          },
          select: { id: true },
        },
      },
    }),
    prisma.ruleConfig.findUnique({
      where: { key: "breeder_min_age_days" },
      select: { value: true },
    }),
  ]);

  if (!sire || sire.outcomeStatus !== "alive") {
    return { ok: false, message: "Choose a live sire for the breeding setup." };
  }

  if (!dam || dam.outcomeStatus !== "alive") {
    return { ok: false, message: "Choose a live dam for the breeding setup." };
  }

  if (sire.sex !== "male") {
    return { ok: false, message: `${sire.animalId} is not marked as a male breeder.` };
  }

  if (dam.sex !== "female") {
    return { ok: false, message: `${dam.animalId} is not marked as a female breeder.` };
  }

  if (!sire.currentCageId || !dam.currentCageId) {
    return { ok: false, message: "Both breeders need an active cage assignment before starting breeding." };
  }

  const blockedStatuses = new Set([
    "in_experiment",
    "experiment_completed",
    "archived",
    "dead",
    "euthanized",
    "transferred_out",
  ]);

  if (blockedStatuses.has(sire.status)) {
    return { ok: false, message: `${sire.animalId} cannot enter breeding from its current lifecycle state.` };
  }

  if (blockedStatuses.has(dam.status)) {
    return { ok: false, message: `${dam.animalId} cannot enter breeding from its current lifecycle state.` };
  }

  if (!input.allowOverride) {
    if (sire.status === "breeding" || sire.breedingAdults.length > 0) {
      return { ok: false, message: `${sire.animalId} is already in an active breeding setup.` };
    }

    if (dam.status === "breeding" || dam.breedingAdults.length > 0) {
      return { ok: false, message: `${dam.animalId} is already in an active breeding setup.` };
    }
  }

  const breederMinAgeDays = Number(minAgeRule?.value ?? 0);
  const referenceDate = new Date(getReferenceDate());
  const sireAgeDays = Math.floor((referenceDate.getTime() - sire.dob.getTime()) / 86_400_000);
  const damAgeDays = Math.floor((referenceDate.getTime() - dam.dob.getTime()) / 86_400_000);

  if (sireAgeDays < breederMinAgeDays) {
    return {
      ok: false,
      message: `${sire.animalId} is not yet old enough for breeding under the configured threshold.`,
    };
  }

  if (damAgeDays < breederMinAgeDays) {
    return {
      ok: false,
      message: `${dam.animalId} is not yet old enough for breeding under the configured threshold.`,
    };
  }

  const timestamp = new Date();
  const breedingId = createId("breeding");
  const targetSex = input.targetSex && input.targetSex !== "unknown" ? input.targetSex : null;

  await prisma.$transaction(async (tx) => {
    await tx.breedingSetup.create({
      data: {
        id: breedingId,
        startDate: new Date(input.startDate),
        status: "active",
        targetGenotype: input.targetGenotype.trim(),
        targetSex,
        notes: input.notes?.trim() || undefined,
      },
    });

    await tx.breedingAdult.createMany({
      data: [
        { id: createId("breeding-adult"), breedingSetupId: breedingId, animalId: sire.id, role: "sire" },
        { id: createId("breeding-adult"), breedingSetupId: breedingId, animalId: dam.id, role: "dam" },
      ],
    });

    if (sire.status !== "breeding") {
      await tx.animal.update({
        where: { id: sire.id },
        data: { status: "breeding" },
      });

      await tx.animalStatusEvent.create({
        data: {
          id: createId("status"),
          animalId: sire.id,
          fromStatus: sire.status,
          toStatus: "breeding",
          happenedAt: timestamp,
          actorId: actor.id,
          reason: `Assigned to breeding setup ${breedingId}.`,
        },
      });
    }

    if (dam.status !== "breeding") {
      await tx.animal.update({
        where: { id: dam.id },
        data: { status: "breeding" },
      });

      await tx.animalStatusEvent.create({
        data: {
          id: createId("status"),
          animalId: dam.id,
          fromStatus: dam.status,
          toStatus: "breeding",
          happenedAt: timestamp,
          actorId: actor.id,
          reason: `Assigned to breeding setup ${breedingId}.`,
        },
      });
    }

    if (sire.currentCageId && sire.currentCageId === dam.currentCageId) {
      await tx.cage.update({
        where: { id: sire.currentCageId },
        data: {
          status: "breeding",
          lastUpdatedAt: timestamp,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "breeding_setup",
        entityId: breedingId,
        action: "create",
        newValue: {
          sireId: sire.id,
          damId: dam.id,
          startDate: input.startDate,
          targetGenotype: input.targetGenotype.trim(),
          targetSex,
          allowOverride: Boolean(input.allowOverride),
        },
        timestamp,
      },
    });
  });

  return {
    ok: true,
    message: `Breeding setup created for ${sire.animalId} and ${dam.animalId}.`,
    entityId: breedingId,
  };
}
