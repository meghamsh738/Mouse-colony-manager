import { Prisma } from "@prisma/client";

import { getAnimalDetailView, getAnimalListView } from "@/lib/animals-read";
import { getCageDetailView, getCageListView } from "@/lib/cages-read";
import { getCryostorageInventoryView } from "@/lib/cryostorage-read";
import { getExperimentOverviewView } from "@/lib/experiments-read";
import { prisma } from "@/lib/prisma";
import { getSampleInventoryView } from "@/lib/samples-read";
import type {
  AlertSeverity,
  AssignmentStatus,
  CryostorageStatus,
  GenotypeCallStatus,
  HealthNoteType,
  SampleStatus,
} from "@/lib/types";

const defaultListLimit = 100;
const maxListLimit = 500;

export type AnimalApiFilters = {
  search: string;
  status: string;
  sex: string;
  strain: string;
  projectCode: string;
  availableOnly: boolean;
  warningsOnly: boolean;
  limit: number;
};

export type CageApiFilters = {
  search: string;
  status: string;
  room: string;
  rack: string;
  warningsOnly: boolean;
  limit: number;
};

export type MoveCageApiInput = {
  cageId?: string;
  cageBarcode?: string;
  roomId?: string;
  roomNumber?: string;
  rackId?: string;
  rackNumber?: string;
  cageNumber: string;
  movedAt: string;
  reason: string;
};

export type ExperimentApiFilters = {
  search: string;
  status: string;
  projectCode: string;
  limit: number;
};

export type ProjectApiFilters = {
  search: string;
  owner: string;
  limit: number;
};

export type SampleApiFilters = {
  search: string;
  status: string;
  animalCode: string;
  projectCode: string;
  limit: number;
};

export type CryostorageApiFilters = {
  search: string;
  status: string;
  strain: string;
  projectCode: string;
  limit: number;
};

export type CreateSampleApiInput = {
  animalId?: string;
  animalCode?: string;
  projectId?: string;
  projectCode?: string;
  sampleLabel: string;
  sampleType: string;
  status: SampleStatus;
  collectedAt: string;
  storageLocation?: string;
  quantityLabel?: string;
  notes?: string;
};

export type SampleApiRecordReferenceInput = {
  sampleId?: string;
  sampleLabel?: string;
};

export type CreateCryostorageApiInput = {
  strainId?: string;
  strainName?: string;
  projectId?: string;
  projectCode?: string;
  sampleLabel: string;
  materialType: string;
  status: CryostorageStatus;
  storedAt: string;
  storageLocation?: string;
  quantityLabel?: string;
  recoveryNotes?: string;
  notes?: string;
};

export type CryostorageApiRecordReferenceInput = {
  recordId?: string;
  sampleLabel?: string;
};

export type CreateGenotypeApiInput = {
  animalId?: string;
  animalCode?: string;
  alleleId?: string;
  marker?: string;
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

export type CreateCageHealthNoteApiInput = {
  cageId?: string;
  cageBarcode?: string;
  noteType: HealthNoteType;
  severity: AlertSeverity;
  note: string;
  followupRequired: boolean;
  actionTaken?: string;
};

export type CreateExperimentAssignmentApiInput = {
  experimentId?: string;
  experimentCode?: string;
  startDate: string;
  notes?: string;
  assignments: Array<{
    animalId?: string;
    animalCode?: string;
    treatmentGroup?: string;
  }>;
};

export type CreateBreedingSetupApiInput = {
  sireId?: string;
  sireCode?: string;
  damId?: string;
  damCode?: string;
  startDate: string;
  targetGenotype: string;
  targetSex?: "male" | "female" | "unknown";
  notes?: string;
  allowOverride?: boolean;
};

export type CreateLitterApiInput = {
  breedingSetupId: string;
  birthDate: string;
  litterSizeBirth: number;
  notes?: string;
};

export type CreateWeaningApiInput = {
  litterId: string;
  weanDate: string;
  femaleCount: number;
  maleCount: number;
  femaleCageId?: string;
  femaleCageBarcode?: string;
  maleCageId?: string;
  maleCageBarcode?: string;
  strainId?: string;
  strainName?: string;
};

export type ExperimentApiReferenceInput = {
  experimentId?: string;
  experimentCode?: string;
};

export type ResolvedSampleApiInput = {
  animalCode: string;
  animalId: string;
  projectCode: string | null;
  projectId?: string;
};

export type ResolvedSampleApiRecordReference = {
  sampleId: string;
  sampleLabel: string;
};

export type ResolvedCryostorageApiInput = {
  projectCode: string | null;
  projectId?: string;
  strainId: string;
  strainName: string;
};

export type ResolvedCryostorageApiRecordReference = {
  recordId: string;
  sampleLabel: string;
};

export type ResolvedGenotypeApiInput = {
  alleleId: string;
  animalCode: string;
  animalId: string;
  marker: string;
};

export type ResolvedCageApiInput = {
  cageBarcode: string;
  cageId: string;
};

export type ResolvedCageMoveApiInput = {
  cageBarcode: string;
  cageId: string;
  roomId: string;
  roomNumber: string;
  rackId: string;
  rackNumber: string;
};

export type ResolvedExperimentAssignmentApiInput = {
  experimentCode: string;
  experimentId: string;
  assignments: Array<{
    animalCode: string;
    animalId: string;
    treatmentGroup: string;
  }>;
};

export type ResolvedBreedingSetupApiInput = {
  sireCode: string;
  sireId: string;
  damCode: string;
  damId: string;
};

export type ResolvedStrainApiReference = {
  strainId: string;
  strainName: string;
};

export type ResolvedExperimentApiReference = {
  experimentCode: string;
  experimentId: string;
};

function normalizeText(value?: string | null) {
  return value?.trim() ?? "";
}

function normalizeSearch(value?: string | null) {
  return normalizeText(value).toLowerCase();
}

function parseBoolean(value?: string | null) {
  return value === "true" || value === "1" || value === "on";
}

function parseLimit(value?: string | null) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return defaultListLimit;
  }

  return Math.max(1, Math.min(maxListLimit, Math.floor(parsed)));
}

function buildHaystack(values: Array<string | number | null | undefined>) {
  return values
    .filter((value) => value !== null && value !== undefined && value !== "")
    .join(" ")
    .toLowerCase();
}

function applyLimit<T>(items: T[], limit: number) {
  return items.slice(0, limit);
}

export function parseAnimalApiFilters(searchParams: URLSearchParams): AnimalApiFilters {
  return {
    search: normalizeText(searchParams.get("search")),
    status: normalizeText(searchParams.get("status")) || "all",
    sex: normalizeText(searchParams.get("sex")) || "all",
    strain: normalizeText(searchParams.get("strain")),
    projectCode: normalizeText(searchParams.get("projectCode")),
    availableOnly: parseBoolean(searchParams.get("availableOnly")),
    warningsOnly: parseBoolean(searchParams.get("warningsOnly")),
    limit: parseLimit(searchParams.get("limit")),
  };
}

export function parseCageApiFilters(searchParams: URLSearchParams): CageApiFilters {
  return {
    search: normalizeText(searchParams.get("search")),
    status: normalizeText(searchParams.get("status")) || "all",
    room: normalizeText(searchParams.get("room")),
    rack: normalizeText(searchParams.get("rack")),
    warningsOnly: parseBoolean(searchParams.get("warningsOnly")),
    limit: parseLimit(searchParams.get("limit")),
  };
}

export function parseExperimentApiFilters(searchParams: URLSearchParams): ExperimentApiFilters {
  return {
    search: normalizeText(searchParams.get("search")),
    status: normalizeText(searchParams.get("status")) || "all",
    projectCode: normalizeText(searchParams.get("projectCode")),
    limit: parseLimit(searchParams.get("limit")),
  };
}

export function parseProjectApiFilters(searchParams: URLSearchParams): ProjectApiFilters {
  return {
    search: normalizeText(searchParams.get("search")),
    owner: normalizeText(searchParams.get("owner")),
    limit: parseLimit(searchParams.get("limit")),
  };
}

export function parseSampleApiFilters(searchParams: URLSearchParams): SampleApiFilters {
  return {
    search: normalizeText(searchParams.get("search")),
    status: normalizeText(searchParams.get("status")) || "all",
    animalCode: normalizeText(searchParams.get("animalCode")),
    projectCode: normalizeText(searchParams.get("projectCode")),
    limit: parseLimit(searchParams.get("limit")),
  };
}

export function parseCryostorageApiFilters(searchParams: URLSearchParams): CryostorageApiFilters {
  return {
    search: normalizeText(searchParams.get("search")),
    status: normalizeText(searchParams.get("status")) || "all",
    strain: normalizeText(searchParams.get("strain")),
    projectCode: normalizeText(searchParams.get("projectCode")),
    limit: parseLimit(searchParams.get("limit")),
  };
}

export async function getAnimalApiList(filters: AnimalApiFilters) {
  const animals = await getAnimalListView();
  const search = normalizeSearch(filters.search);
  const strain = normalizeSearch(filters.strain);
  const projectCode = normalizeSearch(filters.projectCode);

  const filtered = animals.filter((animal) => {
    const matchesSearch = search
      ? buildHaystack([
          animal.animalId,
          animal.labId,
          animal.sex,
          animal.strain,
          animal.genotypeSummary,
          animal.cageLabel,
          animal.status,
          animal.projectCodes.join(" "),
          animal.experimentSummary,
          animal.warnings.join(" "),
        ]).includes(search)
      : true;
    const matchesStatus = filters.status !== "all" ? animal.status === filters.status : true;
    const matchesSex = filters.sex !== "all" ? animal.sex === filters.sex : true;
    const matchesStrain = strain ? animal.strain.toLowerCase().includes(strain) : true;
    const matchesProject = projectCode ? animal.projectCodes.some((code) => code.toLowerCase().includes(projectCode)) : true;
    const matchesAvailability = filters.availableOnly ? animal.availableForExperiment : true;
    const matchesWarnings = filters.warningsOnly ? animal.warnings.length > 0 : true;

    return (
      matchesSearch &&
      matchesStatus &&
      matchesSex &&
      matchesStrain &&
      matchesProject &&
      matchesAvailability &&
      matchesWarnings
    );
  });

  return {
    data: applyLimit(filtered, filters.limit),
    total: filtered.length,
  };
}

export async function getCageApiList(filters: CageApiFilters) {
  const cages = await getCageListView();
  const search = normalizeSearch(filters.search);
  const room = normalizeSearch(filters.room);
  const rack = normalizeSearch(filters.rack);

  const filtered = cages.filter((cage) => {
    const matchesSearch = search
      ? buildHaystack([
          cage.roomNumber,
          cage.rackNumber,
          cage.cageNumber,
          cage.barcode,
          cage.status,
          cage.sexComposition,
          cage.strainSummary,
        ]).includes(search)
      : true;
    const matchesStatus = filters.status !== "all" ? cage.status === filters.status : true;
    const matchesRoom = room ? cage.roomNumber.toLowerCase() === room : true;
    const matchesRack = rack ? cage.rackNumber.toLowerCase() === rack : true;
    const matchesWarnings = filters.warningsOnly ? cage.warningCount > 0 : true;

    return matchesSearch && matchesStatus && matchesRoom && matchesRack && matchesWarnings;
  });

  return {
    data: applyLimit(filtered, filters.limit),
    total: filtered.length,
  };
}

export async function getExperimentApiList(filters: ExperimentApiFilters) {
  const experiments = await getExperimentOverviewView();
  const search = normalizeSearch(filters.search);
  const projectCode = normalizeSearch(filters.projectCode);

  const filtered = experiments.filter((experiment) => {
    const matchesSearch = search
      ? buildHaystack([
          experiment.experimentCode,
          experiment.title,
          experiment.status,
          experiment.projectCode,
          experiment.assignments.map((assignment) => assignment.animalId).join(" "),
        ]).includes(search)
      : true;
    const matchesStatus = filters.status !== "all" ? experiment.status === filters.status : true;
    const matchesProject = projectCode ? experiment.projectCode.toLowerCase().includes(projectCode) : true;

    return matchesSearch && matchesStatus && matchesProject;
  });

  return {
    data: applyLimit(filtered, filters.limit),
    total: filtered.length,
  };
}

export async function getProjectApiList(filters: ProjectApiFilters) {
  const projects = await prisma.project.findMany({
    orderBy: { projectCode: "asc" },
    select: {
      id: true,
      projectCode: true,
      title: true,
      notes: true,
      owner: {
        select: {
          name: true,
          email: true,
        },
      },
      animalAllocations: {
        where: {
          endedAt: null,
        },
        select: {
          id: true,
        },
      },
      experiments: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });
  const search = normalizeSearch(filters.search);
  const owner = normalizeSearch(filters.owner);

  const filtered = projects
    .map((project) => ({
      id: project.id,
      projectCode: project.projectCode,
      title: project.title,
      notes: project.notes,
      ownerName: project.owner.name ?? project.owner.email,
      ownerEmail: project.owner.email,
      activeAnimalAllocations: project.animalAllocations.length,
      experimentCount: project.experiments.length,
      activeExperimentCount: project.experiments.filter((experiment) => experiment.status === "active").length,
    }))
    .filter((project) => {
      const matchesSearch = search
        ? buildHaystack([
            project.projectCode,
            project.title,
            project.notes,
            project.ownerName,
            project.ownerEmail,
          ]).includes(search)
        : true;
      const matchesOwner = owner
        ? buildHaystack([project.ownerName, project.ownerEmail]).includes(owner)
        : true;

      return matchesSearch && matchesOwner;
    });

  return {
    data: applyLimit(filtered, filters.limit),
    total: filtered.length,
  };
}

export async function getSampleApiList(filters: SampleApiFilters) {
  const samples = await getSampleInventoryView();
  const search = normalizeSearch(filters.search);
  const animalCode = normalizeSearch(filters.animalCode);
  const projectCode = normalizeSearch(filters.projectCode);

  const filtered = samples.filter((sample) => {
    const matchesSearch = search
      ? buildHaystack([
          sample.sampleLabel,
          sample.sampleType,
          sample.status,
          sample.animalCode,
          sample.labId,
          sample.projectCode,
          sample.storageLocation,
          sample.quantityLabel,
          sample.notes,
        ]).includes(search)
      : true;
    const matchesStatus = filters.status !== "all" ? sample.status === filters.status : true;
    const matchesAnimal = animalCode ? sample.animalCode.toLowerCase().includes(animalCode) : true;
    const matchesProject = projectCode ? sample.projectCode?.toLowerCase().includes(projectCode) : true;

    return matchesSearch && matchesStatus && matchesAnimal && matchesProject;
  });

  return {
    data: applyLimit(filtered, filters.limit),
    total: filtered.length,
  };
}

export async function getCryostorageApiList(filters: CryostorageApiFilters) {
  const records = await getCryostorageInventoryView();
  const search = normalizeSearch(filters.search);
  const strain = normalizeSearch(filters.strain);
  const projectCode = normalizeSearch(filters.projectCode);

  const filtered = records.filter((record) => {
    const matchesSearch = search
      ? buildHaystack([
          record.sampleLabel,
          record.materialType,
          record.status,
          record.strainName,
          record.projectCode,
          record.storageLocation,
          record.quantityLabel,
          record.recoveryNotes,
          record.notes,
        ]).includes(search)
      : true;
    const matchesStatus = filters.status !== "all" ? record.status === filters.status : true;
    const matchesStrain = strain ? record.strainName.toLowerCase().includes(strain) : true;
    const matchesProject = projectCode ? record.projectCode?.toLowerCase().includes(projectCode) : true;

    return matchesSearch && matchesStatus && matchesStrain && matchesProject;
  });

  return {
    data: applyLimit(filtered, filters.limit),
    total: filtered.length,
  };
}

export async function getAnimalApiDetail(animalId: string) {
  return getAnimalDetailView(animalId);
}

export async function getAnimalApiRecordById(animalId: string) {
  const animal = await prisma.animal.findUnique({
    where: { id: animalId },
    select: {
      id: true,
      animalId: true,
      labId: true,
      status: true,
      dob: true,
      outcomeStatus: true,
      experimentalStatus: true,
      deathDate: true,
      deathReason: true,
      currentCage: {
        select: {
          cageNumber: true,
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
      },
      strain: {
        select: {
          name: true,
        },
      },
      projectAllocations: {
        where: {
          endedAt: null,
        },
        orderBy: {
          startedAt: "asc",
        },
        select: {
          project: {
            select: {
              projectCode: true,
            },
          },
        },
      },
    },
  });

  if (!animal) {
    return null;
  }

  return {
    animal: {
      id: animal.id,
      animalId: animal.animalId,
      labId: animal.labId,
      status: animal.status,
      dob: animal.dob.toISOString(),
      outcomeStatus: animal.outcomeStatus,
      experimentalStatus: animal.experimentalStatus,
      deathDate: animal.deathDate?.toISOString() ?? null,
      deathReason: animal.deathReason ?? null,
    },
    cageLabel: animal.currentCage
      ? `${animal.currentCage.room.roomNumber} / ${animal.currentCage.rack.rackNumber} / ${animal.currentCage.cageNumber}`
      : "Archived",
    strainName: animal.strain.name,
    projectCodes: animal.projectAllocations.map((allocation) => allocation.project.projectCode),
  };
}

export async function getCageApiDetail(cageId: string) {
  return getCageDetailView(cageId);
}

export async function getCageApiRecordById(cageId: string) {
  const cage = await prisma.cage.findUnique({
    where: { id: cageId },
    select: {
      id: true,
      barcode: true,
      status: true,
      cageNumber: true,
      lastUpdatedAt: true,
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
  });

  if (!cage) {
    return null;
  }

  return {
    id: cage.id,
    cageBarcode: cage.barcode,
    status: cage.status,
    cageNumber: cage.cageNumber,
    roomNumber: cage.room.roomNumber,
    rackNumber: cage.rack.rackNumber,
    cageLabel: `${cage.room.roomNumber} / ${cage.rack.rackNumber} / ${cage.cageNumber}`,
    lastUpdatedAt: cage.lastUpdatedAt.toISOString(),
  };
}

export async function resolveCageByApiReference(input: {
  cageId?: string;
  cageBarcode?: string;
}): Promise<
  | {
      ok: true;
      value: ResolvedCageApiInput;
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  const cageRef = input.cageId?.trim();
  const cageBarcode = input.cageBarcode?.trim();

  if (!cageRef && !cageBarcode) {
    return { ok: false, message: "Provide cageId or cageBarcode.", status: 400 };
  }

  const cage = await prisma.cage.findFirst({
    where: {
      OR: [
        ...(cageRef ? [{ id: cageRef }, { barcode: cageRef }] : []),
        ...(cageBarcode ? [{ barcode: cageBarcode }] : []),
      ],
    },
    select: {
      id: true,
      barcode: true,
    },
  });

  if (!cage) {
    return { ok: false, message: "Cage not found for the supplied cageId or cageBarcode.", status: 404 };
  }

  return {
    ok: true,
    value: {
      cageBarcode: cage.barcode,
      cageId: cage.id,
    },
  };
}

export async function resolveCageMoveApiInput(input: MoveCageApiInput): Promise<
  | {
      ok: true;
      value: ResolvedCageMoveApiInput;
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  const cage = await resolveCageByApiReference(input);

  if (!cage.ok) {
    return cage;
  }

  const roomRef = input.roomId?.trim();
  const roomNumber = input.roomNumber?.trim();
  const rackRef = input.rackId?.trim();
  const rackNumber = input.rackNumber?.trim();

  if ((!roomRef && !roomNumber) || (!rackRef && !rackNumber)) {
    return {
      ok: false,
      message: "Provide roomId or roomNumber and rackId or rackNumber for the destination cage move.",
      status: 400,
    };
  }

  const room = await prisma.room.findFirst({
    where: {
      OR: [
        ...(roomRef ? [{ id: roomRef }, { roomNumber: roomRef }] : []),
        ...(roomNumber ? [{ roomNumber }] : []),
      ],
    },
    select: {
      id: true,
      roomNumber: true,
    },
  });

  if (!room) {
    return { ok: false, message: "Destination room not found for the supplied roomId or roomNumber.", status: 404 };
  }

  const rack = await prisma.rack.findFirst({
    where: {
      roomId: room.id,
      OR: [
        ...(rackRef ? [{ id: rackRef }, { rackNumber: rackRef }] : []),
        ...(rackNumber ? [{ rackNumber }] : []),
      ],
    },
    select: {
      id: true,
      rackNumber: true,
    },
  });

  if (!rack) {
    return { ok: false, message: "Destination rack not found for the supplied rackId or rackNumber in that room.", status: 404 };
  }

  return {
    ok: true,
    value: {
      cageBarcode: cage.value.cageBarcode,
      cageId: cage.value.cageId,
      roomId: room.id,
      roomNumber: room.roomNumber,
      rackId: rack.id,
      rackNumber: rack.rackNumber,
    },
  };
}

export async function resolveAnimalByApiReference(input: {
  animalId?: string;
  animalCode?: string;
}): Promise<
  | {
      ok: true;
      value: {
        animalCode: string;
        animalId: string;
        labId: string;
      };
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  const animalRef = input.animalId?.trim();
  const animalCode = input.animalCode?.trim();

  if (!animalRef && !animalCode) {
    return { ok: false, message: "Provide animalId or animalCode.", status: 400 };
  }

  const animal = await prisma.animal.findFirst({
    where: {
      OR: [
        ...(animalRef ? [{ id: animalRef }, { animalId: animalRef }] : []),
        ...(animalCode ? [{ animalId: animalCode }, { labId: animalCode }] : []),
      ],
    },
    select: {
      id: true,
      animalId: true,
      labId: true,
    },
  });

  if (!animal) {
    return { ok: false, message: "Animal not found for the supplied animalId or animalCode.", status: 404 };
  }

  return {
    ok: true,
    value: {
      animalCode: animal.animalId,
      animalId: animal.id,
      labId: animal.labId,
    },
  };
}

export async function resolveStrainByApiReference(input: {
  strainId?: string;
  strainName?: string;
}): Promise<
  | {
      ok: true;
      value: ResolvedStrainApiReference;
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  const strainRef = input.strainId?.trim();
  const strainName = input.strainName?.trim();

  if (!strainRef && !strainName) {
    return { ok: false, message: "Provide strainId or strainName.", status: 400 };
  }

  const strain = await prisma.strain.findFirst({
    where: {
      OR: [
        ...(strainRef ? [{ id: strainRef }, { name: strainRef }] : []),
        ...(strainName ? [{ name: strainName }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!strain) {
    return { ok: false, message: "Strain not found for the supplied strainId or strainName.", status: 404 };
  }

  return {
    ok: true,
    value: {
      strainId: strain.id,
      strainName: strain.name,
    },
  };
}

export async function resolveSampleApiInput(input: CreateSampleApiInput): Promise<
  | {
      ok: true;
      value: ResolvedSampleApiInput;
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  const projectRef = input.projectId?.trim();
  const projectCode = input.projectCode?.trim();
  const animal = await resolveAnimalByApiReference(input);

  if (!animal.ok) {
    return animal;
  }

  const project =
    projectRef || projectCode
      ? await prisma.project.findFirst({
          where: {
            OR: [
              ...(projectRef ? [{ id: projectRef }, { projectCode: projectRef }] : []),
              ...(projectCode ? [{ projectCode }] : []),
            ],
          },
          select: {
            id: true,
            projectCode: true,
          },
        })
      : null;

  if ((projectRef || projectCode) && !project) {
    return { ok: false, message: "Project not found for the supplied projectId or projectCode.", status: 404 };
  }

  return {
    ok: true,
    value: {
      animalCode: animal.value.animalCode,
      animalId: animal.value.animalId,
      projectCode: project?.projectCode ?? null,
      projectId: project?.id,
    },
  };
}

export async function resolveCryostorageApiInput(input: CreateCryostorageApiInput): Promise<
  | {
      ok: true;
      value: ResolvedCryostorageApiInput;
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  const projectRef = input.projectId?.trim();
  const projectCode = input.projectCode?.trim();
  const strain = await resolveStrainByApiReference(input);

  if (!strain.ok) {
    return strain;
  }

  const project =
    projectRef || projectCode
      ? await prisma.project.findFirst({
          where: {
            OR: [
              ...(projectRef ? [{ id: projectRef }, { projectCode: projectRef }] : []),
              ...(projectCode ? [{ projectCode }] : []),
            ],
          },
          select: {
            id: true,
            projectCode: true,
          },
        })
      : null;

  if ((projectRef || projectCode) && !project) {
    return { ok: false, message: "Project not found for the supplied projectId or projectCode.", status: 404 };
  }

  return {
    ok: true,
    value: {
      projectCode: project?.projectCode ?? null,
      projectId: project?.id,
      strainId: strain.value.strainId,
      strainName: strain.value.strainName,
    },
  };
}

export async function resolveGenotypeApiInput(input: CreateGenotypeApiInput): Promise<
  | {
      ok: true;
      value: ResolvedGenotypeApiInput;
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  const animal = await resolveAnimalByApiReference(input);
  const alleleRef = input.alleleId?.trim();
  const marker = input.marker?.trim();

  if (!animal.ok) {
    return animal;
  }

  if (!alleleRef && !marker) {
    return { ok: false, message: "Provide alleleId or marker.", status: 400 };
  }

  const allele = await prisma.allele.findFirst({
    where: {
      OR: [
        ...(alleleRef ? [{ id: alleleRef }, { name: alleleRef }] : []),
        ...(marker ? [{ name: marker }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!allele) {
    return { ok: false, message: "Allele or marker not found for the supplied alleleId or marker.", status: 404 };
  }

  return {
    ok: true,
    value: {
      alleleId: allele.id,
      animalCode: animal.value.animalCode,
      animalId: animal.value.animalId,
      marker: allele.name,
    },
  };
}

export async function resolveExperimentAssignmentApiInput(input: CreateExperimentAssignmentApiInput): Promise<
  | {
      ok: true;
      value: ResolvedExperimentAssignmentApiInput;
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  const experiment = await resolveExperimentApiReference(input);

  if (!experiment.ok) {
    return experiment;
  }

  if (!input.assignments.length) {
    return { ok: false, message: "Provide at least one assignment.", status: 400 };
  }

  const resolvedAssignments = [];
  const seenAnimalIds = new Set<string>();

  for (const assignment of input.assignments) {
    const animal = await resolveAnimalByApiReference(assignment);

    if (!animal.ok) {
      return animal;
    }

    if (seenAnimalIds.has(animal.value.animalId)) {
      continue;
    }

    seenAnimalIds.add(animal.value.animalId);
    resolvedAssignments.push({
      animalCode: animal.value.animalCode,
      animalId: animal.value.animalId,
      treatmentGroup: assignment.treatmentGroup?.trim() || "Group A",
    });
  }

  if (!resolvedAssignments.length) {
    return { ok: false, message: "Provide at least one unique assignment.", status: 400 };
  }

  return {
    ok: true,
    value: {
      experimentCode: experiment.value.experimentCode,
      experimentId: experiment.value.experimentId,
      assignments: resolvedAssignments,
    },
  };
}

export async function resolveExperimentApiReference(input: ExperimentApiReferenceInput): Promise<
  | {
      ok: true;
      value: ResolvedExperimentApiReference;
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  const experimentRef = input.experimentId?.trim();
  const experimentCode = input.experimentCode?.trim();

  if (!experimentRef && !experimentCode) {
    return { ok: false, message: "Provide experimentId or experimentCode.", status: 400 };
  }

  const experiment = await prisma.experiment.findFirst({
    where: {
      OR: [
        ...(experimentRef ? [{ id: experimentRef }, { experimentCode: experimentRef }] : []),
        ...(experimentCode ? [{ experimentCode }] : []),
      ],
    },
    select: {
      id: true,
      experimentCode: true,
      status: true,
    },
  });

  if (!experiment || experiment.status === "completed" || experiment.status === "cancelled") {
    return { ok: false, message: "Experiment not found or no longer accepts assignment sync.", status: 404 };
  }

  return {
    ok: true,
    value: {
      experimentCode: experiment.experimentCode,
      experimentId: experiment.id,
    },
  };
}

export async function resolveBreedingSetupApiInput(input: CreateBreedingSetupApiInput): Promise<
  | {
      ok: true;
      value: ResolvedBreedingSetupApiInput;
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  const [sire, dam] = await Promise.all([
    resolveAnimalByApiReference({ animalId: input.sireId, animalCode: input.sireCode }),
    resolveAnimalByApiReference({ animalId: input.damId, animalCode: input.damCode }),
  ]);

  if (!sire.ok) {
    return sire;
  }

  if (!dam.ok) {
    return dam;
  }

  if (sire.value.animalId === dam.value.animalId) {
    return { ok: false, message: "Choose two different animals for the breeding setup.", status: 400 };
  }

  return {
    ok: true,
    value: {
      sireCode: sire.value.animalCode,
      sireId: sire.value.animalId,
      damCode: dam.value.animalCode,
      damId: dam.value.animalId,
    },
  };
}

export async function getSampleApiRecordById(sampleId: string) {
  const record = await prisma.sampleRecord.findUnique({
    where: { id: sampleId },
    select: sampleApiSelect,
  });

  return record ? formatSampleApiRecord(record) : null;
}

export async function getCryostorageApiRecordById(recordId: string) {
  const record = await prisma.cryostorageRecord.findUnique({
    where: { id: recordId },
    select: cryostorageApiSelect,
  });

  return record ? formatCryostorageApiRecord(record) : null;
}

export async function getCryostorageApiRecordByLabel(sampleLabel: string) {
  const record = await prisma.cryostorageRecord.findUnique({
    where: { sampleLabel },
    select: cryostorageApiSelect,
  });

  return record ? formatCryostorageApiRecord(record) : null;
}

export async function getSampleApiRecordByLabel(sampleLabel: string) {
  const record = await prisma.sampleRecord.findUnique({
    where: { sampleLabel },
    select: sampleApiSelect,
  });

  return record ? formatSampleApiRecord(record) : null;
}

export async function resolveCryostorageApiRecordReference(input: CryostorageApiRecordReferenceInput): Promise<
  | {
      ok: true;
      value: ResolvedCryostorageApiRecordReference;
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  const recordId = input.recordId?.trim();
  const sampleLabel = input.sampleLabel?.trim();

  if (!recordId && !sampleLabel) {
    return { ok: false, message: "Provide recordId or sampleLabel.", status: 400 };
  }

  const record = await prisma.cryostorageRecord.findFirst({
    where: {
      OR: [
        ...(recordId ? [{ id: recordId }, { sampleLabel: recordId }] : []),
        ...(sampleLabel ? [{ sampleLabel }] : []),
      ],
    },
    select: {
      id: true,
      sampleLabel: true,
    },
  });

  if (!record) {
    return { ok: false, message: "Cryostorage record not found for the supplied recordId or sampleLabel.", status: 404 };
  }

  return {
    ok: true,
    value: {
      recordId: record.id,
      sampleLabel: record.sampleLabel,
    },
  };
}

export async function resolveSampleApiRecordReference(input: SampleApiRecordReferenceInput): Promise<
  | {
      ok: true;
      value: ResolvedSampleApiRecordReference;
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  const sampleId = input.sampleId?.trim();
  const sampleLabel = input.sampleLabel?.trim();

  if (!sampleId && !sampleLabel) {
    return { ok: false, message: "Provide sampleId or sampleLabel.", status: 400 };
  }

  const record = await prisma.sampleRecord.findFirst({
    where: {
      OR: [
        ...(sampleId ? [{ id: sampleId }, { sampleLabel: sampleId }] : []),
        ...(sampleLabel ? [{ sampleLabel }] : []),
      ],
    },
    select: {
      id: true,
      sampleLabel: true,
    },
  });

  if (!record) {
    return { ok: false, message: "Sample record not found for the supplied sampleId or sampleLabel.", status: 404 };
  }

  return {
    ok: true,
    value: {
      sampleId: record.id,
      sampleLabel: record.sampleLabel,
    },
  };
}

export async function getGenotypeApiRecordById(recordId: string) {
  const record = await prisma.genotypingRecord.findUnique({
    where: { id: recordId },
    select: genotypeApiSelect,
  });

  return record ? formatGenotypeApiRecord(record) : null;
}

export async function getCageHealthNoteApiRecordById(noteId: string) {
  const record = await prisma.healthNote.findUnique({
    where: { id: noteId },
    select: cageHealthNoteApiSelect,
  });

  return record ? formatCageHealthNoteApiRecord(record) : null;
}

export async function getExistingCageHealthNoteApiRecord(input: {
  cageId: string;
  createdById: string;
  noteType: HealthNoteType;
  severity: AlertSeverity;
  note: string;
  followupRequired: boolean;
  actionTaken?: string;
}) {
  const record = await prisma.healthNote.findFirst({
    where: {
      cageId: input.cageId,
      createdById: input.createdById,
      noteType: input.noteType,
      severity: input.severity,
      note: input.note.trim(),
      followupRequired: input.followupRequired,
      actionTaken: input.actionTaken?.trim() || null,
    },
    orderBy: { createdAt: "desc" },
    select: cageHealthNoteApiSelect,
  });

  if (!record) {
    return null;
  }

  const now = Date.now();

  return now - record.createdAt.getTime() < 2 * 60 * 1000 ? formatCageHealthNoteApiRecord(record) : null;
}

export async function getExperimentAssignmentApiRecords(input: {
  experimentId: string;
  animalIds: string[];
}) {
  const records = await prisma.experimentAssignment.findMany({
    where: {
      experimentId: input.experimentId,
      animalId: { in: input.animalIds },
      status: { in: ["planned", "reserved", "active", "completed"] },
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: experimentAssignmentApiSelect,
  });

  return records.map(formatExperimentAssignmentApiRecord);
}

export async function getExperimentAssignmentApiRecordsForExperiment(input: {
  experimentId: string;
  statuses?: AssignmentStatus[];
}) {
  const records = await prisma.experimentAssignment.findMany({
    where: {
      experimentId: input.experimentId,
      ...(input.statuses?.length ? { status: { in: input.statuses } } : {}),
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: experimentAssignmentApiSelect,
  });

  return records.map(formatExperimentAssignmentApiRecord);
}

export async function getBreedingSetupApiRecordById(breedingSetupId: string) {
  const record = await prisma.breedingSetup.findUnique({
    where: { id: breedingSetupId },
    select: breedingSetupApiSelect,
  });

  return record ? formatBreedingSetupApiRecord(record) : null;
}

export async function getExistingBreedingSetupApiRecord(input: {
  sireId: string;
  damId: string;
  startDate: string;
  targetGenotype: string;
  targetSex?: "male" | "female" | "unknown";
  notes?: string;
}) {
  const startDate = new Date(input.startDate);

  if (Number.isNaN(startDate.getTime())) {
    return null;
  }

  const normalizedTargetGenotype = input.targetGenotype.trim();
  const normalizedNotes = input.notes?.trim() || null;
  const normalizedTargetSex = input.targetSex && input.targetSex !== "unknown" ? input.targetSex : null;

  const record = await prisma.breedingSetup.findFirst({
    where: {
      startDate,
      status: { in: ["planned", "active", "paused"] },
      targetGenotype: normalizedTargetGenotype,
      targetSex: normalizedTargetSex,
      notes: normalizedNotes,
      adults: {
        some: {
          animalId: input.sireId,
          role: "sire",
        },
      },
      AND: [
        {
          adults: {
            some: {
              animalId: input.damId,
              role: "dam",
            },
          },
        },
      ],
    },
    select: breedingSetupApiSelect,
  });

  return record ? formatBreedingSetupApiRecord(record) : null;
}

export async function getLitterApiRecordById(litterId: string) {
  const record = await prisma.litter.findUnique({
    where: { id: litterId },
    select: litterApiSelect,
  });

  return record ? formatLitterApiRecord(record) : null;
}

export async function getExistingLitterApiRecord(input: {
  breedingSetupId: string;
  birthDate: string;
  litterSizeBirth: number;
  notes?: string;
}) {
  const birthDate = new Date(input.birthDate);

  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }

  const normalizedBirthKey = birthDate.toISOString().slice(0, 10);
  const normalizedNotes = input.notes?.trim() || null;

  const record = await prisma.litter.findFirst({
    where: {
      breedingSetupId: input.breedingSetupId,
      birthDate,
      litterSizeBirth: input.litterSizeBirth,
      notes: normalizedNotes,
    },
    select: litterApiSelect,
  });

  if (!record) {
    return null;
  }

  return record.birthDate.toISOString().slice(0, 10) === normalizedBirthKey ? formatLitterApiRecord(record) : null;
}

export async function getWeaningApiRecordByLitterId(litterId: string) {
  const [record, auditLog] = await Promise.all([
    prisma.litter.findUnique({
      where: { id: litterId },
      select: weaningApiSelect,
    }),
    prisma.auditLog.findFirst({
      where: {
        entityType: "litter",
        entityId: litterId,
        action: "wean",
      },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      select: {
        newValue: true,
      },
    }),
  ]);

  return record ? formatWeaningApiRecord(record, auditLog?.newValue) : null;
}

export async function getExistingGenotypeApiRecord(input: {
  animalId: string;
  marker: string;
  status: GenotypeCallStatus;
  sampleDate: string;
  resultDate: string;
  finalCall: string;
  resultText: string;
}) {
  const sampleDate = new Date(input.sampleDate);
  const resultDate = new Date(input.resultDate);

  if (Number.isNaN(sampleDate.getTime()) || Number.isNaN(resultDate.getTime())) {
    return null;
  }

  const record = await prisma.genotypingRecord.findFirst({
    where: {
      animalId: input.animalId,
      markerTested: input.marker,
      status: input.status,
      sampleDate,
      resultDate,
      finalCall: input.finalCall,
      resultText: input.resultText.trim(),
    },
    orderBy: { resultDate: "desc" },
    select: genotypeApiSelect,
  });

  return record ? formatGenotypeApiRecord(record) : null;
}

export function buildGenotypeApiFinalCall(input: { marker: string; status: GenotypeCallStatus; zygosity: string }) {
  if (input.status === "pending") {
    return "Pending";
  }

  if (input.status === "conflict") {
    return `${input.marker} conflict`;
  }

  return `${input.marker} ${input.zygosity.trim()}`;
}

const exportCatalog = [
  {
    entity: "animals",
    description: "CSV snapshot of active colony animals.",
    supportedFilters: ["search", "status", "availableOnly"],
  },
  {
    entity: "cages",
    description: "CSV snapshot of operational cage inventory.",
    supportedFilters: ["search", "status", "warningsOnly"],
  },
  {
    entity: "alerts",
    description: "CSV export of recorded alerts ordered by severity and date.",
    supportedFilters: [],
  },
  {
    entity: "experiments",
    description: "CSV export of experiment assignments.",
    supportedFilters: [],
  },
] as const;

const resourceCatalog = [
  {
    name: "animals",
    path: "/api/v1/animals",
    detailPath: "/api/v1/animals/{animalId}",
    description: "Animal summaries and animal detail records.",
    methods: ["GET", "PATCH"],
  },
  {
    name: "cages",
    path: "/api/v1/cages",
    detailPath: "/api/v1/cages/{cageId}",
    description: "Cage summaries, occupancy, notes, movement history, and external welfare event intake.",
    methods: ["GET", "PATCH"],
  },
  {
    name: "cage-health-notes",
    path: "/api/v1/cages/health-notes",
    description: "External cage welfare or equipment event intake with audit provenance.",
    methods: ["POST"],
  },
  {
    name: "breeding-setups",
    path: "/api/v1/breeding-setups",
    description: "External breeding setup intake with audited breeder state transitions.",
    methods: ["POST"],
  },
  {
    name: "litters",
    path: "/api/v1/litters",
    description: "External litter intake for active breeding setups with audit provenance.",
    methods: ["POST"],
  },
  {
    name: "weanings",
    path: "/api/v1/weanings",
    description: "External weaning sync for litters with audited progeny creation and cage assignment.",
    methods: ["POST"],
  },
  {
    name: "experiments",
    path: "/api/v1/experiments",
    description: "Experiment overview with assignment provenance and planned assignment sync.",
    methods: ["GET"],
  },
  {
    name: "experiment-assignments",
    path: "/api/v1/experiments/assignments",
    description: "External planned experiment assignment sync with audit provenance.",
    methods: ["POST", "PATCH"],
  },
  {
    name: "projects",
    path: "/api/v1/projects",
    description: "Project ownership and allocation summaries.",
  },
  {
    name: "samples",
    path: "/api/v1/samples",
    description: "Sample inventory summaries plus external sample intake and lifecycle updates.",
    methods: ["GET", "POST", "PATCH"],
  },
  {
    name: "cryostorage",
    path: "/api/v1/cryostorage",
    description: "Cryostorage inventory summaries plus external intake and lifecycle updates.",
    methods: ["GET", "POST", "PATCH"],
  },
  {
    name: "genotypes",
    path: "/api/v1/genotypes",
    description: "External genotype result intake with audited animal allele updates.",
    methods: ["POST"],
  },
  {
    name: "exports",
    path: "/api/v1/exports",
    description: "Discover the available operational CSV exports.",
  },
  {
    name: "notification-delivery",
    path: "/api/v1/notifications/delivery",
    description: "Preview or deliver outbound notification digest payloads.",
  },
] as const;

export function getIntegrationResourceCatalog(origin: string) {
  return resourceCatalog.map((resource) => ({
    ...resource,
    url: `${origin}${resource.path}`,
  }));
}

export function getIntegrationExportCatalog(origin: string) {
  return exportCatalog.map((entry) => ({
    ...entry,
    path: `/api/exports/${entry.entity}`,
    csvUrl: `${origin}/api/exports/${entry.entity}`,
  }));
}

const sampleApiSelect = {
  id: true,
  sampleLabel: true,
  sampleType: true,
  status: true,
  collectedAt: true,
  storageLocation: true,
  quantityLabel: true,
  notes: true,
  createdAt: true,
  animalId: true,
  animal: {
    select: {
      animalId: true,
      labId: true,
    },
  },
  project: {
    select: {
      projectCode: true,
    },
  },
} as const;

const cryostorageApiSelect = {
  id: true,
  sampleLabel: true,
  materialType: true,
  status: true,
  storedAt: true,
  storageLocation: true,
  quantityLabel: true,
  recoveryNotes: true,
  notes: true,
  createdAt: true,
  strainId: true,
  strain: {
    select: {
      name: true,
    },
  },
  project: {
    select: {
      projectCode: true,
    },
  },
} as const;

const genotypeApiSelect = {
  id: true,
  animalId: true,
  sourceType: true,
  assayType: true,
  sampleId: true,
  markerTested: true,
  resultText: true,
  sampleDate: true,
  resultDate: true,
  provider: true,
  finalCall: true,
  status: true,
  confidence: true,
  animal: {
    select: {
      animalId: true,
      labId: true,
    },
  },
  attachments: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      label: true,
      fileName: true,
      fileType: true,
      storageUrl: true,
    },
  },
} as const;

const breedingSetupApiSelect = {
  id: true,
  startDate: true,
  status: true,
  targetGenotype: true,
  targetSex: true,
  notes: true,
  adults: {
    orderBy: [{ role: "asc" }, { id: "asc" }],
    select: {
      role: true,
      animal: {
        select: {
          id: true,
          animalId: true,
          sex: true,
          status: true,
          currentCage: {
            select: {
              barcode: true,
              cageNumber: true,
              rack: {
                select: {
                  rackNumber: true,
                  room: {
                    select: {
                      roomNumber: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  litters: {
    orderBy: [{ birthDate: "desc" }, { id: "desc" }],
    take: 1,
    select: {
      id: true,
      birthDate: true,
      litterSizeBirth: true,
      litterSizeWean: true,
      notes: true,
      litterAnimals: {
        select: {
          id: true,
        },
      },
    },
  },
} satisfies Prisma.BreedingSetupSelect;

const litterApiSelect = {
  id: true,
  birthDate: true,
  litterSizeBirth: true,
  litterSizeWean: true,
  notes: true,
  breedingSetupId: true,
  breedingSetup: {
    select: {
      targetGenotype: true,
      status: true,
      adults: {
        orderBy: [{ role: "asc" }, { id: "asc" }],
        select: {
          role: true,
          animal: {
            select: {
              animalId: true,
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
} satisfies Prisma.LitterSelect;

const weaningApiSelect = {
  id: true,
  birthDate: true,
  litterSizeBirth: true,
  litterSizeWean: true,
  notes: true,
  breedingSetupId: true,
  breedingSetup: {
    select: {
      targetGenotype: true,
      status: true,
    },
  },
  litterAnimals: {
    orderBy: [{ animal: { sex: "asc" } }, { animal: { animalId: "asc" } }],
    select: {
      animal: {
        select: {
          id: true,
          animalId: true,
          sex: true,
          strain: {
            select: {
              id: true,
              name: true,
            },
          },
          currentCage: {
            select: {
              id: true,
              barcode: true,
              cageNumber: true,
              rack: {
                select: {
                  rackNumber: true,
                  room: {
                    select: {
                      roomNumber: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.LitterSelect;

const cageHealthNoteApiSelect = {
  id: true,
  cageId: true,
  noteType: true,
  severity: true,
  note: true,
  followupRequired: true,
  actionTaken: true,
  resolved: true,
  createdAt: true,
  cage: {
    select: {
      barcode: true,
    },
  },
  attachments: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      label: true,
      fileName: true,
      fileType: true,
      storageUrl: true,
    },
  },
} as const;

const experimentAssignmentApiSelect = {
  id: true,
  animalId: true,
  experimentId: true,
  status: true,
  startDate: true,
  endDate: true,
  treatmentGroup: true,
  notes: true,
  isPrimary: true,
  animal: {
    select: {
      animalId: true,
      labId: true,
    },
  },
  experiment: {
    select: {
      experimentCode: true,
      title: true,
    },
  },
} as const;

function formatSampleApiRecord(record: {
  id: string;
  sampleLabel: string;
  sampleType: string;
  status: SampleStatus;
  collectedAt: Date;
  storageLocation: string | null;
  quantityLabel: string | null;
  notes: string | null;
  createdAt: Date;
  animalId: string;
  animal: {
    animalId: string;
    labId: string;
  };
  project: {
    projectCode: string;
  } | null;
}) {
  return {
    id: record.id,
    sampleLabel: record.sampleLabel,
    sampleType: record.sampleType,
    status: record.status,
    collectedAt: record.collectedAt.toISOString(),
    storageLocation: record.storageLocation,
    quantityLabel: record.quantityLabel,
    notes: record.notes,
    createdAt: record.createdAt.toISOString(),
    animalId: record.animalId,
    animalCode: record.animal.animalId,
    labId: record.animal.labId,
    projectCode: record.project?.projectCode ?? null,
  };
}

function formatCryostorageApiRecord(record: {
  id: string;
  sampleLabel: string;
  materialType: string;
  status: CryostorageStatus;
  storedAt: Date;
  storageLocation: string | null;
  quantityLabel: string | null;
  recoveryNotes: string | null;
  notes: string | null;
  createdAt: Date;
  strainId: string;
  strain: {
    name: string;
  };
  project: {
    projectCode: string;
  } | null;
}) {
  return {
    id: record.id,
    sampleLabel: record.sampleLabel,
    materialType: record.materialType,
    status: record.status,
    storedAt: record.storedAt.toISOString(),
    storageLocation: record.storageLocation,
    quantityLabel: record.quantityLabel,
    recoveryNotes: record.recoveryNotes,
    notes: record.notes,
    createdAt: record.createdAt.toISOString(),
    strainId: record.strainId,
    strainName: record.strain.name,
    projectCode: record.project?.projectCode ?? null,
  };
}

function formatExperimentAssignmentApiRecord(record: {
  id: string;
  animalId: string;
  experimentId: string;
  status: AssignmentStatus;
  startDate: Date;
  endDate: Date | null;
  treatmentGroup: string | null;
  notes: string | null;
  isPrimary: boolean;
  animal: {
    animalId: string;
    labId: string;
  };
  experiment: {
    experimentCode: string;
    title: string;
  };
}) {
  return {
    id: record.id,
    experimentId: record.experimentId,
    experimentCode: record.experiment.experimentCode,
    experimentTitle: record.experiment.title,
    animalId: record.animalId,
    animalCode: record.animal.animalId,
    labId: record.animal.labId,
    status: record.status,
    startDate: record.startDate.toISOString(),
    endDate: record.endDate?.toISOString() ?? null,
    treatmentGroup: record.treatmentGroup,
    notes: record.notes,
    isPrimary: record.isPrimary,
  };
}

function formatBreedingSetupApiRecord(record: {
  id: string;
  startDate: Date;
  status: string;
  targetGenotype: string;
  targetSex: string | null;
  notes: string | null;
  adults: Array<{
    role: string;
    animal: {
      id: string;
      animalId: string;
      sex: string;
      status: string;
      currentCage: {
        barcode: string;
        cageNumber: string;
        rack: {
          rackNumber: string;
          room: {
            roomNumber: string;
          };
        };
      } | null;
    };
  }>;
  litters: Array<{
    id: string;
    birthDate: Date;
    litterSizeBirth: number;
    litterSizeWean: number | null;
    notes: string | null;
    litterAnimals: Array<{ id: string }>;
  }>;
}) {
  return {
    id: record.id,
    startDate: record.startDate.toISOString().slice(0, 10),
    status: record.status,
    targetGenotype: record.targetGenotype,
    targetSex: record.targetSex ?? "unknown",
    notes: record.notes,
    adults: record.adults.map((adult) => ({
      role: adult.role,
      animalCode: adult.animal.animalId,
      sex: adult.animal.sex,
      status: adult.animal.status,
      cageBarcode: adult.animal.currentCage?.barcode ?? null,
      cageLabel: adult.animal.currentCage
        ? `${adult.animal.currentCage.rack.room.roomNumber} / ${adult.animal.currentCage.rack.rackNumber} / ${adult.animal.currentCage.cageNumber}`
        : null,
    })),
    latestLitter: record.litters[0]
      ? {
          id: record.litters[0].id,
          birthDate: record.litters[0].birthDate.toISOString().slice(0, 10),
          litterSizeBirth: record.litters[0].litterSizeBirth,
          litterSizeWean: record.litters[0].litterSizeWean,
          notes: record.litters[0].notes,
          progenyCount: record.litters[0].litterAnimals.length,
        }
      : null,
  };
}

function formatLitterApiRecord(record: {
  id: string;
  birthDate: Date;
  litterSizeBirth: number;
  litterSizeWean: number | null;
  notes: string | null;
  breedingSetupId: string;
  breedingSetup: {
    targetGenotype: string;
    status: string;
    adults: Array<{
      role: string;
      animal: {
        animalId: string;
      };
    }>;
  };
  litterAnimals: Array<{ id: string }>;
}) {
  return {
    id: record.id,
    breedingSetupId: record.breedingSetupId,
    birthDate: record.birthDate.toISOString().slice(0, 10),
    litterSizeBirth: record.litterSizeBirth,
    litterSizeWean: record.litterSizeWean,
    notes: record.notes,
    targetGenotype: record.breedingSetup.targetGenotype,
    breedingStatus: record.breedingSetup.status,
    adults: record.breedingSetup.adults.map((adult) => ({
      role: adult.role,
      animalCode: adult.animal.animalId,
    })),
    progenyCount: record.litterAnimals.length,
  };
}

function formatWeaningApiRecord(
  record: {
    id: string;
    birthDate: Date;
    litterSizeBirth: number;
    litterSizeWean: number | null;
    notes: string | null;
    breedingSetupId: string;
    breedingSetup: {
      targetGenotype: string;
      status: string;
    };
    litterAnimals: Array<{
      animal: {
        id: string;
        animalId: string;
        sex: string;
        strain: {
          id: string;
          name: string;
        };
        currentCage: {
          id: string;
          barcode: string;
          cageNumber: string;
          rack: {
            rackNumber: string;
            room: {
              roomNumber: string;
            };
          };
        } | null;
      };
    }>;
  },
  newValue?: Prisma.JsonValue | null,
) {
  const animals = record.litterAnimals.map((entry) => entry.animal);
  const femaleAnimals = animals.filter((animal) => animal.sex === "female");
  const maleAnimals = animals.filter((animal) => animal.sex === "male");
  const strain = animals[0]?.strain ?? null;
  const toCageSummary = (animal: (typeof animals)[number] | undefined) =>
    animal?.currentCage
      ? {
          cageId: animal.currentCage.id,
          cageBarcode: animal.currentCage.barcode,
          cageLabel: `${animal.currentCage.rack.room.roomNumber} / ${animal.currentCage.rack.rackNumber} / ${animal.currentCage.cageNumber}`,
        }
      : null;
  const auditValue =
    newValue && typeof newValue === "object" && !Array.isArray(newValue)
      ? (newValue as Record<string, Prisma.JsonValue>)
      : null;
  const weanDate = typeof auditValue?.weanDate === "string" ? auditValue.weanDate : null;

  return {
    litterId: record.id,
    breedingSetupId: record.breedingSetupId,
    birthDate: record.birthDate.toISOString().slice(0, 10),
    litterSizeBirth: record.litterSizeBirth,
    litterSizeWean: record.litterSizeWean,
    notes: record.notes,
    targetGenotype: record.breedingSetup.targetGenotype,
    breedingStatus: record.breedingSetup.status,
    weanDate,
    femaleCount: femaleAnimals.length,
    maleCount: maleAnimals.length,
    strainId: strain?.id ?? null,
    strainName: strain?.name ?? null,
    femaleCage: toCageSummary(femaleAnimals[0]),
    maleCage: toCageSummary(maleAnimals[0]),
    progeny: animals.map((animal) => ({
      animalCode: animal.animalId,
      sex: animal.sex,
      strainId: animal.strain.id,
      strainName: animal.strain.name,
      cageId: animal.currentCage?.id ?? null,
      cageBarcode: animal.currentCage?.barcode ?? null,
      cageLabel: animal.currentCage
        ? `${animal.currentCage.rack.room.roomNumber} / ${animal.currentCage.rack.rackNumber} / ${animal.currentCage.cageNumber}`
        : null,
    })),
  };
}

function formatCageHealthNoteApiRecord(record: {
  id: string;
  cageId: string | null;
  noteType: HealthNoteType;
  severity: AlertSeverity;
  note: string;
  followupRequired: boolean;
  actionTaken: string | null;
  resolved: boolean;
  createdAt: Date;
  cage: {
    barcode: string;
  } | null;
  attachments: Array<{
    id: string;
    label: string;
    fileName: string;
    fileType: string;
    storageUrl: string;
  }>;
}) {
  return {
    id: record.id,
    cageId: record.cageId,
    cageBarcode: record.cage?.barcode ?? null,
    noteType: record.noteType,
    severity: record.severity,
    note: record.note,
    followupRequired: record.followupRequired,
    actionTaken: record.actionTaken,
    resolved: record.resolved,
    createdAt: record.createdAt.toISOString(),
    attachments: record.attachments.map((attachment) => ({
      id: attachment.id,
      label: attachment.label,
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      storageUrl: attachment.storageUrl,
    })),
  };
}

function formatGenotypeApiRecord(record: {
  id: string;
  animalId: string;
  sourceType: string;
  assayType: string;
  sampleId: string | null;
  markerTested: string;
  resultText: string;
  sampleDate: Date;
  resultDate: Date;
  provider: string | null;
  finalCall: string;
  status: GenotypeCallStatus;
  confidence: string | null;
  animal: {
    animalId: string;
    labId: string;
  };
  attachments: Array<{
    id: string;
    label: string;
    fileName: string;
    fileType: string;
    storageUrl: string;
  }>;
}) {
  return {
    id: record.id,
    animalId: record.animalId,
    animalCode: record.animal.animalId,
    labId: record.animal.labId,
    markerTested: record.markerTested,
    finalCall: record.finalCall,
    zygosity: record.finalCall.startsWith(`${record.markerTested} `)
      ? record.finalCall.slice(record.markerTested.length + 1)
      : null,
    status: record.status,
    resultText: record.resultText,
    sourceType: record.sourceType,
    assayType: record.assayType,
    provider: record.provider,
    confidence: record.confidence,
    sampleId: record.sampleId,
    sampleDate: record.sampleDate.toISOString(),
    resultDate: record.resultDate.toISOString(),
    attachments: record.attachments.map((attachment) => ({
      id: attachment.id,
      label: attachment.label,
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      storageUrl: attachment.storageUrl,
    })),
  };
}
