import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getActorReadLabAccess, type LabActor } from "@/lib/lab-access";
import type { CryostorageInventoryItem, CryostorageRequestItem } from "@/lib/types";

export const CRYOSTORAGE_INVENTORY_DEFAULT_PAGE_SIZE = 80;
export const CRYOSTORAGE_INVENTORY_MAX_PAGE_SIZE = 100;

const cryostorageInventoryStatuses = ["stored", "reserved", "recovered", "depleted", "discarded"] as const;

export type CryostorageInventoryStatus = (typeof cryostorageInventoryStatuses)[number];

export type CryostorageInventoryQuery = {
  search: string;
  status: "all" | CryostorageInventoryStatus;
  strainId: string;
  page: number;
  pageSize: number;
};

export type CryostorageInventoryPageView = {
  items: CryostorageInventoryItem[];
  totalCount: number;
  page: number;
  pageCount: number;
  pageSize: number;
  query: CryostorageInventoryQuery;
  strainOptions: Array<{ id: string; label: string }>;
};

export type CryostorageRequestTarget = Pick<
  CryostorageInventoryItem,
  "id" | "labId" | "sampleLabel" | "materialType" | "status"
>;

type RawCryostorageInventoryQuery = Record<string, string | string[] | undefined>;

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function boundedPositiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function normalizeCryostorageInventoryQuery(
  query: RawCryostorageInventoryQuery = {},
): CryostorageInventoryQuery {
  const requestedStatus = firstQueryValue(query.status);
  const status = cryostorageInventoryStatuses.includes(requestedStatus as CryostorageInventoryStatus)
    ? requestedStatus as CryostorageInventoryStatus
    : "all";

  return {
    search: (firstQueryValue(query.search) ?? "").trim().slice(0, 120),
    status,
    strainId: (firstQueryValue(query.strainId) ?? "all").trim().slice(0, 120) || "all",
    page: boundedPositiveInteger(firstQueryValue(query.page), 1, 100_000),
    pageSize: boundedPositiveInteger(
      firstQueryValue(query.pageSize),
      CRYOSTORAGE_INVENTORY_DEFAULT_PAGE_SIZE,
      CRYOSTORAGE_INVENTORY_MAX_PAGE_SIZE,
    ),
  };
}

export async function getCryostoragePageOptions(actor: LabActor) {
  const access = await getActorReadLabAccess(actor);
  const [labs, strains, projects] = await prisma.$transaction([
    prisma.lab.findMany({
      where: {
        active: true,
        ...(access.canViewAll ? {} : { id: { in: access.manageableLabIds } }),
      },
      orderBy: [{ name: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    prisma.strain.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.project.findMany({
      where: access.canViewAll ? {} : { labId: { in: access.memberLabIds } },
      orderBy: { projectCode: "asc" },
      select: {
        id: true,
        labId: true,
        projectCode: true,
        title: true,
      },
    }),
  ]);

  return {
    labOptions: labs.map((lab) => ({ id: lab.id, label: `${lab.code} · ${lab.name}` })),
    strainOptions: strains.map((strain) => ({
      id: strain.id,
      label: strain.name,
    })),
    projectOptions: projects.map((project) => ({
      id: project.id,
      labId: project.labId,
      label: `${project.projectCode} · ${project.title}`,
    })),
  };
}

function buildCryostorageInventoryWhere(
  access: Awaited<ReturnType<typeof getActorReadLabAccess>>,
  query?: Pick<CryostorageInventoryQuery, "search" | "status" | "strainId">,
): Prisma.CryostorageRecordWhereInput {
  const search = query?.search.trim() ?? "";

  return {
    ...(access.canViewAll ? {} : { labId: { in: access.memberLabIds } }),
    ...(query?.status && query.status !== "all" ? { status: query.status } : {}),
    ...(query?.strainId && query.strainId !== "all" ? { strainId: query.strainId } : {}),
    ...(search
      ? {
          OR: [
            { sampleLabel: { contains: search, mode: "insensitive" } },
            { materialType: { contains: search, mode: "insensitive" } },
            { strain: { name: { contains: search, mode: "insensitive" } } },
            { project: { projectCode: { contains: search, mode: "insensitive" } } },
            { lab: { name: { contains: search, mode: "insensitive" } } },
            { lab: { code: { contains: search, mode: "insensitive" } } },
            { storageLocation: { contains: search, mode: "insensitive" } },
            { quantityLabel: { contains: search, mode: "insensitive" } },
            { recoveryNotes: { contains: search, mode: "insensitive" } },
            { notes: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

type CryostorageInventoryListOptions = {
  where?: Prisma.CryostorageRecordWhereInput;
  skip?: number;
  take?: number;
};

async function getCryostorageInventoryItems(
  actor: LabActor,
  options: CryostorageInventoryListOptions = {},
  accessContext?: Awaited<ReturnType<typeof getActorReadLabAccess>>,
): Promise<CryostorageInventoryItem[]> {
  const access = accessContext ?? await getActorReadLabAccess(actor);
  const records = await prisma.cryostorageRecord.findMany({
    where: options.where ?? buildCryostorageInventoryWhere(access),
    orderBy: [{ storedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    ...(options.skip ? { skip: options.skip } : {}),
    ...(options.take ? { take: options.take } : {}),
    select: {
      id: true,
      labId: true,
      lab: { select: { code: true, name: true } },
      sampleLabel: true,
      materialType: true,
      status: true,
      storedAt: true,
      storageLocation: true,
      quantityLabel: true,
      recoveryNotes: true,
      notes: true,
      version: true,
      strain: {
        select: {
          id: true,
          name: true,
        },
      },
      project: {
        select: {
          projectCode: true,
          labId: true,
        },
      },
    },
  });

  return records
    .filter((record) => !record.project || record.labId === record.project.labId)
    .map((record) => ({
    id: record.id,
    labId: record.labId,
    labLabel: `${record.lab.code} · ${record.lab.name}`,
    sampleLabel: record.sampleLabel,
    materialType: record.materialType,
    status: record.status,
    storedAt: record.storedAt.toISOString(),
    strainId: record.strain.id,
    strainName: record.strain.name,
    projectCode: record.project?.projectCode ?? null,
    storageLocation: record.storageLocation ?? null,
    quantityLabel: record.quantityLabel ?? null,
    recoveryNotes: record.recoveryNotes ?? null,
    notes: record.notes ?? null,
    version: record.version,
    }));
}

export async function getCryostorageInventoryView(actor: LabActor): Promise<CryostorageInventoryItem[]> {
  return getCryostorageInventoryItems(actor);
}

export async function getCryostorageInventoryPageView(
  actor: LabActor,
  rawQuery: RawCryostorageInventoryQuery = {},
): Promise<CryostorageInventoryPageView> {
  const query = normalizeCryostorageInventoryQuery(rawQuery);
  const access = await getActorReadLabAccess(actor);
  const where = buildCryostorageInventoryWhere(access, query);
  const scopeWhere = buildCryostorageInventoryWhere(access);
  const skip = (query.page - 1) * query.pageSize;
  const [totalCount, items, strainRows] = await Promise.all([
    prisma.cryostorageRecord.count({ where }),
    getCryostorageInventoryItems(actor, { where, skip, take: query.pageSize }, access),
    prisma.cryostorageRecord.findMany({
      where: scopeWhere,
      distinct: ["strainId"],
      orderBy: { strain: { name: "asc" } },
      select: { strain: { select: { id: true, name: true } } },
    }),
  ]);

  return {
    items,
    totalCount,
    page: query.page,
    pageCount: Math.max(1, Math.ceil(totalCount / query.pageSize)),
    pageSize: query.pageSize,
    query,
    strainOptions: strainRows.map((row) => ({ id: row.strain.id, label: row.strain.name })),
  };
}

export async function getCryostorageRequestTargets(actor: LabActor): Promise<CryostorageRequestTarget[]> {
  const access = await getActorReadLabAccess(actor);
  return prisma.cryostorageRecord.findMany({
    where: {
      ...buildCryostorageInventoryWhere(access),
      status: { in: ["stored", "reserved", "recovered"] },
    },
    orderBy: [{ sampleLabel: "asc" }, { id: "asc" }],
    select: {
      id: true,
      labId: true,
      sampleLabel: true,
      materialType: true,
      status: true,
    },
  });
}

export async function getCryostorageRequestView(actor: LabActor): Promise<CryostorageRequestItem[]> {
  const access = await getActorReadLabAccess(actor);
  const requests = await prisma.cryostorageRequest.findMany({
    where: access.canViewAll ? {} : { labId: { in: access.memberLabIds } },
    orderBy: [{ status: "asc" }, { requestedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      labId: true,
      requestType: true,
      status: true,
      version: true,
      requestedFor: true,
      requestedAt: true,
      requestedById: true,
      targetRecordId: true,
      targetRecordVersion: true,
      sampleLabel: true,
      materialType: true,
      requestedQuantityLabel: true,
      requestedStorageLocation: true,
      notes: true,
      decidedAt: true,
      decisionReason: true,
      lab: { select: { code: true, name: true } },
      requestedBy: { select: { name: true, email: true } },
      decidedBy: { select: { name: true, email: true } },
      strain: { select: { name: true } },
      project: { select: { projectCode: true, labId: true } },
      targetRecord: { select: { sampleLabel: true, status: true, labId: true } },
      operation: {
        select: {
          recordId: true,
          previousStatus: true,
          resultingStatus: true,
          performedAt: true,
          storageLocation: true,
          quantityLabel: true,
          notes: true,
        },
      },
    },
  });

  return requests
    .filter((request) => (
      (!request.project || request.project.labId === request.labId)
      && (!request.targetRecord || request.targetRecord.labId === request.labId)
    ))
    .map((request) => ({
      id: request.id,
      labId: request.labId,
      labLabel: `${request.lab.code} · ${request.lab.name}`,
      requestType: request.requestType,
      status: request.status,
      version: request.version,
      requestedFor: request.requestedFor.toISOString(),
      requestedAt: request.requestedAt.toISOString(),
      requestedById: request.requestedById,
      requestedByLabel: request.requestedBy.name || request.requestedBy.email,
      targetRecordId: request.targetRecordId,
      targetRecordVersion: request.targetRecordVersion,
      targetRecordLabel: request.targetRecord?.sampleLabel ?? null,
      targetRecordStatus: request.targetRecord?.status ?? null,
      strainName: request.strain?.name ?? null,
      projectCode: request.project?.projectCode ?? null,
      sampleLabel: request.sampleLabel,
      materialType: request.materialType,
      requestedQuantityLabel: request.requestedQuantityLabel,
      requestedStorageLocation: request.requestedStorageLocation,
      notes: request.notes,
      decidedAt: request.decidedAt?.toISOString() ?? null,
      decidedByLabel: request.decidedBy ? request.decidedBy.name || request.decidedBy.email : null,
      decisionReason: request.decisionReason,
      operation: request.operation
        ? {
            ...request.operation,
            performedAt: request.operation.performedAt.toISOString(),
          }
        : null,
    }));
}
