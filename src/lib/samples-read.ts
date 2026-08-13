import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getActorReadLabAccess, type LabActor } from "@/lib/lab-access";
import type { SampleInventoryItem } from "@/lib/types";

export const SAMPLE_INVENTORY_DEFAULT_PAGE_SIZE = 80;
export const SAMPLE_INVENTORY_MAX_PAGE_SIZE = 100;

const sampleInventoryStatuses = ["collected", "stored", "allocated", "consumed", "discarded"] as const;

export type SampleInventoryStatus = (typeof sampleInventoryStatuses)[number];

export type SampleInventoryQuery = {
  search: string;
  status: "all" | SampleInventoryStatus;
  sampleType: string;
  experimentId: string;
  page: number;
  pageSize: number;
};

export type SampleInventoryPageView = {
  items: SampleInventoryItem[];
  totalCount: number;
  page: number;
  pageCount: number;
  pageSize: number;
  query: SampleInventoryQuery;
  sampleTypes: string[];
};

type RawSampleInventoryQuery = Record<string, string | string[] | undefined>;

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function boundedPositiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function normalizeSampleInventoryQuery(query: RawSampleInventoryQuery = {}): SampleInventoryQuery {
  const requestedStatus = firstQueryValue(query.status);
  const status = sampleInventoryStatuses.includes(requestedStatus as SampleInventoryStatus)
    ? requestedStatus as SampleInventoryStatus
    : "all";

  return {
    search: (firstQueryValue(query.search) ?? "").trim().slice(0, 120),
    status,
    sampleType: (firstQueryValue(query.sampleType) ?? "all").trim().slice(0, 80) || "all",
    experimentId: (firstQueryValue(query.experimentId) ?? "all").trim().slice(0, 120) || "all",
    page: boundedPositiveInteger(firstQueryValue(query.page), 1, 100_000),
    pageSize: boundedPositiveInteger(
      firstQueryValue(query.pageSize),
      SAMPLE_INVENTORY_DEFAULT_PAGE_SIZE,
      SAMPLE_INVENTORY_MAX_PAGE_SIZE,
    ),
  };
}

function formatAnimalOptionLabel(animal: { animalId: string; labId: string; status: string }) {
  return `${animal.animalId} · ${animal.labId} · ${animal.status.replaceAll("_", " ")}`;
}

function mapExperimentOption(experiment: {
  id: string;
  experimentCode: string;
  title: string;
  projectId: string;
  status: string;
}) {
  return {
    id: experiment.id,
    label: `${experiment.experimentCode} · ${experiment.title}`,
    projectId: experiment.projectId,
    status: experiment.status,
  };
}

export async function getSampleInventoryFilterOptions(actor: LabActor) {
  const access = await getActorReadLabAccess(actor);
  const experiments = await prisma.experiment.findMany({
    where: access.canViewAll ? {} : { labId: { in: access.memberLabIds } },
    orderBy: { experimentCode: "asc" },
    select: {
      id: true,
      experimentCode: true,
      title: true,
      projectId: true,
      status: true,
    },
  });

  return { experimentOptions: experiments.map(mapExperimentOption) };
}

export async function getSamplePageOptions(actor: LabActor) {
  const access = await getActorReadLabAccess(actor);
  const labWhere = access.canViewAll ? {} : { labId: { in: access.memberLabIds } };
  const animalWhere = access.canViewAll ? {} : { owningLabId: { in: access.memberLabIds } };
  const [animals, projects, experiments] = await prisma.$transaction([
    prisma.animal.findMany({
      where: animalWhere,
      orderBy: [{ animalId: "asc" }],
      select: {
        id: true,
        animalId: true,
        labId: true,
        status: true,
      },
    }),
    prisma.project.findMany({
      where: labWhere,
      orderBy: { projectCode: "asc" },
      select: {
        id: true,
        projectCode: true,
        title: true,
      },
    }),
    prisma.experiment.findMany({
      where: labWhere,
      orderBy: { experimentCode: "asc" },
      select: {
        id: true,
        experimentCode: true,
        title: true,
        projectId: true,
        status: true,
      },
    }),
  ]);

  return {
    animalOptions: animals.map((animal) => ({
      id: animal.id,
      label: formatAnimalOptionLabel(animal),
    })),
    projectOptions: projects.map((project) => ({
      id: project.id,
      label: `${project.projectCode} · ${project.title}`,
    })),
    experimentOptions: experiments.map(mapExperimentOption),
    activeExperimentOptions: experiments
      .filter((experiment) => experiment.status === "planned" || experiment.status === "active")
      .map(mapExperimentOption),
  };
}

function buildSampleInventoryWhere(
  access: Awaited<ReturnType<typeof getActorReadLabAccess>>,
  query?: Pick<SampleInventoryQuery, "search" | "status" | "sampleType" | "experimentId">,
): Prisma.SampleRecordWhereInput {
  const search = query?.search.trim() ?? "";

  return {
    ...(access.canViewAll ? {} : { labId: { in: access.memberLabIds } }),
    ...(query?.status && query.status !== "all" ? { status: query.status } : {}),
    ...(query?.sampleType && query.sampleType !== "all" ? { sampleType: query.sampleType } : {}),
    ...(query?.experimentId && query.experimentId !== "all"
      ? query.experimentId === "none"
        ? { experimentId: null }
        : { experimentId: query.experimentId }
      : {}),
    ...(search
      ? {
          OR: [
            { sampleLabel: { contains: search, mode: "insensitive" } },
            { sampleType: { contains: search, mode: "insensitive" } },
            { animal: { animalId: { contains: search, mode: "insensitive" } } },
            { animal: { labId: { contains: search, mode: "insensitive" } } },
            { project: { projectCode: { contains: search, mode: "insensitive" } } },
            { experiment: { experimentCode: { contains: search, mode: "insensitive" } } },
            { storageLocation: { contains: search, mode: "insensitive" } },
            { quantityLabel: { contains: search, mode: "insensitive" } },
            { notes: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

type SampleInventoryListOptions = {
  where?: Prisma.SampleRecordWhereInput;
  skip?: number;
  take?: number;
};

async function getSampleInventoryItems(
  actor: LabActor,
  options: SampleInventoryListOptions = {},
  accessContext?: Awaited<ReturnType<typeof getActorReadLabAccess>>,
): Promise<SampleInventoryItem[]> {
  const access = accessContext ?? await getActorReadLabAccess(actor);
  const records = await prisma.sampleRecord.findMany({
    where: options.where ?? buildSampleInventoryWhere(access),
    orderBy: [{ collectedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    ...(options.skip ? { skip: options.skip } : {}),
    ...(options.take ? { take: options.take } : {}),
    select: {
      id: true,
      labId: true,
      sampleLabel: true,
      sampleType: true,
      status: true,
      collectedAt: true,
      storageLocation: true,
      quantityLabel: true,
      notes: true,
      version: true,
      animal: {
        select: {
          id: true,
          animalId: true,
          labId: true,
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
    },
  });

  return records
    .filter(
      (record) =>
        (!record.project || record.labId === record.project.labId) &&
        (!record.experiment || record.labId === record.experiment.labId),
    )
    .map((record) => ({
    id: record.id,
    sampleLabel: record.sampleLabel,
    sampleType: record.sampleType,
    status: record.status,
    collectedAt: record.collectedAt.toISOString(),
    animalId: record.animal.id,
    animalCode: record.animal.animalId,
    animalLabCode: record.animal.labId,
    labId: record.labId,
    projectCode: record.project?.projectCode ?? null,
    experimentId: record.experiment?.id ?? null,
    experimentCode: record.experiment?.experimentCode ?? null,
    storageLocation: record.storageLocation ?? null,
    quantityLabel: record.quantityLabel ?? null,
    notes: record.notes ?? null,
    version: record.version,
    }));
}

export async function getSampleInventoryView(actor: LabActor): Promise<SampleInventoryItem[]> {
  return getSampleInventoryItems(actor);
}

export async function getSampleInventoryPageView(
  actor: LabActor,
  rawQuery: RawSampleInventoryQuery = {},
): Promise<SampleInventoryPageView> {
  const query = normalizeSampleInventoryQuery(rawQuery);
  const access = await getActorReadLabAccess(actor);
  const where = buildSampleInventoryWhere(access, query);
  const scopeWhere = buildSampleInventoryWhere(access);
  const skip = (query.page - 1) * query.pageSize;
  const [totalCount, items, typeRows] = await Promise.all([
    prisma.sampleRecord.count({ where }),
    getSampleInventoryItems(actor, { where, skip, take: query.pageSize }, access),
    prisma.sampleRecord.findMany({
      where: scopeWhere,
      distinct: ["sampleType"],
      orderBy: { sampleType: "asc" },
      select: { sampleType: true },
    }),
  ]);

  return {
    items,
    totalCount,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(totalCount / query.pageSize)),
    pageSize: query.pageSize,
    query,
    sampleTypes: typeRows.map((row) => row.sampleType),
  };
}
