import { format } from "date-fns";

import { prisma } from "@/lib/prisma";
import { formatAgeLabel, getAgeInDays } from "@/lib/utils";

type ExportEntity = "animals" | "cages" | "alerts" | "experiments";
type CsvRow = Record<string, string | number>;

function getReferenceDate() {
  return process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString();
}

function formatDateCell(value?: Date | null) {
  return value ? format(value, "dd MMM yyyy") : "";
}

function formatGenotypeSummary(
  alleles: Array<{
    zygosity: string;
    allele: {
      name: string;
    };
  }>,
) {
  if (!alleles.length) {
    return "Genotype not recorded";
  }

  return alleles
    .map(({ allele, zygosity }) => `${allele.name}${zygosity === "WT/WT" ? " WT/WT" : ` ${zygosity}`}`)
    .join(" ; ");
}

function formatCageLabel(cage?: {
  cageNumber: string;
  room: { roomNumber: string };
  rack: { rackNumber: string };
} | null) {
  if (!cage) {
    return "Archived";
  }

  return `${cage.room.roomNumber} / ${cage.rack.rackNumber} / ${cage.cageNumber}`;
}

function toCsv(rows: CsvRow[]) {
  if (!rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const escapeValue = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

  return [headers.join(","), ...rows.map((row) => headers.map((header) => escapeValue(row[header])).join(","))].join("\n");
}

async function buildAnimalExportRows() {
  const referenceDate = getReferenceDate();
  const [animals, alerts] = await prisma.$transaction([
    prisma.animal.findMany({
      orderBy: { animalId: "asc" },
      include: {
        strain: { select: { name: true } },
        currentCage: {
          select: {
            cageNumber: true,
            room: { select: { roomNumber: true } },
            rack: { select: { rackNumber: true } },
          },
        },
        alleles: {
          include: {
            allele: {
              select: { name: true },
            },
          },
        },
        projectAllocations: {
          where: { endedAt: null },
          include: {
            project: { select: { projectCode: true } },
          },
        },
      },
    }),
    prisma.alert.findMany({
      where: {
        entityType: "animal",
        status: "open",
      },
      orderBy: { generatedAt: "desc" },
      select: {
        entityId: true,
        message: true,
      },
    }),
  ]);

  const warningsByAnimalId = new Map<string, string[]>();

  for (const alert of alerts) {
    const warnings = warningsByAnimalId.get(alert.entityId) ?? [];
    warnings.push(alert.message);
    warningsByAnimalId.set(alert.entityId, warnings);
  }

  return animals.map<CsvRow>((animal) => ({
    animalId: animal.animalId,
    labId: animal.labId,
    sex: animal.sex,
    age: formatAgeLabel(getAgeInDays(animal.dob.toISOString(), referenceDate)),
    strain: animal.strain.name,
    genotype: formatGenotypeSummary(animal.alleles),
    cage: formatCageLabel(animal.currentCage),
    status: animal.status,
    projects: animal.projectAllocations.map((allocation) => allocation.project.projectCode).join("; "),
    warnings: (warningsByAnimalId.get(animal.id) ?? []).join(" | "),
  }));
}

async function buildCageExportRows() {
  const [cages, alerts] = await prisma.$transaction([
    prisma.cage.findMany({
      orderBy: [{ room: { roomNumber: "asc" } }, { rack: { rackNumber: "asc" } }, { cageNumber: "asc" }],
      include: {
        room: { select: { roomNumber: true } },
        rack: { select: { rackNumber: true } },
        animals: {
          where: { outcomeStatus: "alive" },
          include: {
            strain: { select: { name: true } },
          },
        },
      },
    }),
    prisma.alert.findMany({
      where: {
        entityType: "cage",
        status: "open",
      },
      select: {
        entityId: true,
      },
    }),
  ]);

  const warningCountByCageId = new Map<string, number>();

  for (const alert of alerts) {
    warningCountByCageId.set(alert.entityId, (warningCountByCageId.get(alert.entityId) ?? 0) + 1);
  }

  return cages.map<CsvRow>((cage) => {
    const sexComposition = cage.animals.reduce<Record<string, number>>((composition, animal) => {
      composition[animal.sex] = (composition[animal.sex] ?? 0) + 1;
      return composition;
    }, {});
    const strainSummary = [...new Set(cage.animals.map((animal) => animal.strain.name))].join("; ");

    return {
      cage: cage.cageNumber,
      room: cage.room.roomNumber,
      rack: cage.rack.rackNumber,
      barcode: cage.barcode,
      status: cage.status,
      occupants: cage.animals.length,
      sexComposition: Object.entries(sexComposition)
        .map(([sex, count]) => `${sex} ${count}`)
        .join(" / "),
      strainSummary,
      warningCount: warningCountByCageId.get(cage.id) ?? 0,
    };
  });
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

export async function buildCsvExport(entity: string) {
  const normalizedEntity = entity as ExportEntity;

  let rows: CsvRow[] = [];

  switch (normalizedEntity) {
    case "animals":
      rows = await buildAnimalExportRows();
      break;
    case "cages":
      rows = await buildCageExportRows();
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

  return rows.length ? toCsv(rows) : "";
}
