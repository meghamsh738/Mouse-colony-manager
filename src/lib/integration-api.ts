import { getAnimalDetailView, getAnimalListView } from "@/lib/animals-read";
import { getCageDetailView, getCageListView } from "@/lib/cages-read";
import { getExperimentOverviewView } from "@/lib/experiments-read";
import { prisma } from "@/lib/prisma";
import { getSampleInventoryView } from "@/lib/samples-read";
import type { AssignmentStatus, GenotypeCallStatus, SampleStatus } from "@/lib/types";

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

export type ResolvedGenotypeApiInput = {
  alleleId: string;
  animalCode: string;
  animalId: string;
  marker: string;
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

export async function getAnimalApiDetail(animalId: string) {
  return getAnimalDetailView(animalId);
}

export async function getCageApiDetail(cageId: string) {
  return getCageDetailView(cageId);
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

export async function getSampleApiRecordById(sampleId: string) {
  const record = await prisma.sampleRecord.findUnique({
    where: { id: sampleId },
    select: sampleApiSelect,
  });

  return record ? formatSampleApiRecord(record) : null;
}

export async function getSampleApiRecordByLabel(sampleLabel: string) {
  const record = await prisma.sampleRecord.findUnique({
    where: { sampleLabel },
    select: sampleApiSelect,
  });

  return record ? formatSampleApiRecord(record) : null;
}

export async function getGenotypeApiRecordById(recordId: string) {
  const record = await prisma.genotypingRecord.findUnique({
    where: { id: recordId },
    select: genotypeApiSelect,
  });

  return record ? formatGenotypeApiRecord(record) : null;
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
  },
  {
    name: "cages",
    path: "/api/v1/cages",
    detailPath: "/api/v1/cages/{cageId}",
    description: "Cage summaries, occupancy, notes, and movement history.",
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
    description: "Sample inventory summaries and external sample intake.",
    methods: ["GET", "POST"],
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
  };
}
