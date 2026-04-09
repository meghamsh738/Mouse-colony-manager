import { prisma } from "@/lib/prisma";
import { parseGenotypeImportCsv } from "@/lib/genotype-import";
import type { AnimalStatus, GenotypeCallStatus, HealthNoteType, Sex, UserRole } from "@/lib/types";

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

type CreateLitterInput = {
  breedingSetupId: string;
  birthDate: string;
  litterSizeBirth: number;
  notes?: string;
};

type WeanLitterInput = {
  litterId: string;
  weanDate: string;
  femaleCount: number;
  maleCount: number;
  femaleCageId?: string;
  maleCageId?: string;
  strainId: string;
};

type RecordAnimalGenotypeInput = {
  animalId: string;
  alleleId: string;
  zygosity: string;
  status: GenotypeCallStatus;
  sourceType: string;
  assayType: string;
  sampleDate: string;
  resultDate: string;
  resultText: string;
  confidence?: string;
  provider?: string;
  sampleId?: string;
};

type ImportGenotypeCsvInput = {
  csvText: string;
  fileName?: string;
};

type UpdateAnimalLifecycleInput = {
  animalId: string;
  targetStatus: Extract<AnimalStatus, "euthanized" | "dead" | "transferred_out" | "archived">;
  happenedAt: string;
  reason: string;
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

function canRecordLitter(role: UserRole) {
  return role !== "read_only";
}

function canWeanLitter(role: UserRole) {
  return role !== "read_only";
}

function canRecordGenotype(role: UserRole) {
  return role !== "read_only";
}

function canUpdateAnimalLifecycle(role: UserRole) {
  return role === "admin" || role === "colony_manager" || role === "animal_staff";
}

function getReferenceDate() {
  return process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString();
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
  let nextSequence =
    existingAnimals.reduce((max, animal) => {
      const animalSequence = parseYearlyAnimalSequence(animal.animalId, yearPrefix);
      const labSequence = parseYearlyLabSequence(animal.labId, year);

      return Math.max(max, animalSequence ?? 0, labSequence ?? 0);
    }, 0) + 1;

  return Array.from({ length: count }, () => {
    const currentSequence = nextSequence++;

    return {
      animalId: `CM-${yearPrefix}${String(currentSequence).padStart(3, "0")}`,
      labId: `MC-${year}-${String(currentSequence).padStart(3, "0")}`,
    };
  });
}

function buildFinalGenotypeCall(alleleName: string, zygosity: string, status: GenotypeCallStatus) {
  if (status === "pending") {
    return "Pending";
  }

  if (status === "conflict") {
    return `${alleleName} conflict`;
  }

  return `${alleleName} ${zygosity}`;
}

function shouldClearPendingGenotypeStatus(experimentalStatus?: string | null) {
  return typeof experimentalStatus === "string" && /awaiting genotype|pending genotype/i.test(experimentalStatus);
}

function getLifecycleOutcomeStatus(targetStatus: UpdateAnimalLifecycleInput["targetStatus"]) {
  switch (targetStatus) {
    case "euthanized":
      return "euthanized" as const;
    case "dead":
      return "dead" as const;
    case "transferred_out":
      return "transferred" as const;
    case "archived":
      return null;
  }
}

function getLifecycleExperimentalStatus(targetStatus: UpdateAnimalLifecycleInput["targetStatus"]) {
  switch (targetStatus) {
    case "euthanized":
      return "Euthanized";
    case "dead":
      return "Found dead";
    case "transferred_out":
      return "Transferred out";
    case "archived":
      return "Archived";
  }
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

export async function recordBreedingLitter(
  input: CreateLitterInput,
  actor: { id: string; role: UserRole },
): Promise<MutationResult> {
  if (!canRecordLitter(actor.role)) {
    return { ok: false, message: "Your role cannot record litters." };
  }

  const breeding = await prisma.breedingSetup.findUnique({
    where: { id: input.breedingSetupId },
    select: {
      id: true,
      status: true,
      startDate: true,
      litters: {
        orderBy: [{ birthDate: "desc" }, { id: "desc" }],
        select: {
          id: true,
          birthDate: true,
          litterSizeBirth: true,
          notes: true,
        },
      },
    },
  });

  if (!breeding) {
    return { ok: false, message: "Breeding setup not found." };
  }

  if (breeding.status !== "active") {
    return { ok: false, message: "Only active breeding setups can receive a litter record." };
  }

  const normalizedBirthDate = new Date(input.birthDate);

  if (Number.isNaN(normalizedBirthDate.getTime())) {
    return { ok: false, message: "Choose a valid litter birth date." };
  }

  if (normalizedBirthDate.getTime() < breeding.startDate.getTime()) {
    return { ok: false, message: "Litter birth date cannot be earlier than the breeding start date." };
  }

  const normalizedBirthKey = normalizedBirthDate.toISOString().slice(0, 10);
  const normalizedNotes = input.notes?.trim() || null;
  const matchingLitter = breeding.litters.find(
    (litter) =>
      litter.birthDate.toISOString().slice(0, 10) === normalizedBirthKey &&
      litter.litterSizeBirth === input.litterSizeBirth &&
      (litter.notes ?? null) === normalizedNotes,
  );

  if (matchingLitter) {
    return {
      ok: true,
      message: `Litter recorded for ${breeding.id}.`,
      entityId: matchingLitter.id,
    };
  }

  const latestLitter = breeding.litters[0];

  if (latestLitter && normalizedBirthDate.getTime() <= latestLitter.birthDate.getTime()) {
    return {
      ok: false,
      message: "Litter birth date must be later than the latest recorded litter for this breeding setup.",
    };
  }

  const litterId = createId("litter");
  const timestamp = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.litter.create({
      data: {
        id: litterId,
        breedingSetupId: breeding.id,
        birthDate: normalizedBirthDate,
        litterSizeBirth: input.litterSizeBirth,
        notes: normalizedNotes ?? undefined,
      },
    });

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "litter",
        entityId: litterId,
        action: "create",
        newValue: {
          breedingSetupId: breeding.id,
          birthDate: normalizedBirthKey,
          litterSizeBirth: input.litterSizeBirth,
          notes: normalizedNotes,
        },
        timestamp,
      },
    });
  });

  return {
    ok: true,
    message: `Litter recorded for ${breeding.id}.`,
    entityId: litterId,
  };
}

export async function weanLitterToCages(
  input: WeanLitterInput,
  actor: { id: string; role: UserRole },
): Promise<MutationResult> {
  if (!canWeanLitter(actor.role)) {
    return { ok: false, message: "Your role cannot record litter weaning." };
  }

  const totalWeaned = input.femaleCount + input.maleCount;

  if (totalWeaned <= 0) {
    return { ok: false, message: "Enter at least one male or female pup for weaning." };
  }

  if (input.femaleCount > 0 && !input.femaleCageId) {
    return { ok: false, message: "Choose a female cage before assigning female pups." };
  }

  if (input.maleCount > 0 && !input.maleCageId) {
    return { ok: false, message: "Choose a male cage before assigning male pups." };
  }

  if (input.femaleCount > 0 && input.maleCount > 0 && input.femaleCageId === input.maleCageId) {
    return { ok: false, message: "Assign male and female pups into separate cages at weaning." };
  }

  const normalizedWeanDate = new Date(input.weanDate);

  if (Number.isNaN(normalizedWeanDate.getTime())) {
    return { ok: false, message: "Choose a valid weaning date." };
  }

  const [litter, strain, femaleCage, maleCage, existingAnimals] = await Promise.all([
    prisma.litter.findUnique({
      where: { id: input.litterId },
      select: {
        id: true,
        birthDate: true,
        litterSizeBirth: true,
        litterSizeWean: true,
        breedingSetupId: true,
        breedingSetup: {
          select: {
            id: true,
            adults: {
              orderBy: [{ role: "asc" }, { id: "asc" }],
              select: {
                role: true,
                animal: {
                  select: {
                    id: true,
                    animalId: true,
                    projectSummary: true,
                  },
                },
              },
            },
          },
        },
        litterAnimals: {
          select: {
            id: true,
          },
        },
      },
    }),
    prisma.strain.findUnique({
      where: { id: input.strainId },
      select: { id: true, name: true },
    }),
    input.femaleCageId
      ? prisma.cage.findUnique({
          where: { id: input.femaleCageId },
          select: { id: true, status: true, active: true, barcode: true },
        })
      : Promise.resolve(null),
    input.maleCageId
      ? prisma.cage.findUnique({
          where: { id: input.maleCageId },
          select: { id: true, status: true, active: true, barcode: true },
        })
      : Promise.resolve(null),
    prisma.animal.findMany({
      select: {
        animalId: true,
        labId: true,
      },
    }),
  ]);

  if (!litter) {
    return { ok: false, message: "Litter not found." };
  }

  if (!strain) {
    return { ok: false, message: "Choose a valid strain for the weaned progeny." };
  }

  if (normalizedWeanDate.getTime() < litter.birthDate.getTime()) {
    return { ok: false, message: "Weaning date cannot be earlier than the litter birth date." };
  }

  if (totalWeaned > litter.litterSizeBirth) {
    return { ok: false, message: "Weaning count cannot exceed the recorded litter size at birth." };
  }

  if (litter.litterSizeWean !== null) {
    return { ok: false, message: "This litter already has a recorded weaning outcome." };
  }

  if (litter.litterAnimals.length > 0) {
    return {
      ok: false,
      message: "This litter already has linked progeny records. Review those pups from the colony table instead of creating a second weaning batch.",
    };
  }

  const blockedCageStatuses = new Set(["closed", "retired"]);

  if (input.femaleCount > 0 && (!femaleCage || !femaleCage.active || blockedCageStatuses.has(femaleCage.status))) {
    return { ok: false, message: "Choose an active female holding cage for the weaned litter." };
  }

  if (input.maleCount > 0 && (!maleCage || !maleCage.active || blockedCageStatuses.has(maleCage.status))) {
    return { ok: false, message: "Choose an active male holding cage for the weaned litter." };
  }

  const year = litter.birthDate.getUTCFullYear();
  const identifiers = buildNextAnimalIdentifiers(existingAnimals, year, totalWeaned);
  const sire = litter.breedingSetup.adults.find((adult) => adult.role === "sire")?.animal ?? null;
  const dam = litter.breedingSetup.adults.find((adult) => adult.role === "dam")?.animal ?? null;
  const projectSummaryCandidates = new Set(
    litter.breedingSetup.adults
      .map((adult) => adult.animal?.projectSummary ?? null)
      .filter((value): value is string => Boolean(value)),
  );
  const inheritedProjectSummary = projectSummaryCandidates.size === 1 ? [...projectSummaryCandidates][0] : undefined;
  const timestamp = new Date();
  const animalsToCreate = [
    ...Array.from({ length: input.femaleCount }, (_, index) => ({
      id: createId("animal"),
      sex: "female" as const,
      currentCageId: input.femaleCageId!,
      identifiers: identifiers[index],
    })),
    ...Array.from({ length: input.maleCount }, (_, index) => ({
      id: createId("animal"),
      sex: "male" as const,
      currentCageId: input.maleCageId!,
      identifiers: identifiers[input.femaleCount + index],
    })),
  ];

  await prisma.$transaction(async (tx) => {
    await tx.animal.createMany({
      data: animalsToCreate.map((animal) => ({
        id: animal.id,
        animalId: animal.identifiers.animalId,
        labId: animal.identifiers.labId,
        sex: animal.sex,
        dob: litter.birthDate,
        strainId: strain.id,
        currentCageId: animal.currentCageId,
        status: "weaned",
        originType: `litter ${litter.id}`,
        sireId: sire?.id,
        damId: dam?.id,
        healthStatus: "Healthy",
        projectSummary: inheritedProjectSummary,
        experimentalStatus: "Awaiting genotype",
        outcomeStatus: "alive",
        notes: `Created during weaning from ${litter.id}.`,
      })),
    });

    await tx.litterAnimal.createMany({
      data: animalsToCreate.map((animal) => ({
        id: createId("litter-animal"),
        litterId: litter.id,
        animalId: animal.id,
      })),
    });

    await tx.animalStatusEvent.createMany({
      data: animalsToCreate.map((animal) => ({
        id: createId("status"),
        animalId: animal.id,
        toStatus: "weaned",
        happenedAt: normalizedWeanDate,
        actorId: actor.id,
        reason: `Weaned from ${litter.id} into cage ${animal.currentCageId}.`,
      })),
    });

    await tx.litter.update({
      where: { id: litter.id },
      data: {
        litterSizeWean: totalWeaned,
      },
    });

    const cageIds = [input.femaleCageId, input.maleCageId].filter((value): value is string => Boolean(value));

    if (cageIds.length > 0) {
      await tx.cage.updateMany({
        where: {
          id: { in: cageIds },
        },
        data: {
          lastUpdatedAt: timestamp,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "litter",
        entityId: litter.id,
        action: "wean",
        previousValue: {
          litterSizeWean: litter.litterSizeWean,
          progenyCount: litter.litterAnimals.length,
        },
        newValue: {
          litterSizeWean: totalWeaned,
          femaleCount: input.femaleCount,
          maleCount: input.maleCount,
          femaleCageId: input.femaleCageId,
          maleCageId: input.maleCageId,
          strainId: strain.id,
          weanDate: input.weanDate,
        },
        timestamp,
      },
    });
  });

  return {
    ok: true,
    message: `${totalWeaned} pups weaned from ${litter.id} and assigned to holding cages.`,
    entityId: litter.id,
  };
}

export async function recordAnimalGenotype(
  input: RecordAnimalGenotypeInput,
  actor: { id: string; role: UserRole },
): Promise<MutationResult> {
  if (!canRecordGenotype(actor.role)) {
    return { ok: false, message: "Your role cannot record genotyping results." };
  }

  const [animal, allele, existingAlleles] = await Promise.all([
    prisma.animal.findUnique({
      where: { id: input.animalId },
      select: {
        id: true,
        animalId: true,
        experimentalStatus: true,
        outcomeStatus: true,
      },
    }),
    prisma.allele.findUnique({
      where: { id: input.alleleId },
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.animalAllele.findMany({
      where: { animalId: input.animalId },
      select: {
        alleleId: true,
        callStatus: true,
      },
    }),
  ]);

  if (!animal) {
    return { ok: false, message: "Animal not found." };
  }

  if (!allele) {
    return { ok: false, message: "Choose a valid allele or marker." };
  }

  if (animal.outcomeStatus !== "alive") {
    return { ok: false, message: "Only live animals can receive new genotyping records." };
  }

  const normalizedSampleDate = new Date(input.sampleDate);
  const normalizedResultDate = new Date(input.resultDate);

  if (Number.isNaN(normalizedSampleDate.getTime()) || Number.isNaN(normalizedResultDate.getTime())) {
    return { ok: false, message: "Choose valid sample and assay dates for the genotype record." };
  }

  if (normalizedResultDate.getTime() < normalizedSampleDate.getTime()) {
    return { ok: false, message: "Assay date cannot be earlier than sample collection date." };
  }

  const normalizedZygosity = input.zygosity.trim();
  const normalizedResultText = input.resultText.trim();
  const normalizedConfidence = input.confidence?.trim() || undefined;
  const normalizedProvider = input.provider?.trim() || undefined;
  const normalizedSampleId = input.sampleId?.trim() || undefined;
  const finalCall = buildFinalGenotypeCall(allele.name, normalizedZygosity, input.status);
  const existingRecord = await prisma.genotypingRecord.findFirst({
    where: {
      animalId: animal.id,
      markerTested: allele.name,
      status: input.status,
      sampleDate: normalizedSampleDate,
      resultDate: normalizedResultDate,
      finalCall,
      resultText: normalizedResultText,
    },
    orderBy: { resultDate: "desc" },
    select: { id: true },
  });

  if (existingRecord) {
    return {
      ok: true,
      message: `${allele.name} genotype recorded for ${animal.animalId}.`,
      entityId: existingRecord.id,
    };
  }

  const recordId = createId("geno");
  const timestamp = new Date();
  const effectiveAlleles = [
    ...existingAlleles.filter((entry) => entry.alleleId !== allele.id),
    {
      alleleId: allele.id,
      callStatus: input.status,
    },
  ];
  const genotypeResolved = effectiveAlleles.length > 0 && effectiveAlleles.every((entry) => entry.callStatus === "confirmed");

  await prisma.$transaction(async (tx) => {
    await tx.genotypingRecord.create({
      data: {
        id: recordId,
        animalId: animal.id,
        sourceType: input.sourceType.trim(),
        assayType: input.assayType.trim(),
        sampleId: normalizedSampleId,
        markerTested: allele.name,
        resultText: normalizedResultText,
        sampleDate: normalizedSampleDate,
        resultDate: normalizedResultDate,
        operatorId: actor.id,
        provider: normalizedProvider,
        verifiedById: input.status === "confirmed" ? actor.id : undefined,
        finalCall,
        status: input.status,
        confidence: normalizedConfidence,
      },
    });

    await tx.animalAllele.upsert({
      where: {
        animalId_alleleId: {
          animalId: animal.id,
          alleleId: allele.id,
        },
      },
      create: {
        id: createId("animal-allele"),
        animalId: animal.id,
        alleleId: allele.id,
        zygosity: normalizedZygosity,
        callStatus: input.status,
      },
      update: {
        zygosity: normalizedZygosity,
        callStatus: input.status,
      },
    });

    if (shouldClearPendingGenotypeStatus(animal.experimentalStatus) && genotypeResolved) {
      await tx.animal.update({
        where: { id: animal.id },
        data: {
          experimentalStatus: "Not assigned",
        },
      });
    }

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "genotyping_record",
        entityId: recordId,
        action: "create",
        newValue: {
          animalId: animal.id,
          alleleId: allele.id,
          zygosity: normalizedZygosity,
          status: input.status,
          sampleDate: input.sampleDate,
          resultDate: input.resultDate,
          sourceType: input.sourceType.trim(),
          assayType: input.assayType.trim(),
        },
        timestamp,
      },
    });
  }, { timeout: 15_000, maxWait: 10_000 });

  return {
    ok: true,
    message: `${allele.name} genotype recorded for ${animal.animalId}.`,
    entityId: recordId,
  };
}

export async function importGenotypeCsvBatch(
  input: ImportGenotypeCsvInput,
  actor: { id: string; role: UserRole },
): Promise<MutationResult> {
  if (!canRecordGenotype(actor.role)) {
    return { ok: false, message: "Your role cannot import genotyping results." };
  }

  const parsed = parseGenotypeImportCsv(input.csvText);

  if (!parsed.rows.length) {
    return {
      ok: false,
      message: parsed.errors[0] ?? "No valid genotype rows were found in the uploaded CSV.",
    };
  }

  if (parsed.rows.length > 250) {
    return {
      ok: false,
      message: "Limit each batch import to 250 genotype rows so validation and audit remain tractable.",
    };
  }

  const [animals, alleles] = await Promise.all([
    prisma.animal.findMany({
      select: {
        id: true,
        animalId: true,
        labId: true,
      },
    }),
    prisma.allele.findMany({
      select: {
        id: true,
        name: true,
        gene: true,
      },
    }),
  ]);

  const animalsByLookup = new Map<string, { id: string; animalId: string; labId: string }>();

  for (const animal of animals) {
    animalsByLookup.set(animal.animalId.toLowerCase(), animal);
    animalsByLookup.set(animal.labId.toLowerCase(), animal);
  }

  const alleleKeyCounts = new Map<string, number>();
  const allelesByLookup = new Map<string, { id: string; name: string }>();

  for (const allele of alleles) {
    const keys = new Set([allele.name.toLowerCase(), allele.gene.toLowerCase()]);

    for (const key of keys) {
      alleleKeyCounts.set(key, (alleleKeyCounts.get(key) ?? 0) + 1);
      allelesByLookup.set(key, { id: allele.id, name: allele.name });
    }
  }

  let successCount = 0;
  const errors = [...parsed.errors];

  for (const row of parsed.rows) {
    const animal = animalsByLookup.get(row.animalLookup.toLowerCase());

    if (!animal) {
      errors.push(`Row ${row.rowNumber}: animal '${row.animalLookup}' was not found.`);
      continue;
    }

    const alleleLookupKey = row.alleleLookup.toLowerCase();

    if ((alleleKeyCounts.get(alleleLookupKey) ?? 0) > 1) {
      errors.push(`Row ${row.rowNumber}: allele lookup '${row.alleleLookup}' is ambiguous. Use the exact allele name.`);
      continue;
    }

    const allele = allelesByLookup.get(alleleLookupKey);

    if (!allele) {
      errors.push(`Row ${row.rowNumber}: allele '${row.alleleLookup}' was not found.`);
      continue;
    }

    const result = await recordAnimalGenotype(
      {
        animalId: animal.id,
        alleleId: allele.id,
        zygosity: row.zygosity,
        status: row.status,
        sourceType: row.sourceType,
        assayType: row.assayType,
        sampleDate: row.sampleDate,
        resultDate: row.resultDate,
        resultText: row.resultText,
        confidence: row.confidence,
        provider: row.provider,
        sampleId: row.sampleId,
      },
      actor,
    );

    if (!result.ok) {
      errors.push(`Row ${row.rowNumber}: ${result.message}`);
      continue;
    }

    successCount += 1;
  }

  if (!successCount) {
    return {
      ok: false,
      message: errors[0] ?? "The genotype batch import did not create any records.",
    };
  }

  const fileLabel = input.fileName ? ` from ${input.fileName}` : "";
  const errorSummary = errors.length ? ` ${errors.length} row${errors.length === 1 ? "" : "s"} failed.` : "";
  const firstError = errors.length ? ` First issue: ${errors[0]}` : "";

  return {
    ok: true,
    message: `Processed ${parsed.rows.length} genotype row${parsed.rows.length === 1 ? "" : "s"}${fileLabel}. ${successCount} succeeded.${errorSummary}${firstError}`,
  };
}

export async function updateAnimalLifecycleStatus(
  input: UpdateAnimalLifecycleInput,
  actor: { id: string; role: UserRole },
): Promise<MutationResult> {
  if (!canUpdateAnimalLifecycle(actor.role)) {
    return { ok: false, message: "Your role cannot change terminal lifecycle states." };
  }

  const animal = await prisma.animal.findUnique({
    where: { id: input.animalId },
    select: {
      id: true,
      animalId: true,
      labId: true,
      dob: true,
      status: true,
      outcomeStatus: true,
      currentCageId: true,
      deathDate: true,
      deathReason: true,
      experimentalStatus: true,
    },
  });

  if (!animal) {
    return { ok: false, message: "Animal not found." };
  }

  const normalizedReason = input.reason.trim();

  if (normalizedReason.length < 3) {
    return { ok: false, message: "Enter a clear reason for the lifecycle change." };
  }

  const normalizedDate = new Date(input.happenedAt);

  if (Number.isNaN(normalizedDate.getTime())) {
    return { ok: false, message: "Choose a valid lifecycle date." };
  }

  if (normalizedDate.getTime() < animal.dob.getTime()) {
    return { ok: false, message: "Lifecycle date cannot be earlier than the animal date of birth." };
  }

  if (input.targetStatus === "archived") {
    if (animal.status === "archived") {
      return {
        ok: true,
        message: `${animal.animalId} is already archived.`,
        entityId: animal.id,
      };
    }

    if (animal.outcomeStatus === "alive") {
      return {
        ok: false,
        message: `Archive ${animal.animalId} only after euthanasia, death, or transfer out has been recorded.`,
      };
    }
  } else {
    if (animal.outcomeStatus !== "alive") {
      if (animal.status === input.targetStatus) {
        return {
          ok: true,
          message: `${animal.animalId} is already marked ${input.targetStatus.replaceAll("_", " ")}.`,
          entityId: animal.id,
        };
      }

      return {
        ok: false,
        message: `${animal.animalId} has already been removed from the active colony. Archive it instead.`,
      };
    }
  }

  const timestamp = new Date();
  const lifecycleOutcome = getLifecycleOutcomeStatus(input.targetStatus);
  const lifecycleExperimentalStatus = getLifecycleExperimentalStatus(input.targetStatus);
  const cancelsAssignments = input.targetStatus !== "archived";

  await prisma.$transaction(async (tx) => {
    if (animal.currentCageId) {
      await tx.animalMovement.create({
        data: {
          id: createId("animal-move"),
          animalId: animal.id,
          fromCageId: animal.currentCageId,
          toCageId: null,
          movedById: actor.id,
          movedAt: normalizedDate,
          reason: normalizedReason,
        },
      });

      await tx.cage.update({
        where: { id: animal.currentCageId },
        data: { lastUpdatedAt: normalizedDate },
      });
    }

    await tx.animal.update({
      where: { id: animal.id },
      data: {
        status: input.targetStatus,
        outcomeStatus: lifecycleOutcome ?? undefined,
        currentCageId: null,
        deathDate:
          input.targetStatus === "euthanized" || input.targetStatus === "dead"
            ? normalizedDate
            : input.targetStatus === "archived"
              ? animal.deathDate
              : null,
        deathReason:
          input.targetStatus === "euthanized" || input.targetStatus === "dead"
            ? normalizedReason
            : input.targetStatus === "archived"
              ? animal.deathReason
              : null,
        experimentalStatus: lifecycleExperimentalStatus,
      },
    });

    if (cancelsAssignments) {
      await tx.experimentAssignment.updateMany({
        where: {
          animalId: animal.id,
          status: {
            in: ["planned", "reserved", "active"],
          },
        },
        data: {
          status: "cancelled",
          endDate: normalizedDate,
        },
      });

      await tx.animalProjectAllocation.updateMany({
        where: {
          animalId: animal.id,
          endedAt: null,
        },
        data: {
          endedAt: normalizedDate,
        },
      });
    }

    await tx.animalStatusEvent.create({
      data: {
        id: createId("status"),
        animalId: animal.id,
        fromStatus: animal.status,
        toStatus: input.targetStatus,
        happenedAt: normalizedDate,
        actorId: actor.id,
        reason: normalizedReason,
      },
    });

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "animal",
        entityId: animal.id,
        action: "lifecycle_update",
        previousValue: {
          status: animal.status,
          outcomeStatus: animal.outcomeStatus,
          currentCageId: animal.currentCageId,
          deathDate: animal.deathDate?.toISOString() ?? null,
          deathReason: animal.deathReason ?? null,
        },
        newValue: {
          status: input.targetStatus,
          outcomeStatus: lifecycleOutcome ?? animal.outcomeStatus,
          currentCageId: null,
          happenedAt: input.happenedAt,
          reason: normalizedReason,
        },
        timestamp,
      },
    });
  }, { timeout: 15_000, maxWait: 10_000 });

  return {
    ok: true,
    message: `${animal.animalId} marked ${input.targetStatus.replaceAll("_", " ")}.`,
    entityId: animal.id,
  };
}
