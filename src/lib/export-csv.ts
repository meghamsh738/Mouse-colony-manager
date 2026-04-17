import { format } from "date-fns";

import { getAnimalListView } from "@/lib/animals-read";
import { getCageListView } from "@/lib/cages-read";
import { prisma } from "@/lib/prisma";
import type { AnimalListItem, CageListItem } from "@/lib/types";

type ExportEntity = "animals" | "cages" | "alerts" | "experiments";
type CsvRow = Record<string, string | number>;

export type CsvExportFilters = {
  search?: string;
  status?: string;
  availableOnly?: boolean;
  warningsOnly?: boolean;
};

function formatDateCell(value?: Date | null) {
  return value ? format(value, "dd MMM yyyy") : "";
}

function toCsv(rows: CsvRow[]) {
  if (!rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const escapeValue = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

  return [headers.join(","), ...rows.map((row) => headers.map((header) => escapeValue(row[header])).join(","))].join("\n");
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
      cage.sexComposition,
      cage.strainSummary,
    ]
      .join(" ")
      .toLowerCase();
    const matchesSearch = search ? haystack.includes(search) : true;
    const matchesStatus = filters.status && filters.status !== "all" ? cage.status === filters.status : true;
    const matchesWarnings = filters.warningsOnly ? cage.warningCount > 0 : true;

    return matchesSearch && matchesStatus && matchesWarnings;
  });
}

async function buildAnimalExportRows(filters: CsvExportFilters) {
  const animals = filterAnimals(await getAnimalListView(), filters);

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

async function buildCageExportRows(filters: CsvExportFilters) {
  const cages = filterCages(await getCageListView(), filters);

  return cages.map<CsvRow>((cage) => ({
    cage: cage.cageNumber,
    room: cage.roomNumber,
    rack: cage.rackNumber,
    barcode: cage.barcode,
    status: cage.status,
    occupants: cage.occupantCount,
    sexComposition: cage.sexComposition,
    strainSummary: cage.strainSummary,
    warningCount: cage.warningCount,
  }));
}

async function buildAlertExportRows() {
  const alerts = await prisma.alert.findMany({
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

async function buildExperimentExportRows() {
  const assignments = await prisma.experimentAssignment.findMany({
    orderBy: [{ startDate: "desc" }, { id: "asc" }],
    include: {
      animal: { select: { animalId: true } },
      experiment: { select: { experimentCode: true } },
    },
  });

  return assignments.map<CsvRow>((assignment) => ({
    experimentCode: assignment.experiment.experimentCode,
    animalId: assignment.animal.animalId,
    status: assignment.status,
    startDate: formatDateCell(assignment.startDate),
    treatmentGroup: assignment.treatmentGroup ?? "",
    notes: assignment.notes ?? "",
  }));
}

export function hasActiveExportFilters(filters: CsvExportFilters) {
  return Boolean(
    normalizeSearch(filters.search) ||
      (filters.status && filters.status !== "all") ||
      filters.availableOnly ||
      filters.warningsOnly,
  );
}

export async function buildCsvExport(entity: string, filters: CsvExportFilters = {}) {
  const normalizedEntity = entity as ExportEntity;

  let rows: CsvRow[] = [];

  switch (normalizedEntity) {
    case "animals":
      rows = await buildAnimalExportRows(filters);
      break;
    case "cages":
      rows = await buildCageExportRows(filters);
      break;
    case "alerts":
      rows = await buildAlertExportRows();
      break;
    case "experiments":
      rows = await buildExperimentExportRows();
      break;
    default:
      return null;
  }

  return toCsv(rows);
}
