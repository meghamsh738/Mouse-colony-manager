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
