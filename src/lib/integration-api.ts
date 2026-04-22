import { getAnimalDetailView, getAnimalListView } from "@/lib/animals-read";
import { getCageDetailView, getCageListView } from "@/lib/cages-read";
import { getExperimentOverviewView } from "@/lib/experiments-read";
import { prisma } from "@/lib/prisma";

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

export async function getAnimalApiDetail(animalId: string) {
  return getAnimalDetailView(animalId);
}

export async function getCageApiDetail(cageId: string) {
  return getCageDetailView(cageId);
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
    description: "Experiment overview with assignment provenance.",
  },
  {
    name: "projects",
    path: "/api/v1/projects",
    description: "Project ownership and allocation summaries.",
  },
  {
    name: "exports",
    path: "/api/v1/exports",
    description: "Discover the available operational CSV exports.",
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
