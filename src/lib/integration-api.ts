import { Prisma } from "@prisma/client";

import { getAnimalDetailView, getAnimalListView } from "@/lib/animals-read";
import { normalizeUserRole, type Capability } from "@/lib/capabilities";
import { getCageDetailView, getCageListView } from "@/lib/cages-read";
import { getCryostorageInventoryView } from "@/lib/cryostorage-read";
import { getExperimentOverviewView } from "@/lib/experiments-read";
import { parseGenotypeImportCsv } from "@/lib/genotype-import";
import { getActorLabAccess, labScopedWhere, type LabActor } from "@/lib/lab-access";
import { parseExternalTransferProvenance } from "@/lib/lifecycle-provenance";
import { prisma } from "@/lib/prisma";
import { getRuleSummaryView } from "@/lib/settings-read";
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

type IntegrationReadActor = LabActor & {
  canonicalRole?: ReturnType<typeof normalizeUserRole>;
  capabilities?: readonly Capability[];
};

function canReadPrivateExperimentData(actor: IntegrationReadActor) {
  if (actor.capabilities) return actor.capabilities.includes("experiments:full");
  return (actor.canonicalRole ?? normalizeUserRole(actor.role)) !== "cmu_staff";
}

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

export type CreateAnimalApiInput = {
  animalCode: string;
  labId: string;
  sex: "male" | "female" | "unknown";
  dob: string;
  strainId?: string;
  strainName?: string;
  cageId?: string;
  cageBarcode?: string;
  projectId?: string;
  projectCode?: string;
  notes?: string;
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

export type ProjectOwnerApiReferenceInput = {
  ownerId?: string;
  ownerEmail?: string;
};

export type SampleApiFilters = {
  search: string;
  status: string;
  animalCode: string;
  projectCode: string;
  experimentCode: string;
  limit: number;
};

export type CryostorageApiFilters = {
  search: string;
  status: string;
  strain: string;
  projectCode: string;
  limit: number;
};

export type RuleApiFilters = {
  search: string;
  category: string;
  criticalOnly: boolean;
  limit: number;
};

export type CreateSampleApiInput = {
  animalId?: string;
  animalCode?: string;
  projectId?: string;
  projectCode?: string;
  experimentId?: string;
  experimentCode?: string;
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
  expectedExperimentVersion: number;
  startDate: string;
  notes?: string;
  assignments: Array<{
    animalId?: string;
    animalCode?: string;
    treatmentGroup?: string;
  }>;
};

export type CreateExperimentReservationApiInput = {
  experimentId?: string;
  experimentCode?: string;
  animalId?: string;
  animalCode?: string;
  expectedAnimalVersion: number;
  expectedExperimentVersion: number;
  startDate: string;
  treatmentGroup?: string;
  notes?: string;
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

export type RuleApiReferenceInput = {
  ruleId?: string;
  ruleKey?: string;
};

export type ResolvedSampleApiInput = {
  animalCode: string;
  animalId: string;
  labId: string;
  projectCode: string | null;
  projectId?: string;
  experimentCode: string | null;
  experimentId?: string;
};

export type ResolvedSampleApiRecordReference = {
  sampleId: string;
  sampleLabel: string;
};

export type ResolvedCryostorageApiInput = {
  labId?: string;
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
  labId: string;
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
  experimentVersion: number;
  assignments: Array<{
    animalCode: string;
    animalId: string;
    treatmentGroup: string;
  }>;
};

export type ResolvedExperimentReservationApiInput = {
  animalCode: string;
  animalId: string;
  animalVersion: number;
  experimentCode: string;
  experimentId: string;
  experimentVersion: number;
  treatmentGroup?: string;
  notes?: string;
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

export type ResolvedProjectApiReference = {
  labId: string;
  projectId: string;
  projectCode: string;
};

export type ResolvedProjectOwnerApiReference = {
  ownerEmail: string;
  ownerId: string;
  ownerName: string;
};

export type ResolvedExperimentApiReference = {
  experimentCode: string;
  experimentId: string;
  version: number;
  labId: string;
  projectId: string;
};

export type ResolvedRuleApiReference = {
  ruleId: string;
  ruleKey: string;
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
    experimentCode: normalizeText(searchParams.get("experimentCode")),
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

export function parseRuleApiFilters(searchParams: URLSearchParams): RuleApiFilters {
  return {
    search: normalizeText(searchParams.get("search")),
    category: normalizeText(searchParams.get("category")),
    criticalOnly: parseBoolean(searchParams.get("criticalOnly")),
    limit: parseLimit(searchParams.get("limit")),
  };
}

export async function getAnimalApiList(filters: AnimalApiFilters, actor: IntegrationReadActor) {
  const animalView = await getAnimalListView(actor);
  const includeExperiments = canReadPrivateExperimentData(actor);
  const consistencyRows = await prisma.animal.findMany({
    where: { id: { in: animalView.map((animal) => animal.id) } },
    select: {
      id: true,
      owningLabId: true,
      version: true,
      projectAllocations: {
        where: { endedAt: null },
        select: { project: { select: { labId: true, projectCode: true } } },
      },
    },
  });
  const experimentRows = includeExperiments && animalView.length
    ? await prisma.experimentAssignment.findMany({
        where: { animalId: { in: animalView.map((animal) => animal.id) } },
        select: {
          animalId: true,
          animal: { select: { owningLabId: true } },
          experiment: { select: { labId: true, experimentCode: true } },
        },
      })
    : [];
  const experimentCodesByAnimalId = new Map<string, string[]>();
  for (const assignment of experimentRows) {
    if (assignment.experiment.labId !== assignment.animal.owningLabId) continue;
    experimentCodesByAnimalId.set(assignment.animalId, [
      ...(experimentCodesByAnimalId.get(assignment.animalId) ?? []),
      assignment.experiment.experimentCode,
    ]);
  }
  const relationshipsByAnimalId = new Map(
    consistencyRows.map((animal) => [
      animal.id,
      {
        projectCodes: animal.projectAllocations
          .filter((allocation) => allocation.project.labId === animal.owningLabId)
          .map((allocation) => allocation.project.projectCode),
        experimentCodes: experimentCodesByAnimalId.get(animal.id) ?? [],
      },
    ]),
  );
  const animals = animalView.map((animal) => {
    const relationships = relationshipsByAnimalId.get(animal.id);
    return {
      ...animal,
      projectCodes: relationships?.projectCodes ?? [],
      experimentSummary: relationships?.experimentCodes.join(", ") || "None",
    };
  });
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

export async function getCageApiList(filters: CageApiFilters, actor: LabActor) {
  const cageView = await getCageListView(actor);
  const consistencyRows = await prisma.cage.findMany({
    where: { id: { in: cageView.map((cage) => cage.id) } },
    select: {
      id: true,
      labId: true,
      animals: {
        where: { outcomeStatus: "alive" },
        select: {
          animalId: true,
          labId: true,
          owningLabId: true,
          sex: true,
          strain: { select: { name: true } },
          projectAllocations: {
            where: { endedAt: null },
            select: { project: { select: { labId: true, projectCode: true } } },
          },
        },
      },
    },
  });
  const relationshipsByCageId = new Map(
    consistencyRows.map((cage) => {
      const animals = cage.animals.filter((animal) => animal.owningLabId === cage.labId);
      return [cage.id, { labId: cage.labId, animals }] as const;
    }),
  );
  const cages = cageView.map((cage) => {
    const relationship = relationshipsByCageId.get(cage.id);
    const animals = relationship?.animals ?? [];
    const sexCounts = animals.reduce<Record<string, number>>((counts, animal) => {
      counts[animal.sex] = (counts[animal.sex] ?? 0) + 1;
      return counts;
    }, {});
    const projectCodes = Array.from(
      new Set(
        animals.flatMap((animal) =>
          animal.projectAllocations
            .filter((allocation) => allocation.project.labId === relationship?.labId)
            .map((allocation) => allocation.project.projectCode),
        ),
      ),
    );

    return {
      ...cage,
      occupantCount: animals.length,
      remainingCapacity: Math.max(0, cage.capacity - animals.length),
      animalIdentifiers: animals.map((animal) => animal.animalId),
      animalLabIdentifiers: animals.map((animal) => animal.labId),
      sexComposition: animals.length
        ? Object.entries(sexCounts)
            .map(([sex, count]) => `${count}${sex === "male" ? "M" : sex === "female" ? "F" : "U"}`)
            .join(" / ")
        : "Empty",
      strainSummary: Array.from(new Set(animals.map((animal) => animal.strain.name))).join(", ") || "No active occupants",
      projectSummary: projectCodes.join(", ") || "Unallocated",
    };
  });
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

export async function getExperimentApiList(filters: ExperimentApiFilters, actor: LabActor) {
  const experimentView = await getExperimentOverviewView(actor);
  const consistencyRows = await prisma.experiment.findMany({
    where: { id: { in: experimentView.map((experiment) => experiment.id) } },
    select: {
      id: true,
      labId: true,
      project: { select: { labId: true } },
      assignments: { select: { id: true, animal: { select: { owningLabId: true } } } },
    },
  });
  const consistentExperimentIds = new Set(
    consistencyRows
      .filter((experiment) => experiment.project.labId === experiment.labId)
      .map((experiment) => experiment.id),
  );
  const consistentAssignmentIds = new Set(
    consistencyRows.flatMap((experiment) =>
      experiment.assignments
        .filter((assignment) => assignment.animal.owningLabId === experiment.labId)
        .map((assignment) => assignment.id),
    ),
  );
  const experiments = experimentView
    .filter((experiment) => consistentExperimentIds.has(experiment.id))
    .map((experiment) => ({
      ...experiment,
      assignments: experiment.assignments.filter((assignment) => consistentAssignmentIds.has(assignment.id)),
    }));
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

const projectApiSelect = {
  id: true,
  labId: true,
  projectCode: true,
  title: true,
  notes: true,
  ownerId: true,
  owner: {
    select: {
      id: true,
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
      animal: { select: { owningLabId: true } },
    },
  },
  experiments: {
    select: {
      id: true,
      labId: true,
      status: true,
    },
  },
} satisfies Prisma.ProjectSelect;

type ProjectApiRecordSource = Prisma.ProjectGetPayload<{ select: typeof projectApiSelect }>;

function buildProjectApiRecord(project: ProjectApiRecordSource) {
  const labAllocations = project.animalAllocations.filter(
    (allocation) => allocation.animal.owningLabId === project.labId,
  );
  const labExperiments = project.experiments.filter((experiment) => experiment.labId === project.labId);

  return {
    id: project.id,
    labId: project.labId,
    projectCode: project.projectCode,
    title: project.title,
    notes: project.notes,
    ownerId: project.ownerId,
    ownerName: project.owner.name ?? project.owner.email,
    ownerEmail: project.owner.email,
    activeAnimalAllocations: labAllocations.length,
    experimentCount: labExperiments.length,
    activeExperimentCount: labExperiments.filter((experiment) => experiment.status === "active").length,
  };
}

export async function getProjectApiRecordById(projectId: string, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...labScopedWhere(access) },
    select: projectApiSelect,
  });

  return project ? buildProjectApiRecord(project) : null;
}

export async function getProjectApiRecordByCode(projectCode: string, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const project = await prisma.project.findFirst({
    where: { projectCode, ...labScopedWhere(access) },
    select: projectApiSelect,
  });

  return project ? buildProjectApiRecord(project) : null;
}

export async function getProjectApiList(filters: ProjectApiFilters, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const projects = await prisma.project.findMany({
    where: labScopedWhere(access),
    orderBy: { projectCode: "asc" },
    select: projectApiSelect,
  });
  const search = normalizeSearch(filters.search);
  const owner = normalizeSearch(filters.owner);

  const filtered = projects
    .map((project) => buildProjectApiRecord(project))
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

export async function getSampleApiList(filters: SampleApiFilters, actor: LabActor) {
  const sampleView = await getSampleInventoryView(actor);
  const consistencyRows = await prisma.sampleRecord.findMany({
    where: { id: { in: sampleView.map((sample) => sample.id) } },
    select: {
      id: true,
      labId: true,
      animal: { select: { owningLabId: true } },
      project: { select: { labId: true } },
      experiment: { select: { labId: true } },
    },
  });
  const consistentSampleIds = new Set(
    consistencyRows
      .filter(
        (sample) =>
          (!sample.project || sample.project.labId === sample.labId) &&
          (!sample.experiment || sample.experiment.labId === sample.labId),
      )
      .map((sample) => sample.id),
  );
  const samples = sampleView.filter((sample) => consistentSampleIds.has(sample.id));
  const search = normalizeSearch(filters.search);
  const animalCode = normalizeSearch(filters.animalCode);
  const projectCode = normalizeSearch(filters.projectCode);
  const experimentCode = normalizeSearch(filters.experimentCode);

  const filtered = samples.filter((sample) => {
    const matchesSearch = search
      ? buildHaystack([
          sample.sampleLabel,
          sample.sampleType,
          sample.status,
          sample.animalCode,
          sample.labId,
          sample.projectCode,
          sample.experimentCode,
          sample.storageLocation,
          sample.quantityLabel,
          sample.notes,
        ]).includes(search)
      : true;
    const matchesStatus = filters.status !== "all" ? sample.status === filters.status : true;
    const matchesAnimal = animalCode ? sample.animalCode.toLowerCase().includes(animalCode) : true;
    const matchesProject = projectCode ? sample.projectCode?.toLowerCase().includes(projectCode) : true;
    const matchesExperiment = experimentCode ? sample.experimentCode?.toLowerCase().includes(experimentCode) : true;

    return matchesSearch && matchesStatus && matchesAnimal && matchesProject && matchesExperiment;
  });

  return {
    data: applyLimit(filtered, filters.limit),
    total: filtered.length,
  };
}

export async function getCryostorageApiList(filters: CryostorageApiFilters, actor: LabActor) {
  const recordView = await getCryostorageInventoryView(actor);
  const consistencyRows = await prisma.cryostorageRecord.findMany({
    where: { id: { in: recordView.map((record) => record.id) } },
    select: { id: true, labId: true, project: { select: { labId: true } } },
  });
  const consistentRecordIds = new Set(
    consistencyRows
      .filter((record) => !record.project || record.project.labId === record.labId)
      .map((record) => record.id),
  );
  const records = recordView.filter((record) => consistentRecordIds.has(record.id));
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

export async function getRuleApiList(filters: RuleApiFilters, actor: LabActor) {
  void actor;
  const rules = await getRuleSummaryView();
  const search = normalizeSearch(filters.search);
  const category = normalizeSearch(filters.category);

  const filtered = rules.filter((rule) => {
    const matchesSearch = search
      ? buildHaystack([
          rule.key,
          rule.label,
          rule.description,
          rule.category,
          rule.valueType,
          rule.displayValue,
          rule.editorValue,
        ]).includes(search)
      : true;
    const matchesCategory = category ? rule.category.toLowerCase().includes(category) : true;
    const matchesCritical = filters.criticalOnly ? rule.criticalBlock : true;

    return matchesSearch && matchesCategory && matchesCritical;
  });

  return {
    data: applyLimit(filtered, filters.limit),
    total: filtered.length,
  };
}

export async function getAnimalApiDetail(animalId: string, actor: LabActor) {
  const record = await getAnimalApiRecordById(animalId, actor);

  if (!record) {
    return null;
  }

  const [detail, experiments, projects] = await Promise.all([
    getAnimalDetailView(animalId, actor),
    prisma.experiment.findMany({
      where: { labId: record.animal.owningLabId },
      select: { id: true },
    }),
    prisma.project.findMany({
      where: { labId: record.animal.owningLabId },
      select: { id: true },
    }),
  ]);

  if (!detail) {
    return null;
  }

  const experimentIds = new Set(experiments.map((experiment) => experiment.id));
  const projectIds = new Set(projects.map((project) => project.id));

  return {
    ...detail,
    experimentOptions: detail.experimentOptions.filter((experiment) => experimentIds.has(experiment.id)),
    projectOptions: detail.projectOptions.filter((project) => projectIds.has(project.id)),
    defaultSampleProjectId:
      detail.defaultSampleProjectId && projectIds.has(detail.defaultSampleProjectId)
        ? detail.defaultSampleProjectId
        : null,
  };
}

export async function getAnimalApiRecordById(animalId: string, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const animal = await prisma.animal.findFirst({
    where: { id: animalId, ...labScopedWhere(access, "owningLabId") },
    select: {
      id: true,
      animalId: true,
      labId: true,
      owningLabId: true,
      version: true,
      status: true,
      dob: true,
      outcomeStatus: true,
      experimentalStatus: true,
      deathDate: true,
      deathReason: true,
      currentCage: {
        select: {
          labId: true,
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
              labId: true,
            },
          },
        },
      },
      experimentAssignments: {
        select: {
          experiment: { select: { labId: true } },
        },
      },
      sampleRecords: {
        select: {
          labId: true,
          project: { select: { labId: true } },
        },
      },
      genotypingRecords: { select: { labId: true } },
      healthNotes: { select: { labId: true } },
    },
  });

  if (!animal) {
    return null;
  }

  if (
    animal.projectAllocations.some((allocation) => allocation.project.labId !== animal.owningLabId) ||
    animal.experimentAssignments.some((assignment) => assignment.experiment.labId !== animal.owningLabId) ||
    animal.sampleRecords.some(
      (sample) =>
        sample.labId !== animal.owningLabId ||
        (sample.project && sample.project.labId !== animal.owningLabId),
    ) ||
    animal.genotypingRecords.some((record) => record.labId !== animal.owningLabId) ||
    animal.healthNotes.some((note) => note.labId !== animal.owningLabId) ||
    (animal.currentCage && animal.currentCage.labId !== animal.owningLabId)
  ) {
    return null;
  }

  const externalTransfer = animal.outcomeStatus === "transferred"
    ? parseExternalTransferProvenance((await prisma.auditLog.findFirst({
        where: {
          entityType: "animal",
          entityId: animal.id,
          action: "lifecycle_update",
          newValue: { path: ["status"], equals: "transferred_out" },
        },
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
        select: { newValue: true },
      }))?.newValue)
    : null;

  return {
    animal: {
      id: animal.id,
      animalId: animal.animalId,
      labId: animal.labId,
      owningLabId: animal.owningLabId,
      version: animal.version,
      status: animal.status,
      dob: animal.dob.toISOString(),
      outcomeStatus: animal.outcomeStatus,
      experimentalStatus: animal.experimentalStatus,
      deathDate: animal.deathDate?.toISOString() ?? null,
      deathReason: animal.deathReason ?? null,
      externalTransfer,
    },
    cageLabel: animal.currentCage
      ? `${animal.currentCage.room.roomNumber} / ${animal.currentCage.rack.rackNumber} / ${animal.currentCage.cageNumber}`
      : animal.status === "archived" ? "Archived" : "Not in cage",
    strainName: animal.strain.name,
    projectCodes: animal.projectAllocations.map((allocation) => allocation.project.projectCode),
  };
}

export async function getExistingAnimalApiRecord(input: {
  animalCode: string;
  labId: string;
  cageId: string;
  strainId: string;
  projectId?: string;
}, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const animal = await prisma.animal.findFirst({
    where: {
      ...labScopedWhere(access, "owningLabId"),
      animalId: input.animalCode.trim(),
      labId: input.labId.trim(),
      currentCageId: input.cageId,
      strainId: input.strainId,
      projectAllocations: input.projectId
        ? {
            some: {
              projectId: input.projectId,
              endedAt: null,
            },
          }
        : undefined,
    },
    select: {
      id: true,
      projectAllocations: {
        where: { endedAt: null },
        select: {
          projectId: true,
        },
      },
    },
  });

  if (!animal) {
    return null;
  }

  if (!input.projectId && animal.projectAllocations.length > 0) {
    return null;
  }

  return getAnimalApiRecordById(animal.id, actor);
}

export async function getCageApiDetail(cageId: string, actor: LabActor) {
  if (!(await getCageApiRecordById(cageId, actor))) {
    return null;
  }

  return getCageDetailView(cageId, actor);
}

export async function getCageApiRecordById(cageId: string, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const cage = await prisma.cage.findFirst({
    where: { id: cageId, ...labScopedWhere(access) },
    select: {
      id: true,
      labId: true,
      barcode: true,
      status: true,
      cageNumber: true,
      lastUpdatedAt: true,
      animals: {
        where: { outcomeStatus: "alive" },
        select: {
          owningLabId: true,
        },
      },
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

  if (cage.animals.some((animal) => animal.owningLabId !== cage.labId)) {
    return null;
  }

  return {
    id: cage.id,
    labId: cage.labId,
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
}, actor: LabActor): Promise<
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

  const access = await getActorLabAccess(actor);
  const select = { id: true, facilityCageId: true, barcode: true, labId: true } as const;
  const directReferences = [
    ...(cageRef ? [{ id: cageRef }, { facilityCageId: cageRef }, { barcode: cageRef }] : []),
    ...(cageBarcode ? [{ facilityCageId: cageBarcode }, { barcode: cageBarcode }] : []),
  ];
  let cage = null;
  for (const reference of directReferences) {
    cage = await prisma.cage.findFirst({ where: { ...labScopedWhere(access), ...reference }, select });
    if (cage) break;
  }

  if (!cage) {
    const aliases = [...new Set([cageRef, cageBarcode].filter((value): value is string => Boolean(value)))];
    for (const reference of aliases) {
      const alias = await prisma.legacyIdentifierAlias.findUnique({
        where: { entityType_alias: { entityType: "cage", alias: reference } },
        select: { entityId: true },
      });
      if (!alias) continue;
      cage = await prisma.cage.findFirst({ where: { id: alias.entityId, ...labScopedWhere(access) }, select });
      if (cage) break;
    }
  }

  if (!cage) {
    return { ok: false, message: "Cage not found for the supplied cageId or cageBarcode.", status: 404 };
  }

  return {
    ok: true,
    value: {
      cageBarcode: cage.barcode,
      cageId: cage.id,
      labId: cage.labId,
    },
  };
}

export async function resolveCageMoveApiInput(input: MoveCageApiInput, actor: LabActor): Promise<
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
  const cage = await resolveCageByApiReference(input, actor);

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
}, actor: LabActor): Promise<
  | {
      ok: true;
      value: {
        animalCode: string;
        animalId: string;
        labId: string;
        owningLabId: string;
        version: number;
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

  const access = await getActorLabAccess(actor);
  const select = { id: true, facilityAnimalId: true, animalId: true, labId: true, owningLabId: true, version: true } as const;
  const directReferences = [
    ...(animalRef ? [{ id: animalRef }, { facilityAnimalId: animalRef }, { animalId: animalRef }] : []),
    ...(animalCode ? [{ facilityAnimalId: animalCode }, { animalId: animalCode }, { labId: animalCode }] : []),
  ];
  let animal = null;
  for (const reference of directReferences) {
    animal = await prisma.animal.findFirst({
      where: { ...labScopedWhere(access, "owningLabId"), ...reference },
      select,
    });
    if (animal) break;
  }

  if (!animal) {
    const aliases = [...new Set([animalRef, animalCode].filter((value): value is string => Boolean(value)))];
    for (const reference of aliases) {
      const alias = await prisma.legacyIdentifierAlias.findUnique({
        where: { entityType_alias: { entityType: "animal", alias: reference } },
        select: { entityId: true },
      });
      if (!alias) continue;
      animal = await prisma.animal.findFirst({
        where: { id: alias.entityId, ...labScopedWhere(access, "owningLabId") },
        select,
      });
      if (animal) break;
    }
  }

  if (!animal) {
    return { ok: false, message: "Animal not found for the supplied animalId or animalCode.", status: 404 };
  }

  return {
    ok: true,
    value: {
      animalCode: animal.animalId,
      animalId: animal.id,
      labId: animal.labId,
      owningLabId: animal.owningLabId,
      version: animal.version,
    },
  };
}

export async function resolveStrainByApiReference(input: {
  strainId?: string;
  strainName?: string;
}, actor: LabActor): Promise<
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
  void actor;
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

export async function resolveProjectByApiReference(input: {
  projectId?: string;
  projectCode?: string;
}, actor: LabActor): Promise<
  | {
      ok: true;
      value: ResolvedProjectApiReference;
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  const projectRef = input.projectId?.trim();
  const projectCode = input.projectCode?.trim();

  if (!projectRef && !projectCode) {
    return { ok: false, message: "Provide projectId or projectCode.", status: 400 };
  }

  const access = await getActorLabAccess(actor);
  const project = await prisma.project.findFirst({
    where: {
      ...labScopedWhere(access),
      OR: [
        ...(projectRef ? [{ id: projectRef }, { projectCode: projectRef }] : []),
        ...(projectCode ? [{ projectCode }] : []),
      ],
    },
    select: {
      id: true,
      labId: true,
      projectCode: true,
    },
  });

  if (!project) {
    return { ok: false, message: "Project not found for the supplied projectId or projectCode.", status: 404 };
  }

  return {
    ok: true,
    value: {
      projectId: project.id,
      projectCode: project.projectCode,
      labId: project.labId,
    },
  };
}

export async function resolveProjectOwnerByApiReference(
  input: ProjectOwnerApiReferenceInput,
  fallbackOwnerId: string,
  actor: LabActor,
): Promise<
  | {
      ok: true;
      value: ResolvedProjectOwnerApiReference;
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  const access = await getActorLabAccess(actor);
  const ownerId = input.ownerId?.trim();
  const ownerEmail = input.ownerEmail?.trim();
  const suppliedOwnerReference = ownerId || ownerEmail;

  const owner = await prisma.user.findFirst({
    where: {
      ...(suppliedOwnerReference
        ? {
            OR: [
              ...(ownerId ? [{ id: ownerId }] : []),
              ...(ownerEmail ? [{ email: ownerEmail }] : []),
            ],
          }
        : { id: fallbackOwnerId }),
      ...(access.canViewAll
        ? {}
        : { labMemberships: { some: { active: true, labId: { in: access.memberLabIds }, lab: { active: true } } } }),
    },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });

  if (!owner) {
    return { ok: false, message: "Project owner not found for the supplied ownerId or ownerEmail.", status: 404 };
  }

  return {
    ok: true,
    value: {
      ownerEmail: owner.email,
      ownerId: owner.id,
      ownerName: owner.name ?? owner.email,
    },
  };
}

export async function resolveSampleApiInput(input: CreateSampleApiInput, actor: LabActor): Promise<
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
  const experimentRef = input.experimentId?.trim();
  const experimentCode = input.experimentCode?.trim();
  const animal = await resolveAnimalByApiReference(input, actor);

  if (!animal.ok) {
    return animal;
  }

  const project =
    projectRef || projectCode
      ? await resolveProjectByApiReference(input, actor)
      : null;
  const experiment = experimentRef || experimentCode
    ? await resolveExperimentApiReference(input, actor)
    : null;

  if (project && !project.ok) {
    return project;
  }

  if (experiment && !experiment.ok) {
    return experiment;
  }

  if (project?.ok && project.value.labId !== animal.value.owningLabId) {
    return { ok: false, message: "Project not found for the supplied projectId or projectCode.", status: 404 };
  }
  if (experiment?.ok && experiment.value.labId !== animal.value.owningLabId) {
    return { ok: false, message: "Experiment not found for the supplied experimentId or experimentCode.", status: 404 };
  }
  if (project?.ok && experiment?.ok && project.value.projectId !== experiment.value.projectId) {
    return { ok: false, message: "The selected project and experiment must match.", status: 400 };
  }

  return {
    ok: true,
    value: {
      animalCode: animal.value.animalCode,
      animalId: animal.value.animalId,
      labId: animal.value.owningLabId,
      projectCode: project?.ok ? project.value.projectCode : null,
      projectId: project?.ok ? project.value.projectId : experiment?.ok ? experiment.value.projectId : undefined,
      experimentCode: experiment?.ok ? experiment.value.experimentCode : null,
      experimentId: experiment?.ok ? experiment.value.experimentId : undefined,
    },
  };
}

export async function resolveCryostorageApiInput(input: CreateCryostorageApiInput, actor: LabActor): Promise<
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
  const strain = await resolveStrainByApiReference(input, actor);

  if (!strain.ok) {
    return strain;
  }

  const project =
    projectRef || projectCode
      ? await resolveProjectByApiReference(input, actor)
      : null;

  if (project && !project.ok) {
    return project;
  }

  return {
    ok: true,
    value: {
      labId: project?.ok ? project.value.labId : actor.activeLabId ?? undefined,
      projectCode: project?.ok ? project.value.projectCode : null,
      projectId: project?.ok ? project.value.projectId : undefined,
      strainId: strain.value.strainId,
      strainName: strain.value.strainName,
    },
  };
}

export async function resolveGenotypeApiInput(input: CreateGenotypeApiInput, actor: LabActor): Promise<
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
  const animal = await resolveAnimalByApiReference(input, actor);
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

export async function resolveExperimentAssignmentApiInput(input: CreateExperimentAssignmentApiInput, actor: LabActor): Promise<
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
  const experiment = await resolveExperimentApiReference(input, actor);

  if (!experiment.ok) {
    return experiment;
  }

  if (!input.assignments.length) {
    return { ok: false, message: "Provide at least one assignment.", status: 400 };
  }

  const resolvedAssignments = [];
  const seenAnimalIds = new Set<string>();

  for (const assignment of input.assignments) {
    const animal = await resolveAnimalByApiReference(assignment, actor);

    if (!animal.ok) {
      return animal;
    }

    if (animal.value.owningLabId !== experiment.value.labId) {
      return { ok: false, message: "Animal not found for the supplied animalId or animalCode.", status: 404 };
    }

    if (seenAnimalIds.has(animal.value.animalId)) {
      return { ok: false, message: "Duplicate animals are not allowed in an assignment snapshot.", status: 400 };
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
      experimentVersion: experiment.value.version,
      assignments: resolvedAssignments,
    },
  };
}

export async function resolveExperimentReservationApiInput(input: CreateExperimentReservationApiInput, actor: LabActor): Promise<
  | {
      ok: true;
      value: ResolvedExperimentReservationApiInput;
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  const [experiment, animal] = await Promise.all([
    resolveExperimentApiReference(input, actor),
    resolveAnimalByApiReference(input, actor),
  ]);

  if (!experiment.ok) {
    return experiment;
  }

  if (!animal.ok) {
    return animal;
  }

  if (animal.value.owningLabId !== experiment.value.labId) {
    return { ok: false, message: "Animal not found for the supplied animalId or animalCode.", status: 404 };
  }

  return {
    ok: true,
    value: {
      animalCode: animal.value.animalCode,
      animalId: animal.value.animalId,
      animalVersion: animal.value.version,
      experimentCode: experiment.value.experimentCode,
      experimentId: experiment.value.experimentId,
      experimentVersion: experiment.value.version,
      treatmentGroup: input.treatmentGroup?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
    },
  };
}

export async function resolveExperimentApiReference(input: ExperimentApiReferenceInput, actor: LabActor): Promise<
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

  const access = await getActorLabAccess(actor);
  const experiment = await prisma.experiment.findFirst({
    where: {
      ...labScopedWhere(access),
      OR: [
        ...(experimentRef ? [{ id: experimentRef }, { experimentCode: experimentRef }] : []),
        ...(experimentCode ? [{ experimentCode }] : []),
      ],
    },
    select: {
      id: true,
      labId: true,
      experimentCode: true,
      status: true,
      projectId: true,
      version: true,
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
      labId: experiment.labId,
      projectId: experiment.projectId,
      version: experiment.version,
    },
  };
}

export async function resolveRuleApiReference(input: RuleApiReferenceInput, actor: LabActor): Promise<
  | {
      ok: true;
      value: ResolvedRuleApiReference;
    }
  | {
      ok: false;
      message: string;
      status: number;
    }
> {
  void actor;
  const ruleRef = input.ruleId?.trim();
  const ruleKey = input.ruleKey?.trim();

  if (!ruleRef && !ruleKey) {
    return { ok: false, message: "Provide ruleId or ruleKey.", status: 400 };
  }

  const rule = await prisma.ruleConfig.findFirst({
    where: {
      OR: [
        ...(ruleRef ? [{ id: ruleRef }, { key: ruleRef }] : []),
        ...(ruleKey ? [{ key: ruleKey }] : []),
      ],
    },
    select: {
      id: true,
      key: true,
    },
  });

  if (!rule) {
    return { ok: false, message: "Rule not found for the supplied ruleId or ruleKey.", status: 404 };
  }

  return {
    ok: true,
    value: {
      ruleId: rule.id,
      ruleKey: rule.key,
    },
  };
}

export async function resolveBreedingSetupApiInput(input: CreateBreedingSetupApiInput, actor: LabActor): Promise<
  | { ok: true; value: ResolvedBreedingSetupApiInput }
  | { ok: false; message: string; status: number }
> {
  const [sire, dam] = await Promise.all([
    resolveAnimalByApiReference({ animalId: input.sireId, animalCode: input.sireCode }, actor),
    resolveAnimalByApiReference({ animalId: input.damId, animalCode: input.damCode }, actor),
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

  if (sire.value.owningLabId !== dam.value.owningLabId) {
    return { ok: false, message: "Animal not found for the supplied animalId or animalCode.", status: 404 };
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

export async function getSampleApiRecordById(sampleId: string, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const record = await prisma.sampleRecord.findFirst({
    where: { id: sampleId, ...labScopedWhere(access) },
    select: sampleApiSelect,
  });

  return record && sampleRecordHasConsistentLab(record) ? formatSampleApiRecord(record) : null;
}

export async function getCryostorageApiRecordById(recordId: string, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const record = await prisma.cryostorageRecord.findFirst({
    where: { id: recordId, ...labScopedWhere(access) },
    select: cryostorageApiSelect,
  });

  return record && cryostorageRecordHasConsistentLab(record) ? formatCryostorageApiRecord(record) : null;
}

export async function getCryostorageApiRecordByLabel(sampleLabel: string, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const record = await prisma.cryostorageRecord.findFirst({
    where: { sampleLabel, ...labScopedWhere(access) },
    select: cryostorageApiSelect,
  });

  return record && cryostorageRecordHasConsistentLab(record) ? formatCryostorageApiRecord(record) : null;
}

export async function getSampleApiRecordByLabel(sampleLabel: string, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const record = await prisma.sampleRecord.findFirst({
    where: { sampleLabel, ...labScopedWhere(access) },
    select: sampleApiSelect,
  });

  return record && sampleRecordHasConsistentLab(record) ? formatSampleApiRecord(record) : null;
}

export async function resolveCryostorageApiRecordReference(input: CryostorageApiRecordReferenceInput, actor: LabActor): Promise<
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

  const access = await getActorLabAccess(actor);
  const record = await prisma.cryostorageRecord.findFirst({
    where: {
      ...labScopedWhere(access),
      OR: [
        ...(recordId ? [{ id: recordId }, { sampleLabel: recordId }] : []),
        ...(sampleLabel ? [{ sampleLabel }] : []),
      ],
    },
    select: {
      id: true,
      sampleLabel: true,
      labId: true,
      project: { select: { labId: true } },
    },
  });

  if (!record || (record.project && record.project.labId !== record.labId)) {
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

export async function resolveSampleApiRecordReference(input: SampleApiRecordReferenceInput, actor: LabActor): Promise<
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

  const access = await getActorLabAccess(actor);
  const record = await prisma.sampleRecord.findFirst({
    where: {
      ...labScopedWhere(access),
      OR: [
        ...(sampleId ? [{ id: sampleId }, { sampleLabel: sampleId }] : []),
        ...(sampleLabel ? [{ sampleLabel }] : []),
      ],
    },
    select: {
      id: true,
      sampleLabel: true,
      labId: true,
      project: { select: { labId: true } },
      experiment: { select: { labId: true } },
    },
  });

  if (
    !record ||
    (record.project && record.project.labId !== record.labId) ||
    (record.experiment && record.experiment.labId !== record.labId)
  ) {
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

export async function getGenotypeApiRecordById(recordId: string, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const record = await prisma.genotypingRecord.findFirst({
    where: { id: recordId, ...labScopedWhere(access) },
    select: genotypeApiSelect,
  });

  return record && genotypeRecordHasConsistentLab(record) ? formatGenotypeApiRecord(record) : null;
}

export async function getCageHealthNoteApiRecordById(noteId: string, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const record = await prisma.healthNote.findFirst({
    where: { id: noteId, ...labScopedWhere(access) },
    select: cageHealthNoteApiSelect,
  });

  return record && cageHealthNoteHasConsistentLab(record) ? formatCageHealthNoteApiRecord(record) : null;
}

export async function getExistingCageHealthNoteApiRecord(input: {
  cageId: string;
  createdById: string;
  noteType: HealthNoteType;
  severity: AlertSeverity;
  note: string;
  followupRequired: boolean;
  actionTaken?: string;
}, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const record = await prisma.healthNote.findFirst({
    where: {
      ...labScopedWhere(access),
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

  return now - record.createdAt.getTime() < 2 * 60 * 1000 && cageHealthNoteHasConsistentLab(record)
    ? formatCageHealthNoteApiRecord(record)
    : null;
}

export async function getExperimentAssignmentApiRecords(input: {
  experimentId: string;
  animalIds: string[];
}, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const records = await prisma.experimentAssignment.findMany({
    where: {
      experimentId: input.experimentId,
      animalId: { in: input.animalIds },
      status: { in: ["planned", "reserved", "active", "completed"] },
      ...(access.canViewAll
        ? {}
        : {
            experiment: { labId: { in: access.memberLabIds } },
            animal: { owningLabId: { in: access.memberLabIds } },
          }),
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: experimentAssignmentApiSelect,
  });

  return records
    .filter((record) => record.experiment.labId === record.animal.owningLabId)
    .map(formatExperimentAssignmentApiRecord);
}

export async function getExistingExperimentReservationApiRecord(input: {
  experimentId: string;
  animalId: string;
  startDate: string;
  treatmentGroup?: string;
}, actor: LabActor) {
  const startDate = new Date(input.startDate);

  if (Number.isNaN(startDate.getTime())) {
    return null;
  }

  const normalizedTreatmentGroup = input.treatmentGroup?.trim() || null;
  const access = await getActorLabAccess(actor);
  const record = await prisma.experimentAssignment.findFirst({
    where: {
      experimentId: input.experimentId,
      animalId: input.animalId,
      status: "reserved",
      startDate,
      treatmentGroup: normalizedTreatmentGroup,
      ...(access.canViewAll
        ? {}
        : {
            experiment: { labId: { in: access.memberLabIds } },
            animal: { owningLabId: { in: access.memberLabIds } },
          }),
    },
    select: experimentAssignmentApiSelect,
  });

  return record && record.experiment.labId === record.animal.owningLabId
    ? formatExperimentAssignmentApiRecord(record)
    : null;
}

export async function getExperimentAssignmentApiRecordById(assignmentId: string, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const record = await prisma.experimentAssignment.findFirst({
    where: {
      id: assignmentId,
      ...(access.canViewAll
        ? {}
        : {
            experiment: { labId: { in: access.memberLabIds } },
            animal: { owningLabId: { in: access.memberLabIds } },
          }),
    },
    select: experimentAssignmentApiSelect,
  });

  return record && record.experiment.labId === record.animal.owningLabId
    ? formatExperimentAssignmentApiRecord(record)
    : null;
}

export async function getExperimentAssignmentApiRecordsForExperiment(input: {
  experimentId: string;
  statuses?: AssignmentStatus[];
}, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const records = await prisma.experimentAssignment.findMany({
    where: {
      experimentId: input.experimentId,
      ...(input.statuses?.length ? { status: { in: input.statuses } } : {}),
      ...(access.canViewAll
        ? {}
        : {
            experiment: { labId: { in: access.memberLabIds } },
            animal: { owningLabId: { in: access.memberLabIds } },
          }),
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: experimentAssignmentApiSelect,
  });

  return records
    .filter((record) => record.experiment.labId === record.animal.owningLabId)
    .map(formatExperimentAssignmentApiRecord);
}

export async function getBreedingSetupApiRecordById(breedingSetupId: string, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const record = await prisma.breedingSetup.findFirst({
    where: { id: breedingSetupId, ...labScopedWhere(access) },
    select: breedingSetupApiSelect,
  });

  return record && breedingSetupHasConsistentLab(record) ? formatBreedingSetupApiRecord(record) : null;
}

export async function getExistingBreedingSetupApiRecord(input: {
  sireId: string;
  damId: string;
  startDate: string;
  targetGenotype: string;
  targetSex?: "male" | "female" | "unknown";
  notes?: string;
}, actor: LabActor) {
  const startDate = new Date(input.startDate);

  if (Number.isNaN(startDate.getTime())) {
    return null;
  }

  const normalizedTargetGenotype = input.targetGenotype.trim();
  const normalizedNotes = input.notes?.trim() || null;
  const normalizedTargetSex = input.targetSex && input.targetSex !== "unknown" ? input.targetSex : null;

  const access = await getActorLabAccess(actor);
  const record = await prisma.breedingSetup.findFirst({
    where: {
      ...labScopedWhere(access),
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

  return record && breedingSetupHasConsistentLab(record) ? formatBreedingSetupApiRecord(record) : null;
}

export async function getLitterApiRecordById(litterId: string, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const record = await prisma.litter.findFirst({
    where: {
      id: litterId,
      ...(access.canViewAll ? {} : { breedingSetup: { labId: { in: access.memberLabIds } } }),
    },
    select: litterApiSelect,
  });

  return record && litterHasConsistentLab(record) ? formatLitterApiRecord(record) : null;
}

export async function getExistingLitterApiRecord(input: {
  breedingSetupId: string;
  birthDate: string;
  litterSizeBirth: number;
  notes?: string;
}, actor: LabActor) {
  const birthDate = new Date(input.birthDate);

  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }

  const normalizedBirthKey = birthDate.toISOString().slice(0, 10);
  const normalizedNotes = input.notes?.trim() || null;

  const access = await getActorLabAccess(actor);
  const record = await prisma.litter.findFirst({
    where: {
      ...(access.canViewAll ? {} : { breedingSetup: { labId: { in: access.memberLabIds } } }),
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

  return record.birthDate.toISOString().slice(0, 10) === normalizedBirthKey && litterHasConsistentLab(record)
    ? formatLitterApiRecord(record)
    : null;
}

export async function getWeaningApiRecordByLitterId(litterId: string, actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const [record, auditLog] = await Promise.all([
    prisma.litter.findFirst({
      where: {
        id: litterId,
        ...(access.canViewAll ? {} : { breedingSetup: { labId: { in: access.memberLabIds } } }),
      },
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

  return record && weaningHasConsistentLab(record) ? formatWeaningApiRecord(record, auditLog?.newValue) : null;
}

export async function getExistingGenotypeApiRecord(input: {
  animalId: string;
  marker: string;
  status: GenotypeCallStatus;
  sampleDate: string;
  resultDate: string;
  finalCall: string;
  resultText: string;
}, actor: LabActor) {
  const sampleDate = new Date(input.sampleDate);
  const resultDate = new Date(input.resultDate);

  if (Number.isNaN(sampleDate.getTime()) || Number.isNaN(resultDate.getTime())) {
    return null;
  }

  const access = await getActorLabAccess(actor);
  const record = await prisma.genotypingRecord.findFirst({
    where: {
      ...labScopedWhere(access),
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

  return record && genotypeRecordHasConsistentLab(record) ? formatGenotypeApiRecord(record) : null;
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

export async function getRuleApiRecordById(ruleId: string, actor: LabActor) {
  void actor;
  const rules = await getRuleSummaryView();

  return rules.find((rule) => rule.id === ruleId) ?? null;
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
    description: "Animal summaries, detail records, intake, and terminal lifecycle sync. Euthanasia PATCH requests require an exact timezone-qualified happenedAt and the current approved sopAssignmentId assigned to the animal's lab.",
    methods: ["GET", "POST", "PATCH"],
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
    detailPath: "/api/v1/experiments/assignments/{assignmentId}",
    description: "External planned experiment assignment sync with audit provenance.",
    methods: ["POST", "PATCH", "DELETE"],
  },
  {
    name: "experiment-reservations",
    path: "/api/v1/experiments/reservations",
    description: "External direct experiment reservation intake with audit provenance.",
    methods: ["POST"],
  },
  {
    name: "procedures",
    path: "/api/v1/procedures",
    description: "Operational procedure plans with exact approved SOP-version references.",
    methods: ["GET", "POST"],
  },
  {
    name: "procedure-occurrences",
    path: "/api/v1/procedures/{procedureId}/occurrences",
    description: "Append-only procedure outcomes recorded by CMU or Facility operators.",
    methods: ["GET", "POST"],
  },
  {
    name: "projects",
    path: "/api/v1/projects",
    description: "Project ownership and allocation summaries plus external project catalog sync.",
    methods: ["GET", "POST", "PATCH"],
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
    name: "genotype-import",
    path: "/api/v1/genotypes/import",
    description: "External bulk genotype CSV import with audited row-by-row genotype recording.",
    methods: ["POST"],
  },
  {
    name: "rules",
    path: "/api/v1/rules",
    description: "Admin rule setting summaries plus audited rule config updates.",
    methods: ["GET", "PATCH"],
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

export function buildGenotypeImportApiSummary(input: {
  csvText: string;
  fileName?: string;
}) {
  const parsed = parseGenotypeImportCsv(input.csvText);

  return {
    fileName: input.fileName ?? null,
    parsedRowCount: parsed.rows.length,
    preflightErrorCount: parsed.errors.length,
    preflightErrors: parsed.errors.slice(0, 5),
  };
}

const sampleApiSelect = {
  id: true,
  labId: true,
  sampleLabel: true,
  sampleType: true,
  status: true,
  collectedAt: true,
  storageLocation: true,
  quantityLabel: true,
  notes: true,
  createdAt: true,
  version: true,
  animalId: true,
  animal: {
    select: {
      animalId: true,
      labId: true,
      owningLabId: true,
    },
  },
  project: {
    select: {
      projectCode: true,
      labId: true,
    },
  },
  experiment: {
    select: {
      id: true,
      experimentCode: true,
      labId: true,
    },
  },
} as const;

const cryostorageApiSelect = {
  id: true,
  labId: true,
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
      labId: true,
    },
  },
} as const;

const genotypeApiSelect = {
  id: true,
  labId: true,
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
      owningLabId: true,
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
  labId: true,
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
          owningLabId: true,
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
      labId: true,
      targetGenotype: true,
      status: true,
      adults: {
        orderBy: [{ role: "asc" }, { id: "asc" }],
        select: {
          role: true,
          animal: {
            select: {
              animalId: true,
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
      labId: true,
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
          owningLabId: true,
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
  labId: true,
  animalId: true,
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
  version: true,
  animal: {
    select: {
      animalId: true,
      labId: true,
      owningLabId: true,
    },
  },
  experiment: {
    select: {
      experimentCode: true,
      title: true,
      labId: true,
      version: true,
    },
  },
} as const;

function sampleRecordHasConsistentLab(record: {
  labId: string;
  project: { labId: string } | null;
  experiment: { labId: string } | null;
}) {
  return (!record.project || record.project.labId === record.labId) &&
    (!record.experiment || record.experiment.labId === record.labId);
}

function cryostorageRecordHasConsistentLab(record: { labId: string; project: { labId: string } | null }) {
  return !record.project || record.project.labId === record.labId;
}

function genotypeRecordHasConsistentLab(record: { labId: string; animal: { owningLabId: string } }) {
  return record.animal.owningLabId === record.labId;
}

function cageHealthNoteHasConsistentLab(record: { labId: string; cage: { labId: string } | null }) {
  return !record.cage || record.cage.labId === record.labId;
}

function breedingSetupHasConsistentLab(record: {
  labId: string;
  adults: Array<{ animal: { owningLabId: string } }>;
}) {
  return record.adults.every((adult) => adult.animal.owningLabId === record.labId);
}

function litterHasConsistentLab(record: {
  breedingSetup: { labId: string; adults: Array<{ animal: { owningLabId: string } }> };
}) {
  return record.breedingSetup.adults.every(
    (adult) => adult.animal.owningLabId === record.breedingSetup.labId,
  );
}

function weaningHasConsistentLab(record: {
  breedingSetup: { labId: string };
  litterAnimals: Array<{ animal: { owningLabId: string } }>;
}) {
  return record.litterAnimals.every(
    (entry) => entry.animal.owningLabId === record.breedingSetup.labId,
  );
}

function formatSampleApiRecord(record: {
  id: string;
  labId: string;
  sampleLabel: string;
  sampleType: string;
  status: SampleStatus;
  collectedAt: Date;
  storageLocation: string | null;
  quantityLabel: string | null;
  notes: string | null;
  createdAt: Date;
  version: number;
  animalId: string;
  animal: {
    animalId: string;
    labId: string;
    owningLabId: string;
  };
  project: {
    projectCode: string;
    labId: string;
  } | null;
  experiment: {
    id: string;
    experimentCode: string;
    labId: string;
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
    version: record.version,
    animalId: record.animalId,
    animalCode: record.animal.animalId,
    labId: record.labId,
    animalLabId: record.animal.labId,
    projectCode: record.project?.projectCode ?? null,
    experimentId: record.experiment?.id ?? null,
    experimentCode: record.experiment?.experimentCode ?? null,
  };
}

function formatCryostorageApiRecord(record: {
  id: string;
  labId: string;
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
    labId: string;
  } | null;
}) {
  return {
    id: record.id,
    labId: record.labId,
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
  version: number;
  animal: {
    animalId: string;
    labId: string;
    owningLabId: string;
  };
  experiment: {
    experimentCode: string;
    title: string;
    labId: string;
    version: number;
  };
}) {
  return {
    id: record.id,
    experimentId: record.experimentId,
    experimentCode: record.experiment.experimentCode,
    experimentTitle: record.experiment.title,
    experimentVersion: record.experiment.version,
    animalId: record.animalId,
    animalCode: record.animal.animalId,
    labId: record.experiment.labId,
    animalLabId: record.animal.labId,
    status: record.status,
    startDate: record.startDate.toISOString(),
    endDate: record.endDate?.toISOString() ?? null,
    treatmentGroup: record.treatmentGroup,
    notes: record.notes,
    isPrimary: record.isPrimary,
    version: record.version,
  };
}

function formatBreedingSetupApiRecord(record: {
  id: string;
  labId: string;
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
      owningLabId: string;
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
    labId: record.labId,
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
    labId: string;
    targetGenotype: string;
    status: string;
    adults: Array<{
      role: string;
      animal: {
        animalId: string;
        owningLabId: string;
      };
    }>;
  };
  litterAnimals: Array<{ id: string }>;
}) {
  return {
    id: record.id,
    labId: record.breedingSetup.labId,
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
      labId: string;
      targetGenotype: string;
      status: string;
    };
    litterAnimals: Array<{
      animal: {
        id: string;
        animalId: string;
        owningLabId: string;
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
    labId: record.breedingSetup.labId,
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
  labId: string;
  animalId: string | null;
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
    labId: string;
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
    labId: record.labId,
    animalId: record.animalId,
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
  labId: string;
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
    owningLabId: string;
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
    labId: record.labId,
    animalLabId: record.animal.labId,
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
