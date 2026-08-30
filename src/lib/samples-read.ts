import { Prisma } from "@prisma/client";

import { correctedNullableString, correctedString, correctionMarker, getAppliedCorrectionProjectionMap } from "@/lib/correction-read";
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
  orderedIds?: string[];
};

function effectiveSampleConditions(
  access: Awaited<ReturnType<typeof getActorReadLabAccess>>,
  query: SampleInventoryQuery,
) {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`(sample."projectId" IS NULL OR project."labId" = sample."labId")`,
    Prisma.sql`(sample."experimentId" IS NULL OR experiment."labId" = sample."labId")`,
  ];
  if (!access.canViewAll) {
    conditions.push(access.memberLabIds.length
      ? Prisma.sql`sample."labId" IN (${Prisma.join(access.memberLabIds)})`
      : Prisma.sql`FALSE`);
  }
  if (query.status !== "all") conditions.push(Prisma.sql`sample.status::text = ${query.status}`);
  if (query.sampleType !== "all") conditions.push(Prisma.sql`sample."sampleType" = ${query.sampleType}`);
  if (query.experimentId === "none") conditions.push(Prisma.sql`sample."experimentId" IS NULL`);
  else if (query.experimentId !== "all") conditions.push(Prisma.sql`sample."experimentId" = ${query.experimentId}`);
  if (query.search) {
    const pattern = `%${query.search}%`;
    conditions.push(Prisma.sql`(
      sample."sampleLabel" ILIKE ${pattern}
      OR sample."sampleType" ILIKE ${pattern}
      OR animal."animalId" ILIKE ${pattern}
      OR animal."labId" ILIKE ${pattern}
      OR project."projectCode" ILIKE ${pattern}
      OR experiment."experimentCode" ILIKE ${pattern}
      OR sample."storageLocation" ILIKE ${pattern}
      OR sample."quantityLabel" ILIKE ${pattern}
      OR (CASE WHEN correction_request.id IS NOT NULL AND correction_request."proposedCorrection" ? 'notes'
          THEN correction."effectiveProjection" ->> 'notes' ELSE sample.notes END) ILIKE ${pattern}
    )`);
  }
  return Prisma.join(conditions, " AND ");
}

function effectiveSampleFromSql() {
  return Prisma.sql`
    FROM "SampleRecord" sample
    JOIN "Animal" animal ON animal.id = sample."animalId"
    LEFT JOIN "Project" project ON project.id = sample."projectId"
    LEFT JOIN "Experiment" experiment ON experiment.id = sample."experimentId"
    LEFT JOIN "CorrectionSupersession" correction
      ON correction.domain = 'biosample'::"CorrectionDomain"
      AND correction."targetEntityId" = sample.id
      AND correction."labId" = sample."labId"
    LEFT JOIN "CorrectionRequest" correction_request
      ON correction_request.id = correction."requestId"
      AND correction_request.status = 'applied'::"CorrectionRequestStatus"
  `;
}

async function getEffectiveSamplePageSelection(
  access: Awaited<ReturnType<typeof getActorReadLabAccess>>,
  query: SampleInventoryQuery,
) {
  const where = effectiveSampleConditions(access, query);
  const from = effectiveSampleFromSql();
  const offset = (query.page - 1) * query.pageSize;
  const [countRows, idRows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count ${from} WHERE ${where}
    `),
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT sample.id ${from}
      WHERE ${where}
      ORDER BY
        (CASE WHEN correction_request.id IS NOT NULL
          AND correction_request."proposedCorrection" ? 'collectedAt'
          THEN (correction."effectiveProjection" ->> 'collectedAt')::timestamptz
          ELSE sample."collectedAt" END) DESC,
        sample."createdAt" DESC,
        sample.id ASC
      LIMIT ${query.pageSize} OFFSET ${offset}
    `),
  ]);
  return { totalCount: Number(countRows[0]?.count ?? 0), ids: idRows.map((row) => row.id) };
}

async function getSampleInventoryItems(
  actor: LabActor,
  options: SampleInventoryListOptions = {},
  accessContext?: Awaited<ReturnType<typeof getActorReadLabAccess>>,
): Promise<SampleInventoryItem[]> {
  const access = accessContext ?? await getActorReadLabAccess(actor);
  const records = await prisma.sampleRecord.findMany({
    where: options.where ?? buildSampleInventoryWhere(access),
    orderBy: [{ collectedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
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
      createdAt: true,
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
  const corrections = await getAppliedCorrectionProjectionMap(
    "biosample",
    records.map((record) => ({ id: record.id, labIds: [record.labId] })),
  );

  const projected = records
    .filter(
      (record) =>
        (!record.project || record.labId === record.project.labId) &&
        (!record.experiment || record.labId === record.experiment.labId),
    )
    .map((record) => {
    const correction = corrections.get(record.id);
    return {
    id: record.id,
    sampleLabel: record.sampleLabel,
    sampleType: record.sampleType,
    status: record.status,
    collectedAt: correctedString(correction, "collectedAt", record.collectedAt.toISOString()),
    animalId: record.animal.id,
    animalCode: record.animal.animalId,
    animalLabCode: record.animal.labId,
    labId: record.labId,
    projectCode: record.project?.projectCode ?? null,
    experimentId: record.experiment?.id ?? null,
    experimentCode: record.experiment?.experimentCode ?? null,
    storageLocation: record.storageLocation ?? null,
    quantityLabel: record.quantityLabel ?? null,
    notes: correctedNullableString(correction, "notes", record.notes),
    version: record.version,
    correction: correctionMarker(correction),
    };
    });
  if (options.orderedIds) {
    const order = new Map(options.orderedIds.map((id, index) => [id, index]));
    return projected.sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));
  }
  const createdAtById = new Map(records.map((record) => [record.id, record.createdAt?.getTime() ?? 0]));
  return projected.sort((left, right) => {
    const byCollectedAt = new Date(right.collectedAt).getTime() - new Date(left.collectedAt).getTime();
    if (byCollectedAt) return byCollectedAt;
    const leftCreated = createdAtById.get(left.id) ?? 0;
    const rightCreated = createdAtById.get(right.id) ?? 0;
    return rightCreated - leftCreated || left.id.localeCompare(right.id);
  });
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
  const scopeWhere = buildSampleInventoryWhere(access);
  const [selection, typeRows] = await Promise.all([
    getEffectiveSamplePageSelection(access, query),
    prisma.sampleRecord.findMany({
      where: scopeWhere,
      distinct: ["sampleType"],
      orderBy: { sampleType: "asc" },
      select: { sampleType: true },
    }),
  ]);
  const items = selection.ids.length
    ? await getSampleInventoryItems(actor, { where: { id: { in: selection.ids } }, orderedIds: selection.ids }, access)
    : [];
  const totalCount = selection.totalCount;

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
