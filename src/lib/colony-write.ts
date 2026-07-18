import { Prisma } from "@prisma/client";

import { removeStoredAttachment, storeUploadedAttachment, type PreparedAttachmentUpload } from "@/lib/attachment-storage";
import { validateProjectedSexComposition, validateQuarantineAssignments } from "@/lib/cage-assignment-rules";
import { getCageCapacityState, validateFacilityCageCapacity } from "@/lib/cage-capacity";
import { actorHasCapability, normalizeUserRole, type Capability } from "@/lib/capabilities";
import { allocateFacilityIdentifiers, canonicalJsonHash, executeIdempotentCommand } from "@/lib/command-foundation";
import { isTerminalBreedingStatus, validateBreedingTransition } from "@/lib/breeding-state-machine";
import { validateBiosampleStorage, validateBiosampleTransition } from "@/lib/biosample-state-machine";
import { biosampleReplayMatches } from "@/lib/biosample-idempotency";
import {
  canManageLab,
  getActorLabAccess,
  type ActorLabAccess,
  type LabActor,
} from "@/lib/lab-access";
import { prisma } from "@/lib/prisma";
import { isReservedQuarantineHealthAction } from "@/lib/quarantine-state-machine";
import { materializeNotificationAlertInTransaction } from "@/lib/notification-materialization";
import { parseExactLifecycleTimestamp } from "@/lib/lifecycle-provenance";
import { parseGenotypeImportCsv } from "@/lib/genotype-import";
import { parseRuleInputValue } from "@/lib/rule-config";
import type { ResolvedActor } from "@/lib/session";
import type {
  AnimalStatus,
  BreedingStatus,
  CryostorageStatus,
  GenotypeCallStatus,
  HealthNoteType,
  SampleStatus,
  Sex,
  UserRole,
} from "@/lib/types";

type MutationResult =
  | {
      ok: true;
      message: string;
      entityId?: string;
      resultingVersion?: number;
    }
  | {
      ok: false;
      message: string;
    };

const OPEN_QUARANTINE_CASE_STATUSES = ["admitted", "under_observation", "exception_open", "release_requested"] as const;
const QUARANTINE_CONTAINMENT_MESSAGE = "Use the quarantine release workflow before moving animals or changing the cage's operational state.";

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
  attachment?: UploadedAttachmentInput;
};

type MoveCageInput = {
  cageId: string;
  roomId: string;
  rackId: string;
  cageNumber: string;
  movedAt: string;
  reason: string;
};

export type MoveAnimalInput = {
  animalId: string;
  toCageId: string;
  movedAt: string;
  reason: string;
};

export type UpdateAnimalPresenceInput = {
  animalId: string;
  action: "missing" | "found";
  happenedAt: string;
  reason: string;
  toCageId?: string;
};

type UpdateCageDetailsInput = {
  cageId: string;
  status?: "active" | "breeding" | "quarantine" | "experiment" | "retired" | "closed";
  notes?: string | null;
  welfareFlags?: string[];
  chargeCategoryId?: string | null;
  dailyRateCents?: number | null;
};

type TransferCageToLabInput = {
  cageId: string;
  toLabId: string;
  movedAt: string;
  reason: string;
  chargeCategoryId?: string | null;
};

type MoveAnimalResult =
  | {
      ok: true;
      message: string;
      entityId: string;
      animalId: string;
      movementId: string;
      fromCageId: string;
      fromCageBarcode: string;
      toCageId: string;
      toCageBarcode: string;
    }
  | {
      ok: false;
      message: string;
    };

type MoveAnimalExecutionOptions = {
  deferCageMaintenance?: boolean;
};

type ReserveAnimalInput = {
  animalId: string;
  experimentId: string;
  startDate: string;
  treatmentGroup?: string;
  notes?: string;
};

type PlanExperimentCohortInput = {
  experimentId: string;
  startDate: string;
  notes?: string;
  selectedAnimals: Array<{
    animalId: string;
    treatmentGroup: string;
  }>;
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

export type TransitionBreedingSetupInput = {
  breedingSetupId: string;
  targetStatus: BreedingStatus;
  happenedAt: string;
  reason: string;
};

export type CreateLitterInput = {
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
  attachment?: UploadedAttachmentInput;
};

type CreateSampleRecordInput = {
  animalId: string;
  projectId?: string;
  experimentId?: string;
  sampleLabel: string;
  sampleType: string;
  status: SampleStatus;
  collectedAt: string;
  storageLocation?: string;
  quantityLabel?: string;
  notes?: string;
};

type UpdateSampleRecordInput = {
  sampleId: string;
  expectedVersion: number;
  status?: SampleStatus;
  experimentId?: string | null;
  storageLocation?: string | null;
  quantityLabel?: string | null;
  notes?: string | null;
};


type CreateCryostorageRecordInput = {
  labId?: string;
  strainId: string;
  projectId?: string;
  sampleLabel: string;
  materialType: string;
  status: CryostorageStatus;
  storedAt: string;
  storageLocation?: string;
  quantityLabel?: string;
  recoveryNotes?: string;
  notes?: string;
};

type UpdateCryostorageRecordInput = {
  recordId: string;
  expectedVersion?: number;
  status?: CryostorageStatus;
  storageLocation?: string | null;
  quantityLabel?: string | null;
  recoveryNotes?: string | null;
  notes?: string | null;
};

type ImportGenotypeCsvInput = {
  csvText: string;
  fileName?: string;
};

export type UpdateAnimalLifecycleInput = {
  animalId: string;
  targetStatus: Extract<AnimalStatus, "euthanized" | "dead" | "transferred_out" | "archived">;
  happenedAt: string;
  reason: string;
  destination?: string;
  transferReference?: string;
  sopAssignmentId?: string;
};

type UpdateRuleConfigInput = {
  ruleId: string;
  valueInput: string;
  criticalBlock: boolean;
};

type CreateProjectRecordInput = {
  labId?: string;
  projectCode: string;
  title: string;
  ownerId: string;
  notes?: string;
};

type UpdateProjectRecordInput = {
  projectId: string;
  title?: string;
  ownerId?: string;
  notes?: string | null;
};

type UploadedAttachmentInput = {
  file: File;
  label?: string;
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

function canMoveCage(role: UserRole) {
  return role === "admin" || role === "colony_manager" || role === "animal_staff";
}

function canMoveAnimal(role: UserRole) {
  return role === "admin" || role === "colony_manager" || role === "animal_staff";
}

function canReserveAnimal(role: UserRole) {
  return role === "admin" || role === "colony_manager" || role === "animal_staff";
}

function canCreateBreeding(role: UserRole) {
  return role !== "read_only";
}

function canRecordLitter(role: UserRole) {
  return role !== "read_only";
}

function canWeanLitter(role: UserRole) {
  return role === "admin" || role === "colony_manager" || role === "animal_staff";
}

function canRecordGenotype(role: UserRole) {
  return role !== "read_only";
}

function canRecordSample(role: UserRole) {
  return role !== "read_only";
}

function canRecordCryostorage(role: UserRole) {
  return role !== "read_only";
}

function canUpdateAnimalLifecycle(role: UserRole) {
  return role === "admin" || role === "colony_manager" || role === "animal_staff";
}

function canUpdateRuleConfig(role: UserRole) {
  return role === "admin";
}

function canSyncProject(role: UserRole) {
  return role === "admin" || role === "colony_manager";
}

function getReferenceDate() {
  return process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString();
}

async function runSerializableTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 20_000,
      });
    } catch (error) {
      const isWriteConflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";

      if (!isWriteConflict || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("Serializable transaction retry limit reached.");
}

async function getCageCapacitySnapshot(tx: Prisma.TransactionClient, cageId: string) {
  const cage = await tx.cage.findUnique({
    where: { id: cageId },
    select: {
      id: true,
      barcode: true,
      labId: true,
      active: true,
      status: true,
      capacityOverride: true,
      room: {
        select: {
          facility: {
            select: { maxCageOccupancy: true },
          },
        },
      },
      _count: {
        select: {
          animals: { where: { outcomeStatus: "alive" } },
        },
      },
    },
  });

  if (!cage) {
    return null;
  }

  const capacity = getCageCapacityState({
    facilityLimit: cage.room.facility.maxCageOccupancy,
    cageOverride: cage.capacityOverride,
    occupantCount: cage._count.animals,
  });

  return {
    ...capacity,
    id: cage.id,
    barcode: cage.barcode,
    labId: cage.labId,
    active: cage.active,
    status: cage.status,
    occupantCount: cage._count.animals,
  };
}

async function validateProjectedCageOccupancy(
  tx: Prisma.TransactionClient,
  cageId: string,
  incomingCount: number,
  access: ActorLabAccess,
) {
  const snapshot = await getCageCapacitySnapshot(tx, cageId);

  if (!snapshot) {
    return { ok: false as const, message: "Destination cage not found." };
  }

  if (!snapshot.active || snapshot.status === "closed" || snapshot.status === "retired") {
    return { ok: false as const, message: `${snapshot.barcode} is not an active operational cage.` };
  }

  if (!canManageLab(access, snapshot.labId)) {
    return { ok: false as const, message: `You cannot assign animals to ${snapshot.barcode}.` };
  }

  const projectedCount = snapshot.occupantCount + incomingCount;

  if (projectedCount > snapshot.effectiveLimit) {
    return {
      ok: false as const,
      message: `${snapshot.barcode} has capacity for ${snapshot.remainingCapacity} more ${
        snapshot.remainingCapacity === 1 ? "animal" : "animals"
      }; this assignment would place ${projectedCount} in a ${snapshot.effectiveLimit}-animal cage.`,
    };
  }

  return { ok: true as const, snapshot };
}

async function prepareAttachmentUpload(
  attachment: UploadedAttachmentInput | undefined,
  category: string,
): Promise<PreparedAttachmentUpload | null> {
  if (!attachment) {
    return null;
  }

  return storeUploadedAttachment({
    category,
    file: attachment.file,
    label: attachment.label,
  });
}

async function createAttachmentRecord(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    labId: string;
    timestamp: Date;
    preparedAttachment: PreparedAttachmentUpload;
    animalId?: string;
    cageId?: string;
    healthNoteId?: string;
    genotypingRecordId?: string;
  },
) {
  const attachmentId = createId("attachment");

  await tx.attachment.create({
    data: {
      id: attachmentId,
      labId: input.labId,
      animalId: input.animalId,
      cageId: input.cageId,
      healthNoteId: input.healthNoteId,
      genotypingRecordId: input.genotypingRecordId,
      label: input.preparedAttachment.label,
      fileName: input.preparedAttachment.fileName,
      fileType: input.preparedAttachment.fileType,
      storageUrl: input.preparedAttachment.storageUrl,
    },
  });

  await tx.auditLog.create({
    data: {
      id: createId("audit"),
      actorId: input.actorId,
      entityType: "attachment",
      entityId: attachmentId,
      action: "create",
      newValue: {
        animalId: input.animalId,
        cageId: input.cageId,
        healthNoteId: input.healthNoteId,
        genotypingRecordId: input.genotypingRecordId,
        label: input.preparedAttachment.label,
        fileName: input.preparedAttachment.fileName,
        fileType: input.preparedAttachment.fileType,
      },
      timestamp: input.timestamp,
    },
  });

  return attachmentId;
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

function buildLocationLabel(location: { roomNumber: string; rackNumber: string; cageNumber: string }) {
  return `${location.roomNumber} / ${location.rackNumber} / ${location.cageNumber}`;
}

function normalizeWelfareFlags(flags: string[] | undefined) {
  if (!flags) {
    return undefined;
  }

  return Array.from(
    new Set(
      flags
        .flatMap((flag) => flag.split(","))
        .map((flag) => flag.trim())
        .filter(Boolean),
    ),
  );
}

async function ensureCanManageCageLab(actor: LabActor, labId?: string | null) {
  const access = await getActorLabAccess(actor);

  return canManageLab(access, labId);
}

export async function getDefaultChargeCategoryId(tx: Prisma.TransactionClient) {
  const standardCategory = await tx.cageChargeCategory.findUnique({
    where: { code: "STANDARD" },
    select: { id: true },
  });

  if (standardCategory) {
    return standardCategory.id;
  }

  const category = await tx.cageChargeCategory.findFirst({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true },
  });

  return category?.id ?? null;
}

export async function startReplacementChargePeriod(
  tx: Prisma.TransactionClient,
  input: {
    cageId: string;
    labId: string;
    categoryId: string;
    dailyRateCents?: number | null;
    timestamp: Date;
    notes: string;
  },
) {
  if (
    input.timestamp.getUTCHours() !== 0
    || input.timestamp.getUTCMinutes() !== 0
    || input.timestamp.getUTCSeconds() !== 0
    || input.timestamp.getUTCMilliseconds() !== 0
  ) {
    throw new Error("Cage rate changes must start on a UTC calendar-day boundary.");
  }
  const cage = await tx.cage.findUnique({
    where: { id: input.cageId },
    select: { active: true, status: true, closure: { select: { id: true } } },
  });
  if (!cage || !cage.active || cage.status === "closed" || cage.closure) {
    throw new Error("Closed cages cannot receive a new charge period.");
  }
  const category = await tx.cageChargeCategory.findUnique({
    where: { id: input.categoryId },
    select: {
      id: true,
      dailyRateCents: true,
      currencyCode: true,
      active: true,
    },
  });

  if (!category || !category.active) {
    throw new Error("Choose an active cage charge category.");
  }

  const [activePeriod] = await tx.$queryRaw<Array<{ id: string; startedAt: Date }>>(Prisma.sql`
    SELECT id, "startedAt"
    FROM "CageChargePeriod"
    WHERE "cageId" = ${input.cageId} AND "endedAt" IS NULL
    ORDER BY "startedAt" DESC
    LIMIT 1
    FOR UPDATE
  `);
  if (activePeriod && activePeriod.startedAt >= input.timestamp) {
    throw new Error("This cage already has a rate effective on that UTC day. Choose a later day.");
  }

  const protectedLine = await tx.invoiceLineItem.findFirst({
    where: {
      chargePeriod: { cageId: input.cageId, endedAt: null },
      serviceEnd: { gt: input.timestamp },
      invoice: { status: { in: ["finalized", "void"] } },
    },
    orderBy: { serviceEnd: "desc" },
    select: { serviceEnd: true },
  });
  if (protectedLine) {
    throw new Error(
      `This cage rate is locked through ${protectedLine.serviceEnd.toISOString().slice(0, 10)} by terminal invoice history.`,
    );
  }

  if (activePeriod) {
    const closed = await tx.cageChargePeriod.updateMany({
      where: { id: activePeriod.id, endedAt: null },
      data: { endedAt: input.timestamp },
    });
    if (closed.count !== 1) {
      throw new Error("The active cage charge changed. Refresh before saving a new rate.");
    }
  }

  await tx.cageChargePeriod.create({
    data: {
      id: createId("charge-period"),
      cageId: input.cageId,
      labId: input.labId,
      categoryId: category.id,
      dailyRateCents: input.dailyRateCents ?? category.dailyRateCents,
      currencyCode: category.currencyCode,
      startedAt: input.timestamp,
      notes: input.notes,
    },
  });
}

export async function createProjectRecord(
  input: CreateProjectRecordInput,
  actor: LabActor,
): Promise<MutationResult> {
  if (!canSyncProject(actor.role)) {
    return { ok: false, message: "Your role cannot sync project records." };
  }

  const [existingProject, owner] = await prisma.$transaction([
    prisma.project.findUnique({
      where: { projectCode: input.projectCode },
      select: { id: true },
    }),
    prisma.user.findUnique({
      where: { id: input.ownerId },
      select: {
        id: true,
        labMemberships: { where: { active: true, lab: { active: true } }, select: { labId: true } },
      },
    }),
  ]);

  if (existingProject) {
    return { ok: false, message: "Project code already exists." };
  }

  if (!owner) {
    return { ok: false, message: "Choose a valid project owner." };
  }

  const access = await getActorLabAccess(actor);
  const ownerLabIds = [...new Set(owner.labMemberships.map((membership) => membership.labId))];
  const projectLabId = input.labId ?? actor.activeLabId ?? (ownerLabIds.length === 1 ? ownerLabIds[0] : null);
  if (!projectLabId || !canManageLab(access, projectLabId) || !ownerLabIds.includes(projectLabId)) {
    return { ok: false, message: "Choose a manageable owning lab shared by the project owner." };
  }

  const timestamp = new Date();
  const projectId = createId("project");
  const notes = input.notes?.trim() || null;

  await prisma.$transaction(async (tx) => {
    await tx.project.create({
      data: {
        id: projectId,
        labId: projectLabId,
        projectCode: input.projectCode.trim(),
        title: input.title.trim(),
        ownerId: input.ownerId,
        notes,
      },
    });

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "project",
        entityId: projectId,
        action: "create",
        newValue: {
          projectCode: input.projectCode.trim(),
          title: input.title.trim(),
          ownerId: input.ownerId,
          notes,
        },
        timestamp,
      },
    });
  });

  return {
    ok: true,
    message: `Project ${input.projectCode.trim()} was synced into the project catalog.`,
    entityId: projectId,
  };
}

export async function updateProjectRecord(
  input: UpdateProjectRecordInput,
  actor: LabActor,
): Promise<MutationResult> {
  if (!canSyncProject(actor.role)) {
    return { ok: false, message: "Your role cannot sync project records." };
  }

  const existingProject = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      projectCode: true,
      title: true,
      ownerId: true,
      notes: true,
      labId: true,
    },
  });
  const owner = input.ownerId
    ? await prisma.user.findUnique({
        where: { id: input.ownerId },
        select: {
          id: true,
          labMemberships: {
            where: { active: true, lab: { active: true } },
            select: { labId: true },
          },
        },
      })
    : null;

  if (!existingProject) {
    return { ok: false, message: "Project not found." };
  }

  const projectAccess = await getActorLabAccess(actor);
  if (!canManageLab(projectAccess, existingProject.labId)) {
    return { ok: false, message: "Project not found." };
  }

  if (input.ownerId && !owner) {
    return { ok: false, message: "Choose a valid project owner." };
  }

  if (owner && !owner.labMemberships.some((membership) => membership.labId === existingProject.labId)) {
    return { ok: false, message: "Choose a project owner who belongs to the project's lab." };
  }

  const timestamp = new Date();
  const nextValue = {
    title: input.title?.trim() ?? existingProject.title,
    ownerId: input.ownerId ?? existingProject.ownerId,
    notes: input.notes === undefined ? existingProject.notes : input.notes?.trim() || null,
  };

  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: input.projectId },
      data: nextValue,
    });

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "project",
        entityId: input.projectId,
        action: "update",
        previousValue: {
          projectCode: existingProject.projectCode,
          title: existingProject.title,
          ownerId: existingProject.ownerId,
          notes: existingProject.notes,
        },
        newValue: {
          projectCode: existingProject.projectCode,
          ...nextValue,
        },
        timestamp,
      },
    });
  });

  return {
    ok: true,
    message: `Project ${existingProject.projectCode} was updated.`,
    entityId: input.projectId,
  };
}

export async function createAnimalRecord(
  input: CreateAnimalInput,
  actor: LabActor,
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
      select: { id: true, labId: true, active: true, status: true, barcode: true },
    }),
    prisma.strain.findUnique({ where: { id: input.strainId }, select: { id: true } }),
  ]);
  const project = input.projectId
    ? await prisma.project.findUnique({
        where: { id: input.projectId },
        select: { id: true, projectCode: true, labId: true },
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

  if (!cage || !cage.active || cage.status === "closed" || cage.status === "retired") {
    return { ok: false, message: "Choose an active operational cage." };
  }

  const actorAccess = await getActorLabAccess(actor);

  if (!canManageLab(actorAccess, cage.labId)) {
    return { ok: false, message: "You can only add animals to cages from labs you manage." };
  }

  if (!strain) {
    return { ok: false, message: "Choose a valid strain." };
  }

  if (input.projectId && !project) {
    return { ok: false, message: "Choose a valid project." };
  }

  if (project && project.labId !== cage.labId) {
    return { ok: false, message: "Choose a project owned by the destination cage's lab." };
  }

  const timestamp = new Date();
  const animalId = createId("animal");

  const creationResult = await runSerializableTransaction(async (tx) => {
    const capacityCheck = await validateProjectedCageOccupancy(tx, input.cageId, 1, actorAccess);

    if (!capacityCheck.ok) {
      return capacityCheck;
    }
    const destinationLabId = capacityCheck.snapshot.labId;
    const [facilityAnimalId] = await allocateFacilityIdentifiers(tx, "animal", 1);

    await tx.animal.create({
      data: {
        id: animalId,
        facilityAnimalId,
        animalId: input.animalId,
        labId: input.labId,
        sex: input.sex,
        dob: new Date(input.dob),
        strainId: input.strainId,
        currentCageId: input.cageId,
        owningLabId: destinationLabId,
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
          owningLabId: destinationLabId,
          strainId: input.strainId,
          projectId: input.projectId,
        },
        timestamp,
      },
    });
    return { ok: true as const };
  });

  if (!creationResult.ok) {
    return creationResult;
  }

  return {
    ok: true,
    message: `${input.animalId} was added to the active colony.`,
    entityId: animalId,
  };
}

export async function addCageHealthNote(
  input: AddCageHealthNoteInput,
  actor: LabActor,
): Promise<MutationResult> {
  if (!canCreateHealthNote(actor.role)) {
    return { ok: false, message: "Your role cannot add cage health notes." };
  }
  const normalizedActionTaken = input.actionTaken?.trim() || null;
  if (isReservedQuarantineHealthAction(normalizedActionTaken)) {
    return { ok: false, message: "That action label is reserved for the quarantine observation workflow." };
  }

  const cage = await prisma.cage.findUnique({
    where: { id: input.cageId },
    select: { id: true, labId: true, barcode: true },
  });
  const existingNote = await prisma.healthNote.findFirst({
    where: {
      cageId: input.cageId,
      createdById: actor.id,
      noteType: input.noteType,
      severity: input.severity,
      note: input.note.trim(),
      followupRequired: input.followupRequired,
      actionTaken: normalizedActionTaken,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });

  if (!cage) {
    return { ok: false, message: "Cage not found." };
  }

  if (!(await ensureCanManageCageLab(actor, cage.labId))) {
    return { ok: false, message: "You can only add notes to cages from labs you manage." };
  }

  const timestamp = new Date();
  if (existingNote && timestamp.getTime() - existingNote.createdAt.getTime() < 2 * 60 * 1000) {
    const preparedAttachment = input.attachment
      ? await prepareAttachmentUpload(input.attachment, "health-notes").catch((error) => {
          if (error instanceof Error) {
            return error;
          }

          return new Error("Unable to store the uploaded health-note attachment.");
        })
      : null;

    if (preparedAttachment instanceof Error) {
      return { ok: false, message: preparedAttachment.message };
    }

    if (preparedAttachment) {
      try {
        await prisma.$transaction(async (tx) => {
          await createAttachmentRecord(tx, {
            actorId: actor.id,
            labId: cage.labId!,
            timestamp,
            preparedAttachment,
            cageId: input.cageId,
            healthNoteId: existingNote.id,
          });

          await tx.cage.update({
            where: { id: input.cageId },
            data: { lastUpdatedAt: timestamp },
          });
        }, { timeout: 15_000, maxWait: 10_000 });
      } catch (error) {
        await removeStoredAttachment(preparedAttachment.storageUrl);
        throw error;
      }
    }

    return {
      ok: true,
      message: `Health note logged for ${cage.barcode}.`,
      entityId: existingNote.id,
    };
  }

  const noteId = createId("health");
  const preparedAttachment = input.attachment
    ? await prepareAttachmentUpload(input.attachment, "health-notes").catch((error) => {
        if (error instanceof Error) {
          return error;
        }

        return new Error("Unable to store the uploaded health-note attachment.");
      })
    : null;

  if (preparedAttachment instanceof Error) {
    return { ok: false, message: preparedAttachment.message };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.healthNote.create({
        data: {
          id: noteId,
          labId: cage.labId!,
          cageId: input.cageId,
          noteType: input.noteType,
          severity: input.severity,
          note: input.note.trim(),
          followupRequired: input.followupRequired,
          actionTaken: normalizedActionTaken ?? undefined,
          resolved: false,
          createdById: actor.id,
          createdAt: timestamp,
        },
      });

      if (input.followupRequired || input.severity === "warning" || input.severity === "critical") {
        await materializeNotificationAlertInTransaction(tx, {
          id: `rule-cage-note-${noteId}`,
          labId: cage.labId!,
          entityType: "cage",
          entityId: input.cageId,
          alertType: "welfare_note",
          severity: input.severity,
          message: input.note.trim(),
          status: "open",
          generatedAt: timestamp.toISOString(),
          source: "rule",
        }, actor.id);
      }

      if (preparedAttachment) {
        await createAttachmentRecord(tx, {
          actorId: actor.id,
          labId: cage.labId!,
          timestamp,
          preparedAttachment,
          cageId: input.cageId,
          healthNoteId: noteId,
        });
      }

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
            attachmentLabel: preparedAttachment?.label ?? null,
          },
          timestamp,
        },
      });
    }, { timeout: 15_000, maxWait: 10_000 });
  } catch (error) {
    if (preparedAttachment) {
      await removeStoredAttachment(preparedAttachment.storageUrl);
    }

    throw error;
  }

  return {
    ok: true,
    message: `Health note logged for ${cage.barcode}.`,
    entityId: noteId,
  };
}

export async function moveCageLocation(
  input: MoveCageInput,
  actor: LabActor,
): Promise<MutationResult> {
  if (!canMoveCage(actor.role)) {
    return { ok: false, message: "Your role cannot move cages." };
  }

  const normalizedCageNumber = input.cageNumber.trim();
  const normalizedReason = input.reason.trim();
  const normalizedMovedAt = new Date(input.movedAt);

  if (!normalizedCageNumber) {
    return { ok: false, message: "Enter the destination cage number." };
  }

  if (normalizedReason.length < 3) {
    return { ok: false, message: "Enter a concise reason for the cage move." };
  }

  if (Number.isNaN(normalizedMovedAt.getTime())) {
    return { ok: false, message: "Choose a valid movement date." };
  }

  const [cage, room, rack] = await Promise.all([
    prisma.cage.findUnique({
      where: { id: input.cageId },
      select: {
        id: true,
        barcode: true,
        labId: true,
        roomId: true,
        rackId: true,
        cageNumber: true,
        active: true,
        room: {
          select: {
            roomNumber: true,
          },
        },
        rack: {
          select: {
            rackNumber: true,
          },
        },
      },
    }),
    prisma.room.findUnique({
      where: { id: input.roomId },
      select: {
        id: true,
        roomNumber: true,
      },
    }),
    prisma.rack.findUnique({
      where: { id: input.rackId },
      select: {
        id: true,
        roomId: true,
        rackNumber: true,
        room: {
          select: {
            roomNumber: true,
          },
        },
      },
    }),
  ]);

  if (!cage) {
    return { ok: false, message: "Cage not found." };
  }

  if (!(await ensureCanManageCageLab(actor, cage.labId))) {
    return { ok: false, message: "Cage not found." };
  }

  if (!cage.active) {
    return { ok: false, message: `${cage.barcode} is inactive and cannot be moved.` };
  }

  if (!room || !rack) {
    return { ok: false, message: "Choose a valid destination room and rack." };
  }

  if (rack.roomId !== room.id) {
    return { ok: false, message: "The selected rack does not belong to the selected room." };
  }

  const fromLocation = buildLocationLabel({
    roomNumber: cage.room.roomNumber,
    rackNumber: cage.rack.rackNumber,
    cageNumber: cage.cageNumber,
  });
  const toLocation = buildLocationLabel({
    roomNumber: room.roomNumber,
    rackNumber: rack.rackNumber,
    cageNumber: normalizedCageNumber,
  });

  if (fromLocation === toLocation) {
    return { ok: false, message: "Choose a different room, rack, or cage number before saving the move." };
  }

  const conflictingCage = await prisma.cage.findUnique({
    where: {
      rackId_cageNumber: {
        rackId: rack.id,
        cageNumber: normalizedCageNumber,
      },
    },
    select: {
      id: true,
      barcode: true,
      room: { select: { roomNumber: true } },
      rack: { select: { rackNumber: true } },
      cageNumber: true,
    },
  });

  if (conflictingCage && conflictingCage.id !== cage.id) {
    return {
      ok: false,
      message: `${buildLocationLabel({
        roomNumber: conflictingCage.room.roomNumber,
        rackNumber: conflictingCage.rack.rackNumber,
        cageNumber: conflictingCage.cageNumber,
      })} is already assigned to ${conflictingCage.barcode}.`,
    };
  }

  const movementId = createId("cage-move");

  await prisma.$transaction(async (tx) => {
    await tx.cageMovement.create({
      data: {
        id: movementId,
        cageId: cage.id,
        fromLocation,
        toLocation,
        movedById: actor.id,
        movedAt: normalizedMovedAt,
        reason: normalizedReason,
      },
    });

    await tx.cage.update({
      where: { id: cage.id },
      data: {
        roomId: room.id,
        rackId: rack.id,
        cageNumber: normalizedCageNumber,
        lastUpdatedAt: normalizedMovedAt,
      },
    });

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "cage",
        entityId: cage.id,
        action: "move",
        previousValue: {
          roomId: cage.roomId,
          rackId: cage.rackId,
          cageNumber: cage.cageNumber,
          location: fromLocation,
        },
        newValue: {
          roomId: room.id,
          rackId: rack.id,
          cageNumber: normalizedCageNumber,
          location: toLocation,
          movedAt: input.movedAt,
          reason: normalizedReason,
        },
        timestamp: normalizedMovedAt,
      },
    });
  }, { timeout: 15_000, maxWait: 10_000 });

  return {
    ok: true,
    message: `${cage.barcode} moved to ${toLocation}.`,
    entityId: movementId,
  };
}

export async function updateCageDetails(
  input: UpdateCageDetailsInput,
  actor: LabActor & { capabilities?: readonly Capability[] },
): Promise<MutationResult> {
  if (!canMoveCage(actor.role)) {
    return { ok: false, message: "Your role cannot edit cage details." };
  }

  const cage = await prisma.cage.findUnique({
    where: { id: input.cageId },
    select: {
      id: true,
      barcode: true,
      labId: true,
      status: true,
      notes: true,
      welfareFlags: true,
      active: true,
      quarantineCases: {
        where: { status: { in: [...OPEN_QUARANTINE_CASE_STATUSES] } },
        take: 1,
        select: { id: true },
      },
      chargePeriods: {
        where: { endedAt: null },
        take: 1,
        orderBy: { startedAt: "desc" },
        select: {
          categoryId: true,
          dailyRateCents: true,
        },
      },
    },
  });

  if (!cage) {
    return { ok: false, message: "Cage not found." };
  }

  if (!(await ensureCanManageCageLab(actor, cage.labId))) {
    return { ok: false, message: "You can only edit cages from labs you manage." };
  }

  if (!cage.active || cage.status === "closed") {
    return { ok: false, message: `${cage.barcode} is closed and cannot be edited.` };
  }

  if (input.status === "closed") {
    return { ok: false, message: "Use Exit cage to close a cage and end charging." };
  }
  if (input.status && input.status !== cage.status && cage.quarantineCases.length) {
    return { ok: false, message: QUARANTINE_CONTAINMENT_MESSAGE };
  }

  const normalizedFlags = normalizeWelfareFlags(input.welfareFlags);
  const normalizedNotes = input.notes === undefined ? undefined : input.notes?.trim() || null;
  const timestamp = new Date();
  const billingEffectiveAt = new Date(Date.UTC(
    timestamp.getUTCFullYear(),
    timestamp.getUTCMonth(),
    timestamp.getUTCDate(),
  ));
  const activeChargePeriod = cage.chargePeriods[0];
  const nextCategoryId = input.chargeCategoryId || activeChargePeriod?.categoryId || null;
  const nextDailyRateCents =
    input.dailyRateCents === undefined || input.dailyRateCents === null
      ? activeChargePeriod?.dailyRateCents
      : input.dailyRateCents;
  const shouldReplaceChargePeriod =
    Boolean(nextCategoryId) &&
    (nextCategoryId !== activeChargePeriod?.categoryId ||
      (nextDailyRateCents !== undefined && nextDailyRateCents !== activeChargePeriod?.dailyRateCents));

  const canManageBilling = actor.capabilities
    ? actor.capabilities.includes("billing:manage")
    : actorHasCapability(
        { canonicalRole: normalizeUserRole(actor.role), activeMembership: null },
        "billing:manage",
      );
  if (shouldReplaceChargePeriod && !canManageBilling) {
    return { ok: false, message: "Cage rates can only be changed by a billing administrator." };
  }

  if (input.dailyRateCents !== undefined && input.dailyRateCents !== null && input.dailyRateCents < 0) {
    return { ok: false, message: "Daily cage rate must be zero or higher." };
  }

  if (shouldReplaceChargePeriod && !cage.labId) {
    return { ok: false, message: "Assign the cage to a lab before changing cage charging." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (input.status && input.status !== cage.status) {
        const openCase = await tx.quarantineCase.findFirst({
          where: { cageId: cage.id, status: { in: [...OPEN_QUARANTINE_CASE_STATUSES] } },
          select: { id: true },
        });
        if (openCase) throw new Error(QUARANTINE_CONTAINMENT_MESSAGE);
      }
      const cageUpdateData: Prisma.CageUpdateInput = {
        status: input.status ?? cage.status,
        notes: normalizedNotes === undefined ? cage.notes : normalizedNotes,
        lastUpdatedAt: timestamp,
      };

      if (normalizedFlags !== undefined) {
        cageUpdateData.welfareFlags = normalizedFlags as Prisma.InputJsonValue;
      }

      await tx.cage.update({
        where: { id: cage.id },
        data: cageUpdateData,
      });

      if (shouldReplaceChargePeriod && cage.labId && nextCategoryId) {
        await startReplacementChargePeriod(tx, {
          cageId: cage.id,
          labId: cage.labId,
          categoryId: nextCategoryId,
          dailyRateCents: nextDailyRateCents,
          timestamp: billingEffectiveAt,
          notes: "Cage detail update.",
        });
      }

      await tx.auditLog.create({
        data: {
          id: createId("audit"),
          actorId: actor.id,
          entityType: "cage",
          entityId: cage.id,
          action: "update_details",
          previousValue: {
            status: cage.status,
            notes: cage.notes,
            welfareFlags: cage.welfareFlags,
            chargeCategoryId: activeChargePeriod?.categoryId ?? null,
            dailyRateCents: activeChargePeriod?.dailyRateCents ?? null,
          },
          newValue: {
            status: input.status ?? cage.status,
            notes: normalizedNotes === undefined ? cage.notes : normalizedNotes,
            welfareFlags: normalizedFlags === undefined ? cage.welfareFlags : normalizedFlags,
            chargeCategoryId: nextCategoryId,
            dailyRateCents: nextDailyRateCents ?? null,
            chargeEffectiveAt: shouldReplaceChargePeriod ? billingEffectiveAt : null,
          },
          timestamp,
        },
      });
    }, { timeout: 15_000, maxWait: 10_000 });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Cage details could not be saved.",
    };
  }

  return {
    ok: true,
    message: `${cage.barcode} was updated.`,
    entityId: cage.id,
  };
}

export async function transferCageToLab(
  input: TransferCageToLabInput,
  actor: LabActor,
): Promise<MutationResult> {
  void input;
  void actor;
  return {
    ok: false,
    message: "Direct lab transfers are disabled. Use the source request, destination approval, and CMU finalization workflow.",
  };
}

export async function moveAnimalToCage(
  input: MoveAnimalInput,
  actor: LabActor,
  transaction?: Prisma.TransactionClient,
  options: MoveAnimalExecutionOptions = {},
): Promise<MoveAnimalResult> {
  if (options.deferCageMaintenance && !transaction) {
    throw new Error("Deferred cage maintenance requires an existing transaction.");
  }
  if (!canMoveAnimal(actor.role)) {
    return { ok: false, message: "Your role cannot transfer animals between cages." };
  }

  const normalizedReason = input.reason.trim();
  const normalizedMovedAt = new Date(input.movedAt);

  if (normalizedReason.length < 3) {
    return { ok: false, message: "Enter a concise reason for the animal transfer." };
  }

  if (Number.isNaN(normalizedMovedAt.getTime())) {
    return { ok: false, message: "Choose a valid transfer date." };
  }

  const operation = async (tx: Prisma.TransactionClient): Promise<MoveAnimalResult> => {
    const actorAccess = await getActorLabAccess(actor, tx);
    const [animal, destinationCage, mixedSexRule] = await Promise.all([
      tx.animal.findUnique({
        where: { id: input.animalId },
        select: {
          id: true,
          animalId: true,
          sex: true,
          owningLabId: true,
          outcomeStatus: true,
          currentCageId: true,
          currentCage: {
            select: {
              id: true,
              barcode: true,
              labId: true,
              cageNumber: true,
              room: { select: { roomNumber: true } },
              rack: { select: { rackNumber: true } },
              quarantineCases: {
                where: { status: { in: [...OPEN_QUARANTINE_CASE_STATUSES] } },
                take: 1,
                select: { id: true },
              },
            },
          },
          breedingAdults: {
            where: { breedingSetup: { status: { in: ["planned", "active", "paused"] } } },
            select: { breedingSetupId: true },
          },
        },
      }),
      tx.cage.findUnique({
        where: { id: input.toCageId },
        select: {
          id: true,
          barcode: true,
          labId: true,
          active: true,
          status: true,
          cageNumber: true,
          room: { select: { roomNumber: true } },
          rack: { select: { rackNumber: true } },
          animals: {
            where: { outcomeStatus: "alive" },
            select: { id: true, sex: true },
          },
        },
      }),
      tx.ruleConfig.findUnique({ where: { key: "mixed_sex_holding_allowed" }, select: { value: true } }),
    ]);

    if (!animal) return { ok: false, message: "Animal not found." };
    const sourceLabId = animal.currentCage?.labId ?? animal.owningLabId;
    if (!canManageLab(actorAccess, sourceLabId)) return { ok: false, message: "Animal not found." };
    if (animal.outcomeStatus !== "alive") {
      return { ok: false, message: `${animal.animalId} is not in the live colony and cannot be moved.` };
    }
    if (animal.breedingAdults.length) {
      return {
        ok: false,
        message: `${animal.animalId} belongs to an open breeding setup. Complete or retire that setup before moving the animal.`,
      };
    }
    if (!animal.currentCageId || !animal.currentCage) {
      return { ok: false, message: `${animal.animalId} is not currently assigned to a source cage.` };
    }
    if (animal.currentCage.quarantineCases.length) {
      return { ok: false, message: QUARANTINE_CONTAINMENT_MESSAGE };
    }
    if (!destinationCage || !canManageLab(actorAccess, destinationCage.labId)) {
      return { ok: false, message: "Destination cage not found." };
    }
    if (!destinationCage.active || destinationCage.status === "closed" || destinationCage.status === "retired") {
      return { ok: false, message: `${destinationCage.barcode} is not an active operational cage.` };
    }
    if (animal.currentCageId === destinationCage.id) {
      return { ok: false, message: "Choose a different destination cage before saving the transfer." };
    }

    const quarantineError = validateQuarantineAssignments({
      workflow: "new",
      destinations: [{
        key: `existing:${destinationCage.id}`,
        label: destinationCage.barcode,
        status: destinationCage.status,
        occupants: destinationCage.animals,
      }],
      usedDestinationKeys: new Set([`existing:${destinationCage.id}`]),
    });
    if (quarantineError) return { ok: false, message: quarantineError };
    const sexError = validateProjectedSexComposition({
      destinations: [{
        key: `existing:${destinationCage.id}`,
        label: destinationCage.barcode,
        status: destinationCage.status,
        occupants: destinationCage.animals,
      }],
      incoming: [{ subjectId: animal.id, sex: animal.sex, destinationKey: `existing:${destinationCage.id}` }],
      mixedSexHoldingAllowed: mixedSexRule?.value === true,
    });
    if (sexError) return { ok: false, message: sexError };

    const capacityCheck = await validateProjectedCageOccupancy(tx, destinationCage.id, 1, actorAccess);
    if (!capacityCheck.ok) return capacityCheck;
    const destinationLabId = capacityCheck.snapshot.labId;
    if (!sourceLabId || !destinationLabId || sourceLabId !== destinationLabId) {
      return { ok: false, message: "Use the cross-lab transfer approval workflow before moving this animal." };
    }

    const sourceCage = animal.currentCage;
    const sourceCageId = animal.currentCageId;
    const movementId = createId("animal-move");
    const auditTimestamp = new Date();
    const fromLocation = buildLocationLabel({
      roomNumber: sourceCage.room.roomNumber,
      rackNumber: sourceCage.rack.rackNumber,
      cageNumber: sourceCage.cageNumber,
    });
    const toLocation = buildLocationLabel({
      roomNumber: destinationCage.room.roomNumber,
      rackNumber: destinationCage.rack.rackNumber,
      cageNumber: destinationCage.cageNumber,
    });

    await tx.animal.update({
      where: { id: animal.id },
      data: { currentCageId: destinationCage.id },
    });
    await tx.animalMovement.create({
      data: {
        id: movementId,
        animalId: animal.id,
        fromCageId: sourceCageId,
        toCageId: destinationCage.id,
        movedById: actor.id,
        movedAt: normalizedMovedAt,
        reason: normalizedReason,
      },
    });
    if (!options.deferCageMaintenance) {
      await tx.cage.updateMany({
        where: { id: { in: [sourceCageId, destinationCage.id] } },
        data: { lastUpdatedAt: normalizedMovedAt },
      });
      await reconcileBreedingCageStatuses({
        tx,
        labId: sourceLabId,
        actorId: actor.id,
        effectiveAt: normalizedMovedAt,
        auditTimestamp,
        reason: normalizedReason,
        candidateCageIds: [sourceCageId, destinationCage.id],
      });
    }
    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "animal",
        entityId: animal.id,
        action: "move_cage",
        previousValue: {
          currentCageId: sourceCageId,
          owningLabId: animal.owningLabId,
          cageBarcode: sourceCage.barcode,
          location: fromLocation,
        },
        newValue: {
          currentCageId: destinationCage.id,
          owningLabId: animal.owningLabId,
          cageBarcode: destinationCage.barcode,
          location: toLocation,
          movedAt: input.movedAt,
          reason: normalizedReason,
        },
        timestamp: auditTimestamp,
      },
    });
    return {
      ok: true,
      message: `${animal.animalId} moved from ${fromLocation} to ${toLocation}.`,
      entityId: animal.id,
      animalId: animal.id,
      movementId,
      fromCageId: sourceCageId,
      fromCageBarcode: sourceCage.barcode,
      toCageId: destinationCage.id,
      toCageBarcode: destinationCage.barcode,
    };
  };

  return transaction ? operation(transaction) : runSerializableTransaction(operation);
}

export async function executeMoveAnimalToCageCommand(input: {
  command: MoveAnimalInput;
  actor: ResolvedActor;
  idempotencyKey: string;
  requestId: string;
  expectedVersion: number;
}) {
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "animal.move_cage",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: input.command as unknown as Prisma.InputJsonValue,
    requiredCapability: "cages:manage",
    labId: input.actor.canonicalRole === "lab_user" ? input.actor.activeLabId : null,
    aggregateType: "animal",
    aggregateId: input.command.animalId,
    expectedVersion: input.expectedVersion,
    handler: async (tx) => {
      const result = await moveAnimalToCage(input.command, {
        id: input.actor.id,
        role: input.actor.role,
        activeLabId: input.actor.activeLabId,
      }, tx);
      if (!result.ok) return { ok: false as const, code: "validation_error", message: result.message };
      return { ok: true as const, result: result as unknown as Prisma.InputJsonValue, aggregateType: "animal", aggregateId: result.animalId };
    },
  });
}

export async function updateAnimalPresenceStatus(
  input: UpdateAnimalPresenceInput,
  actor: LabActor,
  transaction?: Prisma.TransactionClient,
): Promise<MutationResult> {
  if (!canMoveAnimal(actor.role)) return { ok: false, message: "Your role cannot update animal location status." };
  const happenedAt = new Date(input.happenedAt);
  const reason = input.reason.trim();
  if (Number.isNaN(happenedAt.getTime())) return { ok: false, message: "Choose a valid event date." };
  if (reason.length < 3) return { ok: false, message: "Enter a clear reason for this location update." };

  const operation = async (tx: Prisma.TransactionClient): Promise<MutationResult> => {
    const access = await getActorLabAccess(actor, tx);
    const animal = await tx.animal.findUnique({
      where: { id: input.animalId },
      select: {
        id: true,
        animalId: true,
        sex: true,
        owningLabId: true,
        outcomeStatus: true,
        currentCageId: true,
        currentCage: {
          select: {
            id: true,
            barcode: true,
            labId: true,
            quarantineCases: {
              where: { status: { in: [...OPEN_QUARANTINE_CASE_STATUSES] } },
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    });
    if (!animal || !canManageLab(access, animal.owningLabId)) return { ok: false, message: "Animal not found." };
    if (animal.currentCage?.quarantineCases.length) {
      return { ok: false, message: QUARANTINE_CONTAINMENT_MESSAGE };
    }

    if (input.action === "missing") {
      if (animal.outcomeStatus === "missing") return { ok: true, message: `${animal.animalId} is already marked missing.`, entityId: animal.id };
      if (animal.outcomeStatus !== "alive") return { ok: false, message: `${animal.animalId} is not in the live colony.` };
      if (animal.currentCageId) {
        await tx.animalMovement.create({
          data: {
            id: createId("animal-move"),
            animalId: animal.id,
            fromCageId: animal.currentCageId,
            toCageId: null,
            movedById: actor.id,
            movedAt: happenedAt,
            reason,
          },
        });
        await tx.cage.update({ where: { id: animal.currentCageId }, data: { lastUpdatedAt: happenedAt } });
      }
      await tx.animal.update({ where: { id: animal.id }, data: { outcomeStatus: "missing", currentCageId: null } });
      await tx.alert.create({
        data: {
          id: createId("alert"),
          labId: animal.owningLabId,
          entityType: "animal",
          entityId: animal.id,
          alertType: "animal_missing",
          severity: "critical",
          message: `${animal.animalId} was reported missing. ${reason}`,
          source: "animal_presence_workflow",
          generatedAt: happenedAt,
        },
      });
      await tx.auditLog.create({
        data: {
          id: createId("audit"), actorId: actor.id, entityType: "animal", entityId: animal.id,
          action: "mark_missing",
          previousValue: { outcomeStatus: animal.outcomeStatus, currentCageId: animal.currentCageId },
          newValue: { outcomeStatus: "missing", currentCageId: null, happenedAt: input.happenedAt, reason },
          timestamp: happenedAt,
        },
      });
      return { ok: true, message: `${animal.animalId} marked missing and the owning lab was alerted.`, entityId: animal.id };
    }

    if (animal.outcomeStatus !== "missing") return { ok: false, message: `${animal.animalId} is not currently marked missing.` };
    if (!input.toCageId) return { ok: false, message: "Choose the cage where the animal was found." };
    const [destination, mixedSexRule] = await Promise.all([
      tx.cage.findUnique({
        where: { id: input.toCageId },
        select: {
          id: true, barcode: true, labId: true, active: true, status: true,
          animals: { where: { outcomeStatus: "alive" }, select: { id: true, sex: true } },
        },
      }),
      tx.ruleConfig.findUnique({ where: { key: "mixed_sex_holding_allowed" }, select: { value: true } }),
    ]);
    if (!destination || !canManageLab(access, destination.labId)) return { ok: false, message: "Destination cage not found." };
    if (destination.labId !== animal.owningLabId) {
      return { ok: false, message: "Use the cross-lab transfer workflow before changing the animal's owning lab." };
    }
    if (!destination.active || destination.status === "closed" || destination.status === "retired") {
      return { ok: false, message: `${destination.barcode} is not an active operational cage.` };
    }
    const quarantineError = validateQuarantineAssignments({
      workflow: "new",
      destinations: [{ key: `existing:${destination.id}`, label: destination.barcode, status: destination.status, occupants: destination.animals }],
      usedDestinationKeys: new Set([`existing:${destination.id}`]),
    });
    if (quarantineError) return { ok: false, message: quarantineError };
    const sexError = validateProjectedSexComposition({
      destinations: [{ key: `existing:${destination.id}`, label: destination.barcode, status: destination.status, occupants: destination.animals }],
      incoming: [{ subjectId: animal.id, sex: animal.sex, destinationKey: `existing:${destination.id}` }],
      mixedSexHoldingAllowed: mixedSexRule?.value === true,
    });
    if (sexError) return { ok: false, message: sexError };
    const capacity = await validateProjectedCageOccupancy(tx, destination.id, 1, access);
    if (!capacity.ok) return capacity;

    await tx.animal.update({ where: { id: animal.id }, data: { outcomeStatus: "alive", currentCageId: destination.id } });
    await tx.animalMovement.create({
      data: {
        id: createId("animal-move"), animalId: animal.id, fromCageId: null, toCageId: destination.id,
        movedById: actor.id, movedAt: happenedAt, reason,
      },
    });
    await tx.cage.update({ where: { id: destination.id }, data: { lastUpdatedAt: happenedAt } });
    await tx.alert.updateMany({
      where: { entityType: "animal", entityId: animal.id, alertType: "animal_missing", status: "open" },
      data: { status: "resolved", resolvedAt: happenedAt },
    });
    await tx.auditLog.create({
      data: {
        id: createId("audit"), actorId: actor.id, entityType: "animal", entityId: animal.id,
        action: "mark_found",
        previousValue: { outcomeStatus: "missing", currentCageId: null },
        newValue: { outcomeStatus: "alive", currentCageId: destination.id, happenedAt: input.happenedAt, reason },
        timestamp: happenedAt,
      },
    });
    return { ok: true, message: `${animal.animalId} marked found in ${destination.barcode}.`, entityId: animal.id };
  };
  return transaction ? operation(transaction) : runSerializableTransaction(operation);
}

export async function executeUpdateAnimalPresenceCommand(input: {
  command: UpdateAnimalPresenceInput;
  actor: ResolvedActor;
  idempotencyKey: string;
  requestId: string;
  expectedVersion: number;
}) {
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: `animal.${input.command.action}`,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: input.command as unknown as Prisma.InputJsonValue,
    requiredCapability: "animals:manage",
    labId: input.actor.canonicalRole === "lab_user" ? input.actor.activeLabId : null,
    aggregateType: "animal",
    aggregateId: input.command.animalId,
    expectedVersion: input.expectedVersion,
    handler: async (tx) => {
      const result = await updateAnimalPresenceStatus(input.command, {
        id: input.actor.id, role: input.actor.role, activeLabId: input.actor.activeLabId,
      }, tx);
      if (!result.ok) return { ok: false as const, code: "validation_error", message: result.message };
      return { ok: true as const, result: { message: result.message, entityId: result.entityId ?? null } };
    },
  });
}

export async function reserveAnimalForExperiment(
  input: ReserveAnimalInput,
  actor: LabActor,
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
        owningLabId: true,
        projectSummary: true,
      },
    }),
    prisma.experiment.findUnique({
      where: { id: input.experimentId },
      select: {
        id: true,
        labId: true,
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

  const reservationAccess = await getActorLabAccess(actor);
  if (
    !animal.owningLabId ||
    animal.owningLabId !== experiment.labId ||
    !canManageLab(reservationAccess, experiment.labId)
  ) {
    return { ok: false, message: "Choose an animal and experiment from the same manageable lab." };
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
  }, { timeout: 15_000, maxWait: 10_000 });

  return {
    ok: true,
    message: `${animal.animalId} reserved for ${experiment.experimentCode}.`,
    entityId: assignmentId,
  };
}

export async function planExperimentCohortAssignments(
  input: PlanExperimentCohortInput,
  actor: LabActor,
): Promise<MutationResult> {
  if (!canReserveAnimal(actor.role)) {
    return { ok: false, message: "Your role cannot plan experiment cohorts." };
  }

  const normalizedStartDate = new Date(input.startDate);

  if (Number.isNaN(normalizedStartDate.getTime())) {
    return { ok: false, message: "Choose a valid planned start date." };
  }

  if (!input.selectedAnimals.length) {
    return { ok: false, message: "Select at least one candidate in the planner before saving a cohort." };
  }

  const experiment = await prisma.experiment.findUnique({
    where: { id: input.experimentId },
    select: {
      id: true,
      labId: true,
      experimentCode: true,
      status: true,
    },
  });

  if (!experiment || experiment.status === "completed" || experiment.status === "cancelled") {
    return { ok: false, message: "Choose an active or planned experiment for the cohort." };
  }

  const cohortAccess = await getActorLabAccess(actor);
  if (!canManageLab(cohortAccess, experiment.labId)) {
    return { ok: false, message: "Choose an active or planned experiment for the cohort." };
  }

  const requestedAnimalIds = [...new Set(input.selectedAnimals.map((animal) => animal.animalId))];
  const treatmentGroupByAnimalId = new Map(
    input.selectedAnimals.map((animal) => [animal.animalId, animal.treatmentGroup.trim() || "Group A"]),
  );
  const animals = await prisma.animal.findMany({
    where: {
      animalId: { in: requestedAnimalIds },
      outcomeStatus: "alive",
      owningLabId: experiment.labId,
    },
    select: {
      id: true,
      labId: true,
      animalId: true,
      status: true,
      experimentAssignments: {
        where: {
          experimentId: input.experimentId,
          status: { in: ["planned", "reserved", "active", "completed"] },
        },
        select: {
          id: true,
        },
      },
    },
  });

  const animalsByAnimalId = new Map(animals.map((animal) => [animal.animalId, animal]));
  const creatableAnimals = requestedAnimalIds
    .map((animalId) => animalsByAnimalId.get(animalId))
    .filter((animal): animal is (typeof animals)[number] => {
      if (!animal) {
        return false;
      }

      return ["colony_holding", "reserved", "experiment_completed"].includes(animal.status) && animal.experimentAssignments.length === 0;
    });

  if (!creatableAnimals.length) {
    return { ok: false, message: `No new planned assignments were created for ${experiment.experimentCode}.` };
  }

  const skippedCount = requestedAnimalIds.length - creatableAnimals.length;
  const timestamp = new Date();

  await prisma.$transaction(async (tx) => {
    for (const animal of creatableAnimals) {
      const assignmentId = createId("assign");
      const treatmentGroup = treatmentGroupByAnimalId.get(animal.animalId) ?? "Group A";

      await tx.experimentAssignment.create({
        data: {
          id: assignmentId,
          animalId: animal.id,
          experimentId: experiment.id,
          status: "planned",
          startDate: normalizedStartDate,
          treatmentGroup,
          notes: input.notes?.trim() || undefined,
          isPrimary: false,
        },
      });

      await tx.auditLog.create({
        data: {
          id: createId("audit"),
          actorId: actor.id,
          entityType: "experiment_assignment",
          entityId: assignmentId,
          action: "plan",
          newValue: {
            experimentId: experiment.id,
            animalId: animal.id,
            startDate: input.startDate,
            treatmentGroup,
            notes: input.notes?.trim() || undefined,
          },
          timestamp,
        },
      });
    }
  }, { timeout: 15_000, maxWait: 10_000 });

  return {
    ok: true,
    message: `Planned ${creatableAnimals.length} cohort assignment${creatableAnimals.length === 1 ? "" : "s"} for ${experiment.experimentCode}.${skippedCount ? ` Skipped ${skippedCount} animal${skippedCount === 1 ? "" : "s"} already linked or no longer eligible.` : ""}`,
  };
}

export async function promotePlannedExperimentAssignments(
  input: { experimentId: string },
  actor: LabActor,
): Promise<MutationResult> {
  if (!canReserveAnimal(actor.role)) {
    return { ok: false, message: "Your role cannot promote planned cohorts." };
  }

  const experiment = await prisma.experiment.findUnique({
    where: { id: input.experimentId },
    select: {
      id: true,
      experimentCode: true,
      labId: true,
      projectId: true,
      project: {
        select: {
          projectCode: true,
        },
      },
      status: true,
      assignments: {
        where: {
          status: "planned",
        },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
        select: {
          id: true,
          animalId: true,
          startDate: true,
          treatmentGroup: true,
          notes: true,
          animal: {
            select: {
              id: true,
              animalId: true,
              owningLabId: true,
              status: true,
              outcomeStatus: true,
              experimentAssignments: {
                where: {
                  status: { in: ["reserved", "active"] },
                },
                select: {
                  id: true,
                  experimentId: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!experiment || experiment.status === "completed" || experiment.status === "cancelled") {
    return { ok: false, message: "Choose an active or planned experiment." };
  }

  if (!canManageLab(await getActorLabAccess(actor), experiment.labId)) {
    return { ok: false, message: "Choose an active or planned experiment." };
  }

  if (!experiment.assignments.length) {
    return { ok: false, message: `No planned cohort assignments are waiting for ${experiment.experimentCode}.` };
  }

  const promotableAssignments = experiment.assignments.filter((assignment) => {
    if (assignment.animal.owningLabId !== experiment.labId) {
      return false;
    }

    if (assignment.animal.outcomeStatus !== "alive") {
      return false;
    }

    if (assignment.animal.status !== "colony_holding") {
      return false;
    }

    return assignment.animal.experimentAssignments.length === 0;
  });

  if (!promotableAssignments.length) {
    return { ok: false, message: `No planned assignments could be promoted for ${experiment.experimentCode}.` };
  }

  const skippedCount = experiment.assignments.length - promotableAssignments.length;
  const timestamp = new Date();

  await prisma.$transaction(async (tx) => {
    for (const assignment of promotableAssignments) {
      await tx.experimentAssignment.update({
        where: { id: assignment.id },
        data: {
          status: "reserved",
        },
      });

      await tx.animal.update({
        where: { id: assignment.animal.id },
        data: {
          status: "reserved",
          experimentalStatus: `Reserved for ${experiment.experimentCode}`,
          projectSummary: experiment.project.projectCode,
        },
      });

      const hasProjectAllocation = await tx.animalProjectAllocation.findFirst({
        where: {
          animalId: assignment.animal.id,
          projectId: experiment.projectId,
          endedAt: null,
        },
        select: { id: true },
      });

      if (!hasProjectAllocation) {
        await tx.animalProjectAllocation.create({
          data: {
            id: createId("alloc"),
            animalId: assignment.animal.id,
            projectId: experiment.projectId,
            startedAt: timestamp,
            chargeable: true,
            notes: `Added automatically during cohort promotion for ${experiment.experimentCode}.`,
          },
        });
      }

      await tx.animalStatusEvent.create({
        data: {
          id: createId("status"),
          animalId: assignment.animal.id,
          fromStatus: "colony_holding",
          toStatus: "reserved",
          happenedAt: timestamp,
          actorId: actor.id,
          reason: `Promoted planned cohort assignment for ${experiment.experimentCode}.`,
        },
      });

      await tx.auditLog.create({
        data: {
          id: createId("audit"),
          actorId: actor.id,
          entityType: "experiment_assignment",
          entityId: assignment.id,
          action: "promote_plan",
          previousValue: {
            status: "planned",
          },
          newValue: {
            status: "reserved",
            treatmentGroup: assignment.treatmentGroup,
            startDate: assignment.startDate.toISOString().slice(0, 10),
          },
          timestamp,
        },
      });
    }
  }, { timeout: 15_000, maxWait: 10_000 });

  return {
    ok: true,
    message: `Promoted ${promotableAssignments.length} planned assignment${promotableAssignments.length === 1 ? "" : "s"} for ${experiment.experimentCode}.${skippedCount ? ` Skipped ${skippedCount} animal${skippedCount === 1 ? "" : "s"} no longer eligible.` : ""}`,
  };
}

export async function demoteReservedExperimentAssignments(
  input: { experimentId: string },
  actor: LabActor,
): Promise<MutationResult> {
  if (!canReserveAnimal(actor.role)) {
    return { ok: false, message: "Your role cannot roll back promoted cohorts." };
  }

  const experiment = await prisma.experiment.findUnique({
    where: { id: input.experimentId },
    select: {
      id: true,
      labId: true,
      experimentCode: true,
      assignments: {
        where: {
          status: "reserved",
        },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
        select: {
          id: true,
          startDate: true,
          treatmentGroup: true,
          animal: {
            select: {
              id: true,
              animalId: true,
              owningLabId: true,
              status: true,
              outcomeStatus: true,
              experimentAssignments: {
                where: {
                  status: { in: ["reserved", "active"] },
                },
                select: {
                  id: true,
                  experimentId: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!experiment) {
    return { ok: false, message: "Choose a valid experiment before rolling back reservations." };
  }

  if (!canManageLab(await getActorLabAccess(actor), experiment.labId)) {
    return { ok: false, message: "Choose a valid experiment before rolling back reservations." };
  }

  if (!experiment.assignments.length) {
    return { ok: false, message: `No reserved cohort assignments are waiting for ${experiment.experimentCode}.` };
  }

  const demotableAssignments = experiment.assignments.filter((assignment) => {
    if (assignment.animal.owningLabId !== experiment.labId) {
      return false;
    }

    if (assignment.animal.outcomeStatus !== "alive") {
      return false;
    }

    if (assignment.animal.status !== "reserved") {
      return false;
    }

    return assignment.animal.experimentAssignments.every((linked) => linked.id === assignment.id);
  });

  if (!demotableAssignments.length) {
    return { ok: false, message: `No reserved cohort assignments could be rolled back for ${experiment.experimentCode}.` };
  }

  const skippedCount = experiment.assignments.length - demotableAssignments.length;
  const timestamp = new Date();

  await prisma.$transaction(async (tx) => {
    for (const assignment of demotableAssignments) {
      await tx.experimentAssignment.update({
        where: { id: assignment.id },
        data: {
          status: "planned",
        },
      });

      await tx.animal.update({
        where: { id: assignment.animal.id },
        data: {
          status: "colony_holding",
          experimentalStatus: "Available for experiment planning",
        },
      });

      await tx.animalStatusEvent.create({
        data: {
          id: createId("status"),
          animalId: assignment.animal.id,
          fromStatus: "reserved",
          toStatus: "colony_holding",
          happenedAt: timestamp,
          actorId: actor.id,
          reason: `Rolled back cohort reservation for ${experiment.experimentCode}.`,
        },
      });

      await tx.auditLog.create({
        data: {
          id: createId("audit"),
          actorId: actor.id,
          entityType: "experiment_assignment",
          entityId: assignment.id,
          action: "demote_reservation",
          previousValue: {
            status: "reserved",
            treatmentGroup: assignment.treatmentGroup,
            startDate: assignment.startDate.toISOString().slice(0, 10),
          },
          newValue: {
            status: "planned",
            treatmentGroup: assignment.treatmentGroup,
            startDate: assignment.startDate.toISOString().slice(0, 10),
          },
          timestamp,
        },
      });
    }
  }, { timeout: 15_000, maxWait: 10_000 });

  return {
    ok: true,
    message: `Rolled back ${demotableAssignments.length} reserved assignment${demotableAssignments.length === 1 ? "" : "s"} for ${experiment.experimentCode}.${skippedCount ? ` Skipped ${skippedCount} animal${skippedCount === 1 ? "" : "s"} with conflicting reservation state.` : ""}`,
  };
}

export async function updatePlannedExperimentAssignment(
  input: {
    assignmentId: string;
    startDate: string;
    treatmentGroup?: string;
    notes?: string;
  },
  actor: LabActor,
): Promise<MutationResult> {
  if (!canReserveAnimal(actor.role)) {
    return { ok: false, message: "Your role cannot edit planned cohorts." };
  }

  const assignment = await prisma.experimentAssignment.findUnique({
    where: { id: input.assignmentId },
    select: {
      id: true,
      status: true,
      startDate: true,
      treatmentGroup: true,
      notes: true,
      experiment: {
        select: {
          id: true,
          experimentCode: true,
          labId: true,
        },
      },
      animal: {
        select: {
          animalId: true,
          owningLabId: true,
        },
      },
    },
  });

  if (!assignment || assignment.status !== "planned") {
    return { ok: false, message: "Only planned assignments can be edited." };
  }

  if (
    assignment.animal.owningLabId !== assignment.experiment.labId ||
    !canManageLab(await getActorLabAccess(actor), assignment.experiment.labId)
  ) {
    return { ok: false, message: "Only planned assignments can be edited." };
  }

  const normalizedStartDate = new Date(input.startDate);

  if (Number.isNaN(normalizedStartDate.getTime())) {
    return { ok: false, message: "Choose a valid planned start date." };
  }

  const normalizedTreatmentGroup = input.treatmentGroup?.trim() || null;
  const normalizedNotes = input.notes?.trim() || null;
  const sameValues =
    assignment.startDate.toISOString().slice(0, 10) === normalizedStartDate.toISOString().slice(0, 10) &&
    (assignment.treatmentGroup ?? null) === normalizedTreatmentGroup &&
    (assignment.notes ?? null) === normalizedNotes;

  if (sameValues) {
    return {
      ok: true,
      message: `${assignment.animal.animalId} is already up to date in ${assignment.experiment.experimentCode}.`,
      entityId: assignment.id,
    };
  }

  const timestamp = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.experimentAssignment.update({
      where: { id: assignment.id },
      data: {
        startDate: normalizedStartDate,
        treatmentGroup: normalizedTreatmentGroup ?? undefined,
        notes: normalizedNotes ?? undefined,
      },
    });

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "experiment_assignment",
        entityId: assignment.id,
        action: "update_plan",
        previousValue: {
          startDate: assignment.startDate.toISOString().slice(0, 10),
          treatmentGroup: assignment.treatmentGroup,
          notes: assignment.notes,
        },
        newValue: {
          startDate: normalizedStartDate.toISOString().slice(0, 10),
          treatmentGroup: normalizedTreatmentGroup,
          notes: normalizedNotes,
        },
        timestamp,
      },
    });
  }, { timeout: 15_000, maxWait: 10_000 });

  return {
    ok: true,
    message: `Updated planned assignment for ${assignment.animal.animalId} in ${assignment.experiment.experimentCode}.`,
    entityId: assignment.id,
  };
}

export async function deletePlannedExperimentAssignment(
  input: { assignmentId: string },
  actor: LabActor,
): Promise<MutationResult> {
  if (!canReserveAnimal(actor.role)) {
    return { ok: false, message: "Your role cannot remove planned cohorts." };
  }

  const assignment = await prisma.experimentAssignment.findUnique({
    where: { id: input.assignmentId },
    select: {
      id: true,
      status: true,
      startDate: true,
      treatmentGroup: true,
      notes: true,
      experiment: {
        select: {
          experimentCode: true,
          labId: true,
        },
      },
      animal: {
        select: {
          animalId: true,
          owningLabId: true,
        },
      },
    },
  });

  if (!assignment || assignment.status !== "planned") {
    return { ok: false, message: "Only planned assignments can be removed." };
  }

  if (
    assignment.animal.owningLabId !== assignment.experiment.labId ||
    !canManageLab(await getActorLabAccess(actor), assignment.experiment.labId)
  ) {
    return { ok: false, message: "Only planned assignments can be removed." };
  }

  const timestamp = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.experimentAssignment.delete({
      where: { id: assignment.id },
    });

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "experiment_assignment",
        entityId: assignment.id,
        action: "delete_plan",
        previousValue: {
          startDate: assignment.startDate.toISOString().slice(0, 10),
          treatmentGroup: assignment.treatmentGroup,
          notes: assignment.notes,
        },
        timestamp,
      },
    });
  }, { timeout: 15_000, maxWait: 10_000 });

  return {
    ok: true,
    message: `Removed planned assignment for ${assignment.animal.animalId} from ${assignment.experiment.experimentCode}.`,
    entityId: assignment.id,
  };
}

export async function createBreedingSetup(
  input: CreateBreedingSetupInput,
  actor: LabActor,
  transaction?: Prisma.TransactionClient,
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

  const operation = async (tx: Prisma.TransactionClient): Promise<MutationResult> => {
  const [sire, dam, minAgeRule] = await Promise.all([
    tx.animal.findUnique({
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
        currentCage: { select: { id: true, active: true, status: true } },
      },
    }),
    tx.animal.findUnique({
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
        currentCage: { select: { id: true, active: true, status: true } },
      },
    }),
    tx.ruleConfig.findUnique({
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

  const breedingAccess = await getActorLabAccess(actor, tx);
  if (
    !sire.owningLabId ||
    sire.owningLabId !== dam.owningLabId ||
    !canManageLab(breedingAccess, sire.owningLabId)
  ) {
    return { ok: false, message: "Choose breeders from the same manageable lab." };
  }

  if (sire.sex !== "male") {
    return { ok: false, message: `${sire.animalId} is not marked as a male breeder.` };
  }

  if (dam.sex !== "female") {
    return { ok: false, message: `${dam.animalId} is not marked as a female breeder.` };
  }

  if (!sire.currentCage || !dam.currentCage) {
    return { ok: false, message: "Both breeders need an active cage assignment before starting breeding." };
  }
  if (sire.currentCage.id !== dam.currentCage.id) {
    return { ok: false, message: "Move the sire and dam into the same mating cage before starting breeding." };
  }
  if (
    !sire.currentCage.active ||
    !dam.currentCage.active ||
    !["active", "breeding"].includes(sire.currentCage.status) ||
    !["active", "breeding"].includes(dam.currentCage.status)
  ) {
    return { ok: false, message: "The mating cage must be active and available for breeding." };
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
  const startDate = new Date(input.startDate);
  if (Number.isNaN(startDate.getTime())) {
    return { ok: false, message: "Choose a valid breeding start date." };
  }
  if (startDate.getTime() > timestamp.getTime()) {
    return { ok: false, message: "Breeding start date cannot be in the future." };
  }
  const breedingId = createId("breeding");
  const targetSex = input.targetSex && input.targetSex !== "unknown" ? input.targetSex : null;

    await tx.breedingSetup.create({
      data: {
        id: breedingId,
        labId: sire.owningLabId!,
        startDate,
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

    const cageStatusChanges = await reconcileBreedingCageStatuses({
      tx,
      labId: sire.owningLabId!,
      actorId: actor.id,
      effectiveAt: startDate,
      auditTimestamp: timestamp,
      reason: `Assigned to breeding setup ${breedingId}.`,
      candidateCageIds: [sire.currentCage.id],
    });

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
          cageStatusChanges,
        },
        timestamp,
      },
    });

    return {
    ok: true,
    message: `Breeding setup created for ${sire.animalId} and ${dam.animalId}.`,
    entityId: breedingId,
    };
  };

  return transaction ? operation(transaction) : runSerializableTransaction(operation);
}

type BreedingCageStatusChange = {
  cageId: string;
  barcode: string;
  previousStatus: "active" | "breeding";
  status: "active" | "breeding";
  liveBreederCount: number;
};

export async function reconcileBreedingCageStatuses(input: {
  tx: Prisma.TransactionClient;
  labId: string;
  actorId: string;
  effectiveAt: Date;
  auditTimestamp: Date;
  reason: string;
  candidateCageIds?: string[];
}) {
  const candidateCageIds = [...new Set(input.candidateCageIds ?? [])];
  const cages = await input.tx.cage.findMany({
    where: {
      labId: input.labId,
      active: true,
      status: { in: ["active", "breeding"] },
      OR: [
        { status: "breeding" },
        ...(candidateCageIds.length ? [{ id: { in: candidateCageIds } }] : []),
      ],
    },
    select: { id: true, barcode: true, status: true },
  });
  const changes: BreedingCageStatusChange[] = [];

  for (const cage of cages) {
    const liveBreederCount = await input.tx.animal.count({
      where: {
        currentCageId: cage.id,
        outcomeStatus: "alive",
        breedingAdults: {
          some: { breedingSetup: { status: { in: ["active", "paused"] } } },
        },
      },
    });
    const status = liveBreederCount > 0 ? "breeding" : "active";
    if (cage.status === status) continue;

    await input.tx.cage.update({
      where: { id: cage.id },
      data: { status, lastUpdatedAt: input.auditTimestamp, version: { increment: 1 } },
    });
    await input.tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: input.actorId,
        entityType: "cage",
        entityId: cage.id,
        action: "reconcile_breeding_status",
        previousValue: { status: cage.status },
        newValue: {
          status,
          barcode: cage.barcode,
          liveBreederCount,
          effectiveAt: input.effectiveAt.toISOString(),
          reason: input.reason,
        },
        timestamp: input.auditTimestamp,
      },
    });
    changes.push({
      cageId: cage.id,
      barcode: cage.barcode,
      previousStatus: cage.status as "active" | "breeding",
      status,
      liveBreederCount,
    });
  }

  return changes;
}

export async function executeCreateBreedingSetupCommand(input: {
  actor: ResolvedActor;
  command: CreateBreedingSetupInput;
  idempotencyKey: string;
  requestId: string;
}) {
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "breeding_setup.create",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: input.command as unknown as Prisma.InputJsonValue,
    requiredCapability: "breeding:manage",
    labId: input.actor.canonicalRole === "lab_user" ? input.actor.activeLabId : null,
    handler: async (tx) => {
      const result = await createBreedingSetup(input.command, input.actor, tx);
      return result.ok
        ? {
            ok: true as const,
            result: { message: result.message, entityId: result.entityId ?? null },
            aggregateType: "breeding_setup",
            aggregateId: result.entityId,
            resultingVersion: 1,
          }
        : { ok: false as const, code: "validation_error", message: result.message };
    },
  });
}

export async function transitionBreedingSetup(
  input: TransitionBreedingSetupInput,
  actor: LabActor,
  transaction?: Prisma.TransactionClient,
): Promise<MutationResult> {
  if (!canCreateBreeding(actor.role)) {
    return { ok: false, message: "Your role cannot change breeding setup status." };
  }

  const operation = async (tx: Prisma.TransactionClient): Promise<MutationResult> => {
    const breeding = await tx.breedingSetup.findUnique({
      where: { id: input.breedingSetupId },
      select: {
        id: true,
        labId: true,
        status: true,
        startDate: true,
        endDate: true,
        version: true,
        litters: {
          orderBy: [{ birthDate: "desc" }, { id: "desc" }],
          take: 1,
          select: { birthDate: true },
        },
        adults: {
          select: {
            role: true,
            animal: {
              select: {
                id: true,
                animalId: true,
                status: true,
                outcomeStatus: true,
                currentCageId: true,
                currentCage: { select: { id: true, active: true, status: true } },
                experimentAssignments: {
                  where: { status: { in: ["planned", "reserved", "active"] } },
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    });
    if (!breeding || !canManageLab(await getActorLabAccess(actor, tx), breeding.labId)) {
      return { ok: false, message: "Breeding setup not found." };
    }
    if (breeding.status === input.targetStatus) {
      return {
        ok: true,
        message: `Breeding setup ${breeding.id} is already ${input.targetStatus}.`,
        entityId: breeding.id,
        resultingVersion: breeding.version,
      };
    }

    const happenedAt = new Date(input.happenedAt);
    const auditTimestamp = new Date();
    const reason = input.reason.trim();
    const priorTransitionAudits = await tx.auditLog.findMany({
      where: {
        entityType: "breeding_setup",
        entityId: breeding.id,
        action: "transition_status",
      },
      select: { newValue: true },
    });
    const latestEffectiveDate = priorTransitionAudits.reduce<Date | null>((latest, audit) => {
      if (!audit.newValue || typeof audit.newValue !== "object" || Array.isArray(audit.newValue)) return latest;
      const value = (audit.newValue as Prisma.JsonObject).happenedAt;
      if (typeof value !== "string") return latest;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return latest;
      return !latest || parsed.getTime() > latest.getTime() ? parsed : latest;
    }, null);
    const transitionError = validateBreedingTransition({
      fromStatus: breeding.status,
      toStatus: input.targetStatus,
      startDate: breeding.startDate,
      happenedAt,
      reason,
      latestEffectiveDate,
      latestLitterDate: breeding.litters[0]?.birthDate ?? null,
      now: auditTimestamp,
    });
    if (transitionError) return { ok: false, message: transitionError };

    if (input.targetStatus === "active") {
      const sireCount = breeding.adults.filter((adult) => adult.role === "sire").length;
      const damCount = breeding.adults.filter((adult) => adult.role === "dam").length;
      const matingCageIds = new Set(breeding.adults.map(({ animal }) => animal.currentCageId).filter(Boolean));
      if (sireCount !== 1 || damCount < 1) {
        return { ok: false, message: "Active breeding requires exactly one sire and at least one dam." };
      }
      if (matingCageIds.size !== 1 || breeding.adults.some(({ animal }) => !animal.currentCageId)) {
        return { ok: false, message: "All breeding adults must share one active mating cage before breeding can resume." };
      }
      for (const { animal } of breeding.adults) {
        if (animal.outcomeStatus !== "alive") {
          return { ok: false, message: `${animal.animalId} is not available to resume breeding.` };
        }
        if (!animal.currentCage || !animal.currentCage.active || !["active", "breeding"].includes(animal.currentCage.status)) {
          return { ok: false, message: `${animal.animalId} needs an active non-quarantine cage before breeding can resume.` };
        }
        if (animal.experimentAssignments.length) {
          return { ok: false, message: `${animal.animalId} has an active experiment assignment.` };
        }
      }
    }

    const updated = await tx.breedingSetup.updateMany({
      where: { id: breeding.id, version: breeding.version, status: breeding.status },
      data: {
        status: input.targetStatus,
        endDate: isTerminalBreedingStatus(input.targetStatus) ? happenedAt : null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      return { ok: false, message: "Breeding setup changed before this transition was saved." };
    }

    const terminal = isTerminalBreedingStatus(input.targetStatus);
    const cageIds = [...new Set(breeding.adults.map(({ animal }) => animal.currentCageId).filter(Boolean))] as string[];
    for (const { animal } of breeding.adults) {
      if (input.targetStatus === "active" && animal.status !== "breeding") {
        await tx.animal.update({ where: { id: animal.id }, data: { status: "breeding", version: { increment: 1 } } });
        await tx.animalStatusEvent.create({
          data: {
            id: createId("status"),
            animalId: animal.id,
            fromStatus: animal.status,
            toStatus: "breeding",
            happenedAt,
            actorId: actor.id,
            reason,
          },
        });
      }
      if (terminal && animal.status === "breeding" && animal.outcomeStatus === "alive") {
        const otherBreeding = await tx.breedingAdult.findFirst({
          where: {
            animalId: animal.id,
            breedingSetup: { status: { in: ["planned", "active", "paused"] } },
          },
          select: { id: true },
        });
        if (!otherBreeding) {
          await tx.animal.update({
            where: { id: animal.id },
            data: { status: "colony_holding", version: { increment: 1 } },
          });
          await tx.animalStatusEvent.create({
            data: {
              id: createId("status"),
              animalId: animal.id,
              fromStatus: animal.status,
              toStatus: "colony_holding",
              happenedAt,
              actorId: actor.id,
              reason,
            },
          });
        }
      }
    }

    const cageStatusChanges = input.targetStatus === "active" || terminal
      ? await reconcileBreedingCageStatuses({
          tx,
          labId: breeding.labId,
          actorId: actor.id,
          effectiveAt: happenedAt,
          auditTimestamp,
          reason,
          candidateCageIds: cageIds,
        })
      : [];

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "breeding_setup",
        entityId: breeding.id,
        action: "transition_status",
        previousValue: {
          status: breeding.status,
          endDate: breeding.endDate?.toISOString() ?? null,
          version: breeding.version,
        },
        newValue: {
          status: input.targetStatus,
          happenedAt: happenedAt.toISOString(),
          reason,
          version: breeding.version + 1,
          adults: breeding.adults.map(({ animal, role }) => ({ animalId: animal.id, role })),
          cageStatusChanges,
        },
        timestamp: auditTimestamp,
      },
    });

    return {
      ok: true,
      message: `Breeding setup ${breeding.id} marked ${input.targetStatus}.`,
      entityId: breeding.id,
      resultingVersion: breeding.version + 1,
    };
  };

  return transaction ? operation(transaction) : runSerializableTransaction(operation);
}

export async function executeTransitionBreedingSetupCommand(input: {
  actor: ResolvedActor;
  command: TransitionBreedingSetupInput;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
}) {
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "breeding_setup.transition",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: input.command as unknown as Prisma.InputJsonValue,
    requiredCapability: "breeding:manage",
    labId: input.actor.activeLabId,
    aggregateType: "breeding_setup",
    aggregateId: input.command.breedingSetupId,
    expectedVersion: input.expectedVersion,
    handler: async (tx) => {
      const result = await transitionBreedingSetup(input.command, input.actor, tx);
      return result.ok
        ? {
            ok: true as const,
            result: { message: result.message, entityId: result.entityId ?? null },
            aggregateType: "breeding_setup",
            aggregateId: result.entityId,
            resultingVersion: result.resultingVersion,
          }
        : { ok: false as const, code: "validation_error", message: result.message };
    },
  });
}

export async function recordBreedingLitter(
  input: CreateLitterInput,
  actor: LabActor,
  transaction?: Prisma.TransactionClient,
): Promise<MutationResult> {
  if (!canRecordLitter(actor.role)) {
    return { ok: false, message: "Your role cannot record litters." };
  }

  const operation = async (tx: Prisma.TransactionClient): Promise<MutationResult> => {
  const breeding = await tx.breedingSetup.findUnique({
    where: { id: input.breedingSetupId },
    select: {
      id: true,
      labId: true,
      status: true,
      startDate: true,
      adults: {
        select: {
          role: true,
          animal: {
            select: {
              owningLabId: true,
              outcomeStatus: true,
              currentCageId: true,
              currentCage: { select: { active: true, status: true } },
            },
          },
        },
      },
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

  const litterAccess = await getActorLabAccess(actor, tx);
  const breedingLabIds = [...new Set(breeding.adults.map((adult) => adult.animal.owningLabId).filter(Boolean))];
  if (
    breedingLabIds.length !== 1 ||
    breedingLabIds[0] !== breeding.labId ||
    !canManageLab(litterAccess, breeding.labId)
  ) {
    return { ok: false, message: "Breeding setup not found." };
  }

  if (breeding.status !== "active") {
    return { ok: false, message: "Only active breeding setups can receive a litter record." };
  }

  const sireCount = breeding.adults.filter((adult) => adult.role === "sire").length;
  const damCount = breeding.adults.filter((adult) => adult.role === "dam").length;
  const matingCageIds = new Set(breeding.adults.map((adult) => adult.animal.currentCageId).filter(Boolean));
  const invalidAdult = breeding.adults.find(({ animal }) =>
    animal.outcomeStatus !== "alive"
    || !animal.currentCage
    || !animal.currentCage.active
    || !["active", "breeding"].includes(animal.currentCage.status));
  if (sireCount !== 1 || damCount < 1 || matingCageIds.size !== 1 || invalidAdult) {
    return {
      ok: false,
      message: "Resolve the breeding adults and shared active mating cage before recording a litter.",
    };
  }

  const normalizedBirthDate = new Date(input.birthDate);
  const timestamp = new Date();

  if (Number.isNaN(normalizedBirthDate.getTime())) {
    return { ok: false, message: "Choose a valid litter birth date." };
  }

  if (normalizedBirthDate.getTime() < breeding.startDate.getTime()) {
    return { ok: false, message: "Litter birth date cannot be earlier than the breeding start date." };
  }
  if (normalizedBirthDate.getTime() > timestamp.getTime()) {
    return { ok: false, message: "Litter birth date cannot be in the future." };
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
    const advancedBreeding = await tx.breedingSetup.update({
      where: { id: breeding.id },
      data: { version: { increment: 1 } },
      select: { version: true },
    });
  return {
    ok: true,
    message: `Litter recorded for ${breeding.id}.`,
    entityId: litterId,
    resultingVersion: advancedBreeding.version,
  };
  };
  return transaction ? operation(transaction) : runSerializableTransaction(operation);
}

export async function executeRecordBreedingLitterCommand(input: {
  command: CreateLitterInput;
  actor: ResolvedActor;
  idempotencyKey: string;
  requestId: string;
  expectedVersion: number;
}) {
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "breeding.record_litter",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: input.command as unknown as Prisma.InputJsonValue,
    requiredCapability: "breeding:manage",
    labId: input.actor.canonicalRole === "lab_user" ? input.actor.activeLabId : null,
    aggregateType: "breeding_setup",
    aggregateId: input.command.breedingSetupId,
    expectedVersion: input.expectedVersion,
    handler: async (tx) => {
      const result = await recordBreedingLitter(input.command, {
        id: input.actor.id, role: input.actor.role, activeLabId: input.actor.activeLabId,
      }, tx);
      if (!result.ok) return { ok: false as const, code: "validation_error", message: result.message };
      return {
        ok: true as const,
        result: { message: result.message, entityId: result.entityId ?? null },
        resultingVersion: result.resultingVersion,
      };
    },
  });
}

export async function weanLitterToCages(
  input: WeanLitterInput,
  actor: LabActor,
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

  const actorAccess = await getActorLabAccess(actor);

  const [litter, strain, femaleCage, maleCage] = await Promise.all([
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
            labId: true,
            adults: {
              orderBy: [{ role: "asc" }, { id: "asc" }],
              select: {
                role: true,
                animal: {
                  select: {
                    id: true,
                    animalId: true,
                    projectSummary: true,
                    owningLabId: true,
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
          select: { id: true, status: true, active: true, barcode: true, labId: true },
        })
      : Promise.resolve(null),
    input.maleCageId
      ? prisma.cage.findUnique({
          where: { id: input.maleCageId },
          select: { id: true, status: true, active: true, barcode: true, labId: true },
        })
      : Promise.resolve(null),
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
    return { ok: false, message: "You cannot wean a litter owned by another lab." };
  }

  const blockedCageStatuses = new Set(["closed", "retired"]);

  if (input.femaleCount > 0 && (!femaleCage || !femaleCage.active || blockedCageStatuses.has(femaleCage.status))) {
    return { ok: false, message: "Choose an active female holding cage for the weaned litter." };
  }

  if (input.maleCount > 0 && (!maleCage || !maleCage.active || blockedCageStatuses.has(maleCage.status))) {
    return { ok: false, message: "Choose an active male holding cage for the weaned litter." };
  }

  const destinationLabIds = new Set(
    [femaleCage?.labId, maleCage?.labId].filter((labId): labId is string => Boolean(labId)),
  );
  if ([...destinationLabIds].some((labId) => labId !== breedingLabId)) {
    return { ok: false, message: "Wean progeny into cages owned by the breeding setup's lab." };
  }

  const sire = litter.breedingSetup.adults.find((adult) => adult.role === "sire")?.animal ?? null;
  const dam = litter.breedingSetup.adults.find((adult) => adult.role === "dam")?.animal ?? null;
  const projectSummaryCandidates = new Set(
    litter.breedingSetup.adults
      .map((adult) => adult.animal?.projectSummary ?? null)
      .filter((value): value is string => Boolean(value)),
  );
  const inheritedProjectSummary = projectSummaryCandidates.size === 1 ? [...projectSummaryCandidates][0] : undefined;
  const timestamp = new Date();

  const weaningResult = await runSerializableTransaction(async (tx) => {
    const freshLitter = await tx.litter.findUnique({
      where: { id: litter.id },
      select: {
        birthDate: true,
        litterSizeBirth: true,
        litterSizeWean: true,
        _count: { select: { litterAnimals: true } },
      },
    });

    if (!freshLitter) {
      return { ok: false as const, message: "Litter not found." };
    }

    if (freshLitter.litterSizeWean !== null || freshLitter._count.litterAnimals > 0) {
      return { ok: false as const, message: "This litter already has a recorded weaning outcome." };
    }

    if (totalWeaned > freshLitter.litterSizeBirth) {
      return { ok: false as const, message: "Weaning count cannot exceed the recorded litter size at birth." };
    }

    const freshIdentifiers = buildNextAnimalIdentifiers(
      await tx.animal.findMany({ select: { animalId: true, labId: true } }),
      freshLitter.birthDate.getUTCFullYear(),
      totalWeaned,
    );
    const facilityAnimalIds = await allocateFacilityIdentifiers(tx, "animal", totalWeaned);
    const animalsToCreate = [
      ...Array.from({ length: input.femaleCount }, (_, index) => ({
        id: createId("animal"),
        facilityAnimalId: facilityAnimalIds[index],
        sex: "female" as const,
        currentCageId: input.femaleCageId!,
        owningLabId: femaleCage!.labId,
        identifiers: freshIdentifiers[index],
      })),
      ...Array.from({ length: input.maleCount }, (_, index) => ({
        id: createId("animal"),
        facilityAnimalId: facilityAnimalIds[input.femaleCount + index],
        sex: "male" as const,
        currentCageId: input.maleCageId!,
        owningLabId: maleCage!.labId,
        identifiers: freshIdentifiers[input.femaleCount + index],
      })),
    ];
    const plannedAssignments = [
      { cageId: input.femaleCageId, count: input.femaleCount },
      { cageId: input.maleCageId, count: input.maleCount },
    ].filter((assignment): assignment is { cageId: string; count: number } => Boolean(assignment.cageId && assignment.count));

    for (const assignment of plannedAssignments) {
      const capacityCheck = await validateProjectedCageOccupancy(
        tx,
        assignment.cageId,
        assignment.count,
        actorAccess,
      );

      if (!capacityCheck.ok) {
        return capacityCheck;
      }
    }

    await tx.animal.createMany({
      data: animalsToCreate.map((animal) => ({
        id: animal.id,
        facilityAnimalId: animal.facilityAnimalId,
        animalId: animal.identifiers.animalId,
        labId: animal.identifiers.labId,
        sex: animal.sex,
        dob: litter.birthDate,
        strainId: strain.id,
        currentCageId: animal.currentCageId,
        owningLabId: animal.owningLabId,
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
    return { ok: true as const };
  });

  if (!weaningResult.ok) {
    return weaningResult;
  }

  return {
    ok: true,
    message: `${totalWeaned} pups weaned from ${litter.id} and assigned to holding cages.`,
    entityId: litter.id,
  };
}

export async function recordAnimalGenotype(
  input: RecordAnimalGenotypeInput,
  actor: LabActor,
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
        owningLabId: true,
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

  const genotypeAccess = await getActorLabAccess(actor);
  if (!canManageLab(genotypeAccess, animal.owningLabId)) {
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
    const preparedAttachment = input.attachment
      ? await prepareAttachmentUpload(input.attachment, "genotyping-records").catch((error) => {
          if (error instanceof Error) {
            return error;
          }

          return new Error("Unable to store the uploaded genotype attachment.");
        })
      : null;

    if (preparedAttachment instanceof Error) {
      return { ok: false, message: preparedAttachment.message };
    }

    if (preparedAttachment) {
      try {
        await prisma.$transaction(async (tx) => {
          await createAttachmentRecord(tx, {
            actorId: actor.id,
            labId: animal.owningLabId!,
            timestamp: new Date(),
            preparedAttachment,
            animalId: animal.id,
            genotypingRecordId: existingRecord.id,
          });
        }, { timeout: 15_000, maxWait: 10_000 });
      } catch (error) {
        await removeStoredAttachment(preparedAttachment.storageUrl);
        throw error;
      }
    }

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
  const preparedAttachment = input.attachment
    ? await prepareAttachmentUpload(input.attachment, "genotyping-records").catch((error) => {
        if (error instanceof Error) {
          return error;
        }

        return new Error("Unable to store the uploaded genotype attachment.");
      })
    : null;

  if (preparedAttachment instanceof Error) {
    return { ok: false, message: preparedAttachment.message };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.genotypingRecord.create({
        data: {
          id: recordId,
          labId: animal.owningLabId!,
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

      if (preparedAttachment) {
        await createAttachmentRecord(tx, {
          actorId: actor.id,
          labId: animal.owningLabId!,
          timestamp,
          preparedAttachment,
          animalId: animal.id,
          genotypingRecordId: recordId,
        });
      }

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
            sampleId: normalizedSampleId,
            sourceType: input.sourceType.trim(),
            assayType: input.assayType.trim(),
            provider: normalizedProvider,
            attachmentLabel: preparedAttachment?.label ?? null,
          },
          timestamp,
        },
      });
    }, { timeout: 15_000, maxWait: 10_000 });
  } catch (error) {
    if (preparedAttachment) {
      await removeStoredAttachment(preparedAttachment.storageUrl);
    }

    throw error;
  }

  return {
    ok: true,
    message: `${allele.name} genotype recorded for ${animal.animalId}.`,
    entityId: recordId,
  };
}

export async function importGenotypeCsvBatch(
  input: ImportGenotypeCsvInput,
  actor: LabActor,
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

  const genotypeAccess = await getActorLabAccess(actor);
  const [animals, alleles] = await Promise.all([
    prisma.animal.findMany({
      where: genotypeAccess.canViewAll
        ? undefined
        : { owningLabId: { in: genotypeAccess.manageableLabIds } },
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

export async function createSampleRecord(
  input: CreateSampleRecordInput,
  actor: LabActor,
): Promise<MutationResult> {
  if (!canRecordSample(actor.role)) {
    return { ok: false, message: "Your role cannot record new sample inventory." };
  }
  const normalizedCollectedAt = new Date(input.collectedAt);
  if (Number.isNaN(normalizedCollectedAt.getTime())) {
    return { ok: false, message: "Choose a valid collection date for the sample record." };
  }
  const normalizedSampleLabel = input.sampleLabel.trim();
  const normalizedSampleType = input.sampleType.trim();
  const normalizedStorageLocation = input.storageLocation?.trim() || null;
  const normalizedQuantityLabel = input.quantityLabel?.trim() || null;
  const normalizedNotes = input.notes?.trim() || null;
  if (normalizedSampleLabel.length < 3) {
    return { ok: false, message: "Enter a unique sample label with at least 3 characters." };
  }
  if (normalizedSampleType.length < 2) {
    return { ok: false, message: "Enter a sample type before saving." };
  }
  const storageError = validateBiosampleStorage({
    status: input.status,
    storageLocation: normalizedStorageLocation,
    quantityLabel: normalizedQuantityLabel,
  });
  if (storageError) return { ok: false, message: storageError };

  try {
    return await runSerializableTransaction(async (tx) => {
      const access = await getActorLabAccess(actor, tx);
      const [animal, project, experiment] = await Promise.all([
        tx.animal.findUnique({
          where: { id: input.animalId },
          select: { id: true, animalId: true, owningLabId: true, dob: true },
        }),
        input.projectId
          ? tx.project.findUnique({ where: { id: input.projectId }, select: { id: true, labId: true } })
          : Promise.resolve(null),
        input.experimentId
          ? tx.experiment.findUnique({
              where: { id: input.experimentId },
              select: { id: true, labId: true, projectId: true, experimentCode: true, status: true },
            })
          : Promise.resolve(null),
      ]);

      if (!animal || !canManageLab(access, animal.owningLabId)) {
        return { ok: false as const, message: "Animal not found." };
      }
      if (normalizedCollectedAt.getTime() < animal.dob.getTime()) {
        return { ok: false as const, message: "Sample collection date cannot be earlier than the animal date of birth." };
      }
      if (input.projectId && (!project || project.labId !== animal.owningLabId)) {
        return { ok: false as const, message: "Choose a project owned by the animal's lab." };
      }
      if (
        input.experimentId &&
        (!experiment ||
          experiment.labId !== animal.owningLabId ||
          !["planned", "active"].includes(experiment.status))
      ) {
        return { ok: false as const, message: "Choose an experiment owned by the animal's lab." };
      }
      if (project && experiment && project.id !== experiment.projectId) {
        return { ok: false as const, message: "The selected project and experiment must match." };
      }

      const recordId = createId("sample");
      const projectId = project?.id ?? experiment?.projectId ?? null;
      const timestamp = new Date();
      await tx.sampleRecord.create({
        data: {
          id: recordId,
          labId: animal.owningLabId,
          animalId: animal.id,
          projectId,
          experimentId: experiment?.id ?? null,
          sampleLabel: normalizedSampleLabel,
          sampleType: normalizedSampleType,
          status: input.status,
          collectedAt: normalizedCollectedAt,
          storageLocation: normalizedStorageLocation,
          quantityLabel: normalizedQuantityLabel,
          notes: normalizedNotes,
          createdById: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          id: createId("audit"),
          actorId: actor.id,
          entityType: "sample_record",
          entityId: recordId,
          action: "create",
          newValue: {
            labId: animal.owningLabId,
            animalId: animal.id,
            projectId,
            experimentId: experiment?.id ?? null,
            sampleLabel: normalizedSampleLabel,
            sampleType: normalizedSampleType,
            status: input.status,
            collectedAt: normalizedCollectedAt.toISOString(),
            storageLocation: normalizedStorageLocation,
            quantityLabel: normalizedQuantityLabel,
            notes: normalizedNotes,
          },
          timestamp,
        },
      });
      return {
        ok: true as const,
        message: `Sample ${normalizedSampleLabel} recorded for ${animal.animalId}.`,
        entityId: recordId,
        resultingVersion: 1,
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.sampleRecord.findUnique({
        where: { sampleLabel: normalizedSampleLabel },
        select: {
          id: true,
          labId: true,
          animalId: true,
          projectId: true,
          experimentId: true,
          sampleLabel: true,
          sampleType: true,
          status: true,
          collectedAt: true,
          storageLocation: true,
          quantityLabel: true,
          notes: true,
          animal: { select: { animalId: true, owningLabId: true } },
        },
      });
      if (
        existing &&
        existing.animalId === input.animalId &&
        existing.labId === existing.animal.owningLabId &&
        biosampleReplayMatches(
          {
            animalId: existing.animalId,
            labId: existing.labId,
            projectRef: existing.projectId,
            experimentId: existing.experimentId,
            sampleLabel: existing.sampleLabel,
            sampleType: existing.sampleType,
            status: existing.status,
            collectedAt: existing.collectedAt,
            storageLocation: existing.storageLocation,
            quantityLabel: existing.quantityLabel,
            notes: existing.notes,
          },
          {
            animalId: input.animalId,
            labId: existing.animal.owningLabId,
            projectRef: input.projectId ?? (input.experimentId ? existing.projectId : null),
            experimentId: input.experimentId,
            sampleLabel: normalizedSampleLabel,
            sampleType: normalizedSampleType,
            status: input.status,
            collectedAt: normalizedCollectedAt,
            storageLocation: normalizedStorageLocation,
            quantityLabel: normalizedQuantityLabel,
            notes: normalizedNotes,
          },
        )
      ) {
        return {
          ok: true,
          message: `Sample ${normalizedSampleLabel} is already recorded for ${existing.animal.animalId}.`,
          entityId: existing.id,
        };
      }
      return { ok: false, message: "Sample label already exists. Use a unique label for this inventory record." };
    }
    throw error;
  }
}

export async function updateSampleRecord(
  input: UpdateSampleRecordInput,
  actor: LabActor,
): Promise<MutationResult> {
  if (!canRecordSample(actor.role)) {
    return { ok: false, message: "Your role cannot update sample inventory." };
  }

  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    return { ok: false, message: "Refresh the biosample row before saving." };
  }

  return runSerializableTransaction(async (tx) => {
    const [sample, access] = await Promise.all([
      tx.sampleRecord.findUnique({
        where: { id: input.sampleId },
        select: {
          id: true,
          labId: true,
          sampleLabel: true,
          projectId: true,
          experimentId: true,
          status: true,
          storageLocation: true,
          quantityLabel: true,
          notes: true,
          version: true,
          animal: { select: { animalId: true } },
        },
      }),
      getActorLabAccess(actor, tx),
    ]);
    if (!sample || !canManageLab(access, sample.labId)) {
      return { ok: false as const, message: "Sample record not found." };
    }
    if (sample.version !== input.expectedVersion) {
      return { ok: false as const, message: "This biosample changed after you opened it. Refresh and try again." };
    }

    const normalizedStatus = input.status ?? sample.status;
    const normalizedStorage = input.storageLocation === undefined
      ? sample.storageLocation
      : input.storageLocation?.trim() || null;
    const normalizedQuantity = input.quantityLabel === undefined
      ? sample.quantityLabel
      : input.quantityLabel?.trim() || null;
    const normalizedNotes = input.notes === undefined ? sample.notes : input.notes?.trim() || null;
    const transitionError = validateBiosampleTransition(sample.status, normalizedStatus);
    if (transitionError) return { ok: false as const, message: transitionError };
    const storageError = validateBiosampleStorage({
      status: normalizedStatus,
      storageLocation: normalizedStorage,
      quantityLabel: normalizedQuantity,
    });
    if (storageError) return { ok: false as const, message: storageError };

    let experimentId = sample.experimentId;
    let projectId = sample.projectId;
    if (input.experimentId !== undefined) {
      if (input.experimentId === null) {
        experimentId = null;
      } else {
        const experiment = await tx.experiment.findUnique({
          where: { id: input.experimentId },
          select: { id: true, labId: true, projectId: true, status: true },
        });
        if (!experiment || experiment.labId !== sample.labId) {
          return { ok: false as const, message: "Experiment not found for this biosample's lab." };
        }
        if (
          experiment.id !== sample.experimentId &&
          experiment.status !== "planned" &&
          experiment.status !== "active"
        ) {
          return { ok: false as const, message: "Only planned or active experiments can receive a new biosample link." };
        }
        if (projectId && projectId !== experiment.projectId) {
          return { ok: false as const, message: "The linked experiment must use the biosample's project." };
        }
        experimentId = experiment.id;
        projectId ??= experiment.projectId;
      }
    }

    const previousValue = {
      projectId: sample.projectId,
      experimentId: sample.experimentId,
      status: sample.status,
      storageLocation: sample.storageLocation,
      quantityLabel: sample.quantityLabel,
      notes: sample.notes,
      version: sample.version,
    };
    const nextValue = {
      projectId,
      experimentId,
      status: normalizedStatus,
      storageLocation: normalizedStorage,
      quantityLabel: normalizedQuantity,
      notes: normalizedNotes,
      version: sample.version + 1,
    };
    if (canonicalJsonHash(previousValue) === canonicalJsonHash({ ...nextValue, version: sample.version })) {
      return {
        ok: true as const,
        message: `Sample ${sample.sampleLabel} is already up to date for ${sample.animal.animalId}.`,
        entityId: sample.id,
        resultingVersion: sample.version,
      };
    }

    const updated = await tx.sampleRecord.updateMany({
      where: { id: sample.id, version: sample.version },
      data: {
        projectId,
        experimentId,
        status: normalizedStatus,
        storageLocation: normalizedStorage,
        quantityLabel: normalizedQuantity,
        notes: normalizedNotes,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      return { ok: false as const, message: "This biosample changed after you opened it. Refresh and try again." };
    }
    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "sample_record",
        entityId: sample.id,
        action: "update",
        previousValue,
        newValue: nextValue,
        timestamp: new Date(),
      },
    });
    return {
      ok: true as const,
      message: `Sample ${sample.sampleLabel} updated for ${sample.animal.animalId}.`,
      entityId: sample.id,
      resultingVersion: sample.version + 1,
    };
  });
}

export async function createCryostorageRecord(
  input: CreateCryostorageRecordInput,
  actor: LabActor,
): Promise<MutationResult> {
  if (!canRecordCryostorage(actor.role)) {
    return { ok: false, message: "Your role cannot record cryostorage inventory." };
  }

  const [strain, project] = await Promise.all([
    prisma.strain.findUnique({
      where: { id: input.strainId },
      select: {
        id: true,
        name: true,
      },
    }),
    input.projectId
      ? prisma.project.findUnique({
          where: { id: input.projectId },
          select: {
            id: true,
            projectCode: true,
            labId: true,
          },
        })
      : Promise.resolve(null),
  ]);

  if (!strain) {
    return { ok: false, message: "Choose a valid strain for the cryostorage record." };
  }

  if (input.projectId && !project) {
    return { ok: false, message: "Choose a valid project for the cryostorage record." };
  }

  const cryostorageAccess = await getActorLabAccess(actor);
  const cryostorageLabId = project?.labId ?? input.labId ?? actor.activeLabId;
  if (!cryostorageLabId || !canManageLab(cryostorageAccess, cryostorageLabId)) {
    return { ok: false, message: "Choose a manageable owning lab for the cryostorage record." };
  }

  const normalizedStoredAt = new Date(input.storedAt);

  if (Number.isNaN(normalizedStoredAt.getTime())) {
    return { ok: false, message: "Choose a valid cryostorage date." };
  }

  const normalizedSampleLabel = input.sampleLabel.trim();
  const normalizedMaterialType = input.materialType.trim();
  const normalizedStorageLocation = input.storageLocation?.trim() || undefined;
  const normalizedQuantityLabel = input.quantityLabel?.trim() || undefined;
  const normalizedRecoveryNotes = input.recoveryNotes?.trim() || undefined;
  const normalizedNotes = input.notes?.trim() || undefined;

  if (normalizedSampleLabel.length < 3) {
    return { ok: false, message: "Enter a unique cryostorage label with at least 3 characters." };
  }

  if (normalizedMaterialType.length < 2) {
    return { ok: false, message: "Enter a material type before saving." };
  }

  const existingRecord = await prisma.cryostorageRecord.findUnique({
    where: { sampleLabel: normalizedSampleLabel },
    select: {
      id: true,
      labId: true,
      strainId: true,
    },
  });

  if (existingRecord) {
    if (existingRecord.labId === cryostorageLabId && existingRecord.strainId === strain.id) {
      return {
        ok: true,
        message: `Cryostorage record ${normalizedSampleLabel} is already recorded for ${strain.name}.`,
        entityId: existingRecord.id,
      };
    }

    return { ok: false, message: "Cryostorage label already exists. Use a unique label for this stored material." };
  }

  const recordId = createId("cryo");
  const timestamp = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.cryostorageRecord.create({
      data: {
        id: recordId,
        labId: cryostorageLabId,
        strainId: strain.id,
        projectId: project?.id,
        sampleLabel: normalizedSampleLabel,
        materialType: normalizedMaterialType,
        status: input.status,
        storedAt: normalizedStoredAt,
        storageLocation: normalizedStorageLocation,
        quantityLabel: normalizedQuantityLabel,
        recoveryNotes: normalizedRecoveryNotes,
        notes: normalizedNotes,
        createdById: actor.id,
      },
    });

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "cryostorage_record",
        entityId: recordId,
        action: "create",
        newValue: {
          strainId: strain.id,
          projectId: project?.id ?? null,
          sampleLabel: normalizedSampleLabel,
          materialType: normalizedMaterialType,
          status: input.status,
          storedAt: input.storedAt,
          storageLocation: normalizedStorageLocation ?? null,
          quantityLabel: normalizedQuantityLabel ?? null,
          recoveryNotes: normalizedRecoveryNotes ?? null,
          notes: normalizedNotes ?? null,
        },
        timestamp,
      },
    });
  }, { timeout: 15_000, maxWait: 10_000 });

  return {
    ok: true,
    message: `Cryostorage record ${normalizedSampleLabel} saved for ${strain.name}.`,
    entityId: recordId,
  };
}

export async function updateCryostorageRecord(
  input: UpdateCryostorageRecordInput,
  actor: LabActor,
): Promise<MutationResult> {
  if (!canRecordCryostorage(actor.role)) {
    return { ok: false, message: "Your role cannot update cryostorage inventory." };
  }

  const record = await prisma.cryostorageRecord.findUnique({
    where: { id: input.recordId },
    select: {
      id: true,
      labId: true,
      sampleLabel: true,
      version: true,
      status: true,
      storageLocation: true,
      quantityLabel: true,
      recoveryNotes: true,
      notes: true,
      strain: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!record) {
    return { ok: false, message: "Cryostorage record not found." };
  }

  const cryostorageAccess = await getActorLabAccess(actor);
  if (!canManageLab(cryostorageAccess, record.labId)) {
    return { ok: false, message: "Cryostorage record not found." };
  }

  const normalized = {
    status: input.status,
    storageLocation:
      input.storageLocation === undefined ? undefined : input.storageLocation?.trim() || null,
    quantityLabel: input.quantityLabel === undefined ? undefined : input.quantityLabel?.trim() || null,
    recoveryNotes: input.recoveryNotes === undefined ? undefined : input.recoveryNotes?.trim() || null,
    notes: input.notes === undefined ? undefined : input.notes?.trim() || null,
  };
  const updateData: {
    status?: CryostorageStatus;
    storageLocation?: string | null;
    quantityLabel?: string | null;
    recoveryNotes?: string | null;
    notes?: string | null;
    version?: { increment: number };
  } = {};
  const previousValue: Record<string, Prisma.InputJsonValue | null> = {};
  const newValue: Record<string, Prisma.InputJsonValue | null> = {};

  if (normalized.status !== undefined && normalized.status !== record.status) {
    updateData.status = normalized.status;
    previousValue.status = record.status;
    newValue.status = normalized.status;
  }

  if (normalized.storageLocation !== undefined && normalized.storageLocation !== record.storageLocation) {
    updateData.storageLocation = normalized.storageLocation;
    previousValue.storageLocation = record.storageLocation;
    newValue.storageLocation = normalized.storageLocation;
  }

  if (normalized.quantityLabel !== undefined && normalized.quantityLabel !== record.quantityLabel) {
    updateData.quantityLabel = normalized.quantityLabel;
    previousValue.quantityLabel = record.quantityLabel;
    newValue.quantityLabel = normalized.quantityLabel;
  }

  if (normalized.recoveryNotes !== undefined && normalized.recoveryNotes !== record.recoveryNotes) {
    updateData.recoveryNotes = normalized.recoveryNotes;
    previousValue.recoveryNotes = record.recoveryNotes;
    newValue.recoveryNotes = normalized.recoveryNotes;
  }

  if (normalized.notes !== undefined && normalized.notes !== record.notes) {
    updateData.notes = normalized.notes;
    previousValue.notes = record.notes;
    newValue.notes = normalized.notes;
  }

  if (!Object.keys(updateData).length) {
    return {
      ok: true,
      message: `Cryostorage record ${record.sampleLabel} is already up to date for ${record.strain.name}.`,
      entityId: record.id,
    };
  }

  const timestamp = new Date();
  const expectedVersion = input.expectedVersion ?? record.version;

  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { ok: false, message: "Refresh this cryostorage record before saving changes." };
  }
  updateData.version = { increment: 1 };
  previousValue.version = record.version;
  newValue.version = expectedVersion + 1;

  const committed = await prisma.$transaction(async (tx) => {
    const updated = await tx.cryostorageRecord.updateMany({
      where: { id: record.id, labId: record.labId, version: expectedVersion },
      data: updateData,
    });

    if (updated.count !== 1) {
      throw new Error("CRYOSTORAGE_STALE_CONFLICT");
    }

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "cryostorage_record",
        entityId: record.id,
        action: "update",
        previousValue: previousValue as Prisma.InputJsonObject,
        newValue: newValue as Prisma.InputJsonObject,
        timestamp,
      },
    });
  }, { timeout: 15_000, maxWait: 10_000 }).then(() => true).catch((error: unknown) => {
    if (error instanceof Error && error.message === "CRYOSTORAGE_STALE_CONFLICT") return false;
    throw error;
  });

  if (!committed) {
    return { ok: false, message: "The cryostorage record changed. Refresh before saving." };
  }

  return {
    ok: true,
    message: `Cryostorage record ${record.sampleLabel} updated for ${record.strain.name}.`,
    entityId: record.id,
    resultingVersion: expectedVersion + 1,
  };
}

export async function updateAnimalLifecycleStatus(
  input: UpdateAnimalLifecycleInput,
  actor: LabActor,
  transaction?: Prisma.TransactionClient,
): Promise<MutationResult> {
  if (!canUpdateAnimalLifecycle(actor.role)) {
    return { ok: false, message: "Your role cannot change terminal lifecycle states." };
  }

  const normalizedReason = input.reason.trim();
  const destination = input.destination?.trim() || null;
  const transferReference = input.transferReference?.trim() || null;
  const sopAssignmentId = input.sopAssignmentId?.trim() || null;

  if (normalizedReason.length < 3) {
    return { ok: false, message: "Enter a clear reason for the lifecycle change." };
  }
  if (input.targetStatus === "transferred_out" && (!destination || destination.length < 2)) {
    return { ok: false, message: "Enter the receiving facility or external destination." };
  }
  if (input.targetStatus !== "transferred_out" && (destination || transferReference)) {
    return { ok: false, message: "External destination and transfer reference are only valid for a transferred-out disposition." };
  }
  if (input.targetStatus !== "euthanized" && sopAssignmentId) {
    return { ok: false, message: "An SOP assignment can only be recorded for a euthanasia disposition." };
  }

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input.happenedAt);
  const exactDateTime = parseExactLifecycleTimestamp(input.happenedAt);
  const normalizedDate = input.targetStatus === "euthanized"
    ? exactDateTime
    : dateOnly ? new Date(`${input.happenedAt}T00:00:00.000Z`) : null;

  if (!normalizedDate || Number.isNaN(normalizedDate.getTime())) {
    return {
      ok: false,
      message: input.targetStatus === "euthanized"
        ? "Choose an exact euthanasia date and time with a timezone."
        : "Choose a valid lifecycle date.",
    };
  }
  if (input.targetStatus !== "euthanized" && normalizedDate.toISOString().slice(0, 10) !== input.happenedAt) {
    return { ok: false, message: "Choose a valid lifecycle date." };
  }

  const operation = async (tx: Prisma.TransactionClient): Promise<MutationResult> => {
    const animal = await tx.animal.findUnique({
      where: { id: input.animalId },
      select: {
        id: true,
        version: true,
        animalId: true,
        owningLabId: true,
        dob: true,
        status: true,
        outcomeStatus: true,
        currentCageId: true,
        deathDate: true,
        deathReason: true,
        experimentalStatus: true,
        breedingAdults: {
          where: { breedingSetup: { status: { in: ["planned", "active", "paused"] } } },
          select: { breedingSetupId: true },
        },
        experimentAssignments: {
          where: { status: { in: ["planned", "reserved", "active"] } },
          select: { id: true, status: true },
        },
        projectAllocations: {
          select: { startedAt: true },
        },
        statusEvents: {
          orderBy: [{ happenedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { happenedAt: true },
        },
        animalMovements: {
          orderBy: [{ movedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { movedAt: true },
        },
      },
    });
    if (!animal || !canManageLab(await getActorLabAccess(actor, tx), animal.owningLabId)) {
      return { ok: false, message: "Animal not found." };
    }
    if (input.targetStatus === "euthanized" && !sopAssignmentId) {
      return { ok: false, message: "Choose the approved SOP used for euthanasia." };
    }

    const sopAssignment = sopAssignmentId ? await tx.sopAssignment.findFirst({
      where: {
        id: sopAssignmentId,
        labId: animal.owningLabId,
        revokedAt: null,
        sop: { active: true },
      },
      select: {
        id: true,
        assignedAt: true,
        sopId: true,
        sopVersionId: true,
        sop: { select: { currentVersionId: true } },
        sopVersion: {
          select: {
            versionNumber: true,
            contentHash: true,
            createdAt: true,
            approval: { select: { decision: true, decidedAt: true } },
          },
        },
      },
    }) : null;
    if (sopAssignmentId && (
      !sopAssignment
      || sopAssignment.sop.currentVersionId !== sopAssignment.sopVersionId
      || sopAssignment.sopVersion.approval?.decision !== "approved"
    )) {
      return { ok: false, message: "The selected SOP is no longer current, approved, and assigned to this lab." };
    }

    const timestamp = new Date();
    const normalizedDateKey = normalizedDate.toISOString().slice(0, 10);
    if (sopAssignment && (
      normalizedDate < sopAssignment.assignedAt
      || normalizedDate < sopAssignment.sopVersion.createdAt
      || !sopAssignment.sopVersion.approval?.decidedAt
      || normalizedDate < sopAssignment.sopVersion.approval.decidedAt
    )) {
      return { ok: false, message: "Lifecycle date and time cannot predate the SOP version, approval, or lab assignment." };
    }
    if (input.targetStatus === "euthanized" ? normalizedDate > timestamp : normalizedDateKey > timestamp.toISOString().slice(0, 10)) {
      return { ok: false, message: "Lifecycle date cannot be in the future." };
    }
    if (normalizedDateKey < animal.dob.toISOString().slice(0, 10)) {
      return { ok: false, message: "Lifecycle date cannot be earlier than the animal date of birth." };
    }
    const latestOperationalDate = [
      animal.statusEvents[0]?.happenedAt,
      animal.animalMovements[0]?.movedAt,
      ...animal.projectAllocations.map((allocation) => allocation.startedAt),
    ].filter((date): date is Date => Boolean(date)).sort((left, right) => right.getTime() - left.getTime())[0];
    if (latestOperationalDate && (
      input.targetStatus === "euthanized"
        ? normalizedDate < latestOperationalDate
        : normalizedDateKey < latestOperationalDate.toISOString().slice(0, 10)
    )) {
      return { ok: false, message: "Lifecycle date cannot be earlier than the latest recorded animal event." };
    }

    if (input.targetStatus === "archived") {
      if (animal.status === "archived") {
        return { ok: true, message: `${animal.animalId} is already archived.`, entityId: animal.id, resultingVersion: animal.version };
      }
      if (animal.outcomeStatus === "alive") {
        return { ok: false, message: `Archive ${animal.animalId} only after euthanasia, death, or transfer out has been recorded.` };
      }
    } else if (animal.outcomeStatus !== "alive") {
      if (animal.status === input.targetStatus) {
        return {
          ok: true,
          message: `${animal.animalId} is already marked ${input.targetStatus.replaceAll("_", " ")}.`,
          entityId: animal.id,
          resultingVersion: animal.version,
        };
      }
      return { ok: false, message: `${animal.animalId} has already been removed from the active colony. Archive it instead.` };
    }

    if (animal.breedingAdults.length) {
      return {
        ok: false,
        message: `Fail or retire the open breeding setup before removing ${animal.animalId} from the colony.`,
      };
    }
    if (animal.experimentAssignments.length) {
      return {
        ok: false,
        message: `Complete or cancel open experiment assignments before removing ${animal.animalId} from the colony.`,
      };
    }

    const lifecycleOutcome = getLifecycleOutcomeStatus(input.targetStatus);
    const lifecycleExperimentalStatus = getLifecycleExperimentalStatus(input.targetStatus);
    const closesAllocations = input.targetStatus !== "archived";
    const sourceCageId = animal.currentCageId;

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
        data: { lastUpdatedAt: timestamp },
      });
    }

    const updatedAnimal = await tx.animal.update({
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
      select: { version: true },
    });

    if (closesAllocations) {
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

    if (sourceCageId) {
      await reconcileBreedingCageStatuses({
        tx,
        labId: animal.owningLabId,
        actorId: actor.id,
        effectiveAt: normalizedDate,
        auditTimestamp: timestamp,
        reason: normalizedReason,
        candidateCageIds: [sourceCageId],
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
        sopId: sopAssignment?.sopId ?? null,
        sopVersionId: sopAssignment?.sopVersionId ?? null,
        sopVersionNumber: sopAssignment?.sopVersion.versionNumber ?? null,
        sopContentHash: sopAssignment?.sopVersion.contentHash ?? null,
        sopAssignmentId: sopAssignment?.id ?? null,
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
          destination,
          transferReference,
          sopId: sopAssignment?.sopId ?? null,
          sopVersionId: sopAssignment?.sopVersionId ?? null,
          sopVersionNumber: sopAssignment?.sopVersion.versionNumber ?? null,
          sopContentHash: sopAssignment?.sopVersion.contentHash ?? null,
          sopAssignmentId: sopAssignment?.id ?? null,
        },
        timestamp,
      },
    });
    return {
      ok: true,
      message: `${animal.animalId} marked ${input.targetStatus.replaceAll("_", " ")}.`,
      entityId: animal.id,
      resultingVersion: updatedAnimal.version,
    };
  };

  return transaction ? operation(transaction) : runSerializableTransaction(operation);
}

export async function executeUpdateAnimalLifecycleCommand(input: {
  actor: ResolvedActor;
  command: UpdateAnimalLifecycleInput;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
  workflowDraftId: string;
  reviewSnapshotId: string;
}) {
  const labId = input.actor.canonicalRole === "lab_user" ? input.actor.activeLabId : null;
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "animal.lifecycle.update",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { command: input.command, reviewSnapshotId: input.reviewSnapshotId } as unknown as Prisma.InputJsonValue,
    requiredCapability: "animals:manage",
    labId,
    workflowDraftId: input.workflowDraftId,
    aggregateType: "animal",
    aggregateId: input.command.animalId,
    expectedVersion: input.expectedVersion,
    handler: async (tx) => {
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
        return { ok: false as const, code: "invalid_review", message: "The reviewed lifecycle change is no longer current. Refresh and review it again." };
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
        return { ok: false as const, code: "stale_conflict", message: "The lifecycle review changed before it could be submitted." };
      }
      const result = await updateAnimalLifecycleStatus(input.command, input.actor, tx);
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
        if (restored.count !== 1) throw new Error("The failed lifecycle review could not be restored atomically.");
        return { ok: false as const, code: "validation_error", message: result.message };
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
      if (committed.count !== 1) throw new Error("The reviewed lifecycle change could not be committed atomically.");
      return {
        ok: true as const,
        result: { message: result.message, entityId: result.entityId ?? null },
        aggregateType: "animal",
        aggregateId: result.entityId,
        resultingVersion: result.resultingVersion,
      };
    },
  });
}

export async function updateRuleConfig(
  input: UpdateRuleConfigInput,
  actor: LabActor,
): Promise<MutationResult> {
  if (!canUpdateRuleConfig(actor.role)) {
    return { ok: false, message: "Only admins can update rule settings." };
  }

  const rule = await prisma.ruleConfig.findUnique({
    where: { id: input.ruleId },
    select: {
      id: true,
      key: true,
      label: true,
      valueType: true,
      value: true,
      criticalBlock: true,
    },
  });

  if (!rule) {
    return { ok: false, message: "Rule not found." };
  }

  const parsedValue = parseRuleInputValue(rule.valueType, input.valueInput);

  if (!parsedValue.ok) {
    return { ok: false, message: parsedValue.message };
  }

  const nextValue = parsedValue.value as Prisma.InputJsonValue;
  const sameValue = JSON.stringify(rule.value) === JSON.stringify(nextValue);

  const nextFacilityCapacity =
    rule.key === "cage_max_occupancy" && typeof parsedValue.value === "number"
      ? parsedValue.value
      : null;

  const facilityCapacityError = rule.key === "cage_max_occupancy"
    ? validateFacilityCageCapacity(Number(nextFacilityCapacity))
    : null;
  if (facilityCapacityError) {
    return { ok: false, message: facilityCapacityError };
  }

  const facilityCapacityNeedsSync =
    nextFacilityCapacity === null
      ? false
      : (await prisma.facility.count({
          where: { maxCageOccupancy: { not: nextFacilityCapacity } },
        })) > 0;

  if (sameValue && rule.criticalBlock === input.criticalBlock && !facilityCapacityNeedsSync) {
    return {
      ok: true,
      message: `${rule.label} is already up to date.`,
      entityId: rule.id,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.ruleConfig.update({
      where: { id: rule.id },
      data: {
        value: nextValue as never,
        criticalBlock: input.criticalBlock,
      },
    });

    if (nextFacilityCapacity !== null) {
      await tx.facility.updateMany({
        data: { maxCageOccupancy: nextFacilityCapacity },
      });

      await tx.cage.updateMany({
        where: { capacityOverride: { gt: nextFacilityCapacity } },
        data: { capacityOverride: null },
      });
    }

    await tx.auditLog.create({
      data: {
        id: createId("audit"),
        actorId: actor.id,
        entityType: "rule_config",
        entityId: rule.id,
        action: "update",
        previousValue: {
          key: rule.key,
          value: rule.value,
          criticalBlock: rule.criticalBlock,
        },
        newValue: {
          key: rule.key,
          value: nextValue,
          criticalBlock: input.criticalBlock,
        },
        timestamp: new Date(),
      },
    });
  }, { timeout: 15_000, maxWait: 10_000 });

  return {
    ok: true,
    message: `${rule.label} updated.`,
    entityId: rule.id,
  };
}
