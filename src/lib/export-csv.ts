import type { Prisma } from "@prisma/client";

import { getAnimalApiList, getCageApiList } from "@/lib/integration-api";
import { getActorLabAccess, type LabActor } from "@/lib/lab-access";
import { prisma } from "@/lib/prisma";
import type { AnimalListItem, CageListItem } from "@/lib/types";
import { formatDate } from "@/lib/utils";

type ExportEntity = "animals" | "cages" | "alerts" | "experiments" | "audit" | "security";
type CsvRow = Record<string, string | number>;

export type CsvExportFilters = {
  search?: string;
  status?: string;
  availableOnly?: boolean;
  warningsOnly?: boolean;
  outcome?: string;
  from?: string;
  to?: string;
};

const PRIVILEGED_EXPORT_MAX_ROWS = 50_000;
const PRIVILEGED_EXPORT_MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;

export class CsvExportRangeError extends Error {}
export class CsvExportLimitError extends Error {}

function formatDateCell(value?: Date | null) {
  return value ? formatDate(value) : "";
}

export function escapeCsvCell(value: unknown) {
  let text = String(value ?? "");
  if (typeof value === "string" && /^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(rows: CsvRow[]) {
  if (!rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(","))].join("\n");
}

export function validatePrivilegedExportRange(filters: CsvExportFilters) {
  if (!filters.from || !filters.to) {
    throw new CsvExportRangeError("Audit and security exports require explicit from and to timestamps.");
  }
  const from = new Date(filters.from);
  const to = new Date(filters.to);
  if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf()) || from > to) {
    throw new CsvExportRangeError("Export timestamps are invalid.");
  }
  if (to.getTime() - from.getTime() > PRIVILEGED_EXPORT_MAX_WINDOW_MS) {
    throw new CsvExportRangeError("Audit and security exports are limited to a 31-day window.");
  }
  return { from, to };
}

export function assertPrivilegedExportRowCount(total: number) {
  if (total > PRIVILEGED_EXPORT_MAX_ROWS) {
    throw new CsvExportLimitError(`Export contains ${total} rows. Narrow the date range below ${PRIVILEGED_EXPORT_MAX_ROWS + 1} rows.`);
  }
}

function normalizeSearch(search?: string) {
  return search?.trim().toLowerCase() ?? "";
}

function filterAnimals(animals: AnimalListItem[], filters: CsvExportFilters) {
  const search = normalizeSearch(filters.search);

  return animals.filter((animal) => {
    const haystack = [animal.animalId, animal.labId, animal.strain, animal.genotypeSummary, animal.cageLabel]
      .join(" ")
      .toLowerCase();
    const matchesSearch = search ? haystack.includes(search) : true;
    const matchesStatus = filters.status && filters.status !== "all" ? animal.status === filters.status : true;
    const matchesAvailability = filters.availableOnly ? animal.availableForExperiment : true;

    return matchesSearch && matchesStatus && matchesAvailability;
  });
}

function filterCages(cages: CageListItem[], filters: CsvExportFilters) {
  const search = normalizeSearch(filters.search);

  return cages.filter((cage) => {
    const haystack = [
      cage.roomNumber,
      cage.rackNumber,
      cage.cageNumber,
      cage.barcode,
      cage.labName ?? "",
      cage.labCode ?? "",
      cage.animalIdentifiers.join(" "),
      cage.animalLabIdentifiers.join(" "),
      cage.sexComposition,
      cage.strainSummary,
      cage.projectSummary,
      cage.chargeCategoryName ?? "",
      cage.chargeState,
    ]
      .join(" ")
      .toLowerCase();
    const matchesSearch = search ? haystack.includes(search) : true;
    const matchesStatus = filters.status && filters.status !== "all" ? cage.status === filters.status : true;
    const matchesWarnings = filters.warningsOnly ? cage.warningCount > 0 : true;

    return matchesSearch && matchesStatus && matchesWarnings;
  });
}

async function buildAnimalExportRows(filters: CsvExportFilters, actor: LabActor) {
  const result = await getAnimalApiList({
    search: "",
    status: "all",
    sex: "all",
    strain: "",
    projectCode: "",
    availableOnly: false,
    warningsOnly: false,
    limit: 500,
  }, actor);
  const animals = filterAnimals(result.data, filters);

  return animals.map<CsvRow>((animal) => ({
    animalId: animal.animalId,
    labId: animal.labId,
    sex: animal.sex,
    age: animal.ageLabel,
    strain: animal.strain,
    genotype: animal.genotypeSummary,
    cage: animal.cageLabel,
    status: animal.status,
    projects: animal.projectCodes.join("; "),
    warnings: animal.warnings.join(" | "),
  }));
}

async function buildCageExportRows(filters: CsvExportFilters, actor: LabActor) {
  const result = await getCageApiList({
    search: "",
    status: "all",
    room: "",
    rack: "",
    warningsOnly: false,
    limit: 500,
  }, actor);
  const cages = filterCages(result.data, filters);

  return cages.map<CsvRow>((cage) => ({
    cage: cage.cageNumber,
    room: cage.roomNumber,
    rack: cage.rackNumber,
    barcode: cage.barcode,
    lab: cage.labName ?? "",
    status: cage.status,
    chargeCategory: cage.chargeCategoryName ?? "",
    dailyRateCents: cage.dailyRateCents ?? "",
    chargeState: cage.chargeState,
    occupants: cage.occupantCount,
    animalIds: cage.animalIdentifiers.join("; "),
    animalLabIds: cage.animalLabIdentifiers.join("; "),
    sexComposition: cage.sexComposition,
    strainSummary: cage.strainSummary,
    projects: cage.projectSummary,
    warningCount: cage.warningCount,
  }));
}

async function buildAlertExportRows(actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const alerts = await prisma.alert.findMany({
    where: access.canViewAll ? {} : { labId: { in: access.memberLabIds } },
    orderBy: [{ severity: "desc" }, { generatedAt: "desc" }],
  });

  return alerts.map<CsvRow>((alert) => ({
    severity: alert.severity,
    type: alert.alertType,
    entityType: alert.entityType,
    entityId: alert.entityId,
    message: alert.message,
    generatedAt: formatDateCell(alert.generatedAt),
  }));
}

async function buildExperimentExportRows(actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const assignments = await prisma.experimentAssignment.findMany({
    where: access.canViewAll
      ? {}
      : {
          experiment: { labId: { in: access.memberLabIds } },
          animal: { owningLabId: { in: access.memberLabIds } },
        },
    orderBy: [{ startDate: "desc" }, { id: "asc" }],
    include: {
      animal: { select: { animalId: true, owningLabId: true } },
      experiment: { select: { experimentCode: true, labId: true } },
    },
  });

  return assignments
    .filter((assignment) => assignment.animal.owningLabId === assignment.experiment.labId)
    .map<CsvRow>((assignment) => ({
    experimentCode: assignment.experiment.experimentCode,
    animalId: assignment.animal.animalId,
    status: assignment.status,
    startDate: formatDateCell(assignment.startDate),
    treatmentGroup: assignment.treatmentGroup ?? "",
    notes: assignment.notes ?? "",
    }));
}

async function buildOperationalAuditExportRows(filters: CsvExportFilters) {
  const search = filters.search?.trim();
  const entityType = filters.status?.trim();
  const range = validatePrivilegedExportRange(filters);
  const where: Prisma.AuditLogWhereInput = {
      AND: [
        { entityType: { notIn: ["user_invitation", "user_role", "user_access"] } },
        ...(entityType && entityType !== "all" ? [{ entityType: { equals: entityType, mode: "insensitive" as const } }] : []),
      ],
      timestamp: { gte: range.from, lte: range.to },
      ...(search ? { OR: [
        { action: { contains: search, mode: "insensitive" as const } },
        { entityType: { contains: search, mode: "insensitive" as const } },
        { entityId: { contains: search, mode: "insensitive" as const } },
        { requestId: { contains: search, mode: "insensitive" as const } },
        { actor: { name: { contains: search, mode: "insensitive" as const } } },
        { lab: { code: { contains: search, mode: "insensitive" as const } } },
      ] } : {}),
  };
  const logs = await prisma.auditLog.findMany({
    where,
    take: PRIVILEGED_EXPORT_MAX_ROWS + 1,
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    select: {
      action: true,
      actorRole: true,
      entityType: true,
      entityId: true,
      requestId: true,
      timestamp: true,
      actor: { select: { name: true } },
      lab: { select: { code: true } },
    },
  });
  assertPrivilegedExportRowCount(logs.length);

  return logs.map<CsvRow>((log) => ({
    action: log.action,
    actor: log.actor?.name ?? "System",
    actorRole: log.actorRole ?? "legacy_unsnapshotted",
    entityType: log.entityType,
    entityId: log.entityId,
    lab: log.lab?.code ?? "Facility",
    requestId: log.requestId ?? "",
    occurredAt: log.timestamp.toISOString(),
  }));
}

async function buildSecurityEventExportRows(filters: CsvExportFilters) {
  const search = filters.search?.trim();
  const severity = ["info", "warning", "critical"].includes(filters.status ?? "")
    ? filters.status as "info" | "warning" | "critical"
    : undefined;
  const outcome = ["succeeded", "denied", "failed"].includes(filters.outcome ?? "")
    ? filters.outcome as "succeeded" | "denied" | "failed"
    : undefined;
  const range = validatePrivilegedExportRange(filters);
  const where: Prisma.SecurityEventWhereInput = {
      ...(severity ? { severity } : {}),
      ...(outcome ? { outcome } : {}),
      occurredAt: { gte: range.from, lte: range.to },
      ...(search ? { OR: [
        { eventType: { contains: search, mode: "insensitive" as const } },
        { summary: { contains: search, mode: "insensitive" as const } },
        { source: { contains: search, mode: "insensitive" as const } },
        { correlationId: { contains: search, mode: "insensitive" as const } },
        { subjectId: { contains: search, mode: "insensitive" as const } },
        { actor: { name: { contains: search, mode: "insensitive" as const } } },
        { scopeLab: { code: { contains: search, mode: "insensitive" as const } } },
      ] } : {}),
  };
  const events = await prisma.securityEvent.findMany({
    where,
    take: PRIVILEGED_EXPORT_MAX_ROWS + 1,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: {
      eventType: true,
      severity: true,
      outcome: true,
      actorRole: true,
      correlationId: true,
      subjectType: true,
      subjectId: true,
      source: true,
      summary: true,
      occurredAt: true,
      actor: { select: { name: true } },
      scopeLab: { select: { code: true } },
    },
  });
  assertPrivilegedExportRowCount(events.length);

  return events.map<CsvRow>((event) => ({
    eventType: event.eventType,
    severity: event.severity,
    outcome: event.outcome,
    summary: event.summary,
    source: event.source,
    actor: event.actor?.name ?? "System",
    actorRole: event.actorRole,
    subject: event.subjectType && event.subjectId ? `${event.subjectType}: ${event.subjectId}` : "",
    scope: event.scopeLab?.code ?? "Facility",
    correlationId: event.correlationId ?? "",
    occurredAt: event.occurredAt.toISOString(),
  }));
}

export function hasActiveExportFilters(filters: CsvExportFilters) {
  return Boolean(
    normalizeSearch(filters.search) ||
      (filters.status && filters.status !== "all") ||
      filters.outcome ||
      filters.availableOnly ||
      filters.warningsOnly ||
      filters.from ||
      filters.to,
  );
}

export async function buildCsvExport(entity: string, actor: LabActor, filters: CsvExportFilters = {}) {
  const normalizedEntity = entity as ExportEntity;

  let rows: CsvRow[] = [];

  switch (normalizedEntity) {
    case "animals":
      rows = await buildAnimalExportRows(filters, actor);
      break;
    case "cages":
      rows = await buildCageExportRows(filters, actor);
      break;
    case "alerts":
      rows = await buildAlertExportRows(actor);
      break;
    case "experiments":
      rows = await buildExperimentExportRows(actor);
      break;
    case "audit":
      rows = await buildOperationalAuditExportRows(filters);
      break;
    case "security":
      rows = await buildSecurityEventExportRows(filters);
      break;
    default:
      return null;
  }

  return toCsv(rows);
}
