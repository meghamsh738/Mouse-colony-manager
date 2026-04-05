import { compareDesc, differenceInDays } from "date-fns";

import { prisma } from "@/lib/prisma";
import type { Alert, CageListItem } from "@/lib/types";
import { formatAgeLabel } from "@/lib/utils";

type CageRuleContext = {
  cageMaxOccupancy: number;
  mixedSexHoldingAllowed: boolean;
  today: string;
};

function getReferenceDate() {
  return process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString();
}

function getAgeLabel(dob: Date, referenceDate: string) {
  return formatAgeLabel(differenceInDays(new Date(referenceDate), dob));
}

function buildCageLabel(cage: {
  cageNumber: string;
  room: { roomNumber: string };
  rack: { rackNumber: string };
}) {
  return `${cage.room.roomNumber} / ${cage.rack.rackNumber} / ${cage.cageNumber}`;
}

function buildGenotypeSummary(
  alleles: Array<{
    zygosity: string;
    allele: { name: string };
  }>,
) {
  if (!alleles.length) {
    return "Genotype not recorded";
  }

  return alleles
    .map(({ allele, zygosity }) => `${allele.name}${zygosity === "WT/WT" ? " WT/WT" : ` ${zygosity}`}`)
    .join(" ; ");
}

async function getCageRuleContext(): Promise<CageRuleContext> {
  const rules = await prisma.ruleConfig.findMany({
    where: {
      key: { in: ["cage_max_occupancy", "mixed_sex_holding_allowed"] },
    },
    select: {
      key: true,
      value: true,
    },
  });

  const values = new Map(rules.map((rule) => [rule.key, rule.value]));

  return {
    cageMaxOccupancy: Number(values.get("cage_max_occupancy") ?? 0),
    mixedSexHoldingAllowed: Boolean(values.get("mixed_sex_holding_allowed") ?? false),
    today: getReferenceDate(),
  };
}

function buildCageRuleAlerts(
  cage: {
    id: string;
    status: string;
    cageNumber: string;
    room: { roomNumber: string };
    rack: { rackNumber: string };
    animals: Array<{ sex: string }>;
    healthNotes: Array<{
      id: string;
      note: string;
      severity: Alert["severity"];
      resolved: boolean;
      createdAt: Date;
    }>;
  },
  rules: CageRuleContext,
) {
  const alerts: Alert[] = [];
  const occupantCount = cage.animals.length;
  const sexes = new Set(cage.animals.map((animal) => animal.sex));
  const unresolvedNotes = cage.healthNotes.filter((note) => !note.resolved);
  const label = buildCageLabel(cage);

  if (occupantCount > rules.cageMaxOccupancy) {
    alerts.push({
      id: `rule-cage-capacity-${cage.id}`,
      entityType: "cage",
      entityId: cage.id,
      alertType: "cage_overcapacity",
      severity: "critical",
      message: `${label} holds ${occupantCount} active animals, above the configured occupancy limit.`,
      status: "open",
      generatedAt: rules.today,
      source: "rule",
    });
  }

  if (!rules.mixedSexHoldingAllowed && cage.status !== "breeding" && sexes.has("male") && sexes.has("female")) {
    alerts.push({
      id: `rule-mixed-sex-${cage.id}`,
      entityType: "cage",
      entityId: cage.id,
      alertType: "mixed_sex_holding",
      severity: "critical",
      message: `${label} is a non-breeding cage holding mixed-sex occupants.`,
      status: "open",
      generatedAt: rules.today,
      source: "rule",
    });
  }

  unresolvedNotes.forEach((note) => {
    alerts.push({
      id: `rule-cage-note-${note.id}`,
      entityType: "cage",
      entityId: cage.id,
      alertType: "welfare_note",
      severity: note.severity,
      message: note.note,
      status: "open",
      generatedAt: note.createdAt.toISOString(),
      source: "rule",
    });
  });

  return alerts;
}

export async function getCageListView(): Promise<CageListItem[]> {
  const rules = await getCageRuleContext();
  const cages = await prisma.cage.findMany({
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
      healthNotes: {
        where: { cageId: { not: null } },
        select: {
          id: true,
          note: true,
          severity: true,
          resolved: true,
          createdAt: true,
        },
      },
    },
  });

  const manualAlerts = await prisma.alert.findMany({
    where: {
      entityType: "cage",
      entityId: { in: cages.map((cage) => cage.id) },
      status: "open",
    },
    orderBy: { generatedAt: "desc" },
  });

  const manualAlertsByCageId = new Map<string, Alert[]>();

  manualAlerts.forEach((alert) => {
    const existing = manualAlertsByCageId.get(alert.entityId) ?? [];
    existing.push({
      id: alert.id,
      entityType: "cage",
      entityId: alert.entityId,
      alertType: alert.alertType,
      severity: alert.severity,
      message: alert.message,
      status: alert.status,
      generatedAt: alert.generatedAt.toISOString(),
      resolvedAt: alert.resolvedAt?.toISOString(),
      source: (alert.source as "rule" | "manual") ?? "manual",
    });
    manualAlertsByCageId.set(alert.entityId, existing);
  });

  return cages.map((cage) => {
    const sexCounts = cage.animals.reduce<Record<string, number>>((accumulator, animal) => {
      accumulator[animal.sex] = (accumulator[animal.sex] ?? 0) + 1;
      return accumulator;
    }, {});
    const sexComposition = cage.animals.length
      ? Object.entries(sexCounts)
          .map(([sex, count]) => `${count}${sex === "male" ? "M" : sex === "female" ? "F" : "U"}`)
          .join(" / ")
      : "Empty";
    const strainSummary = Array.from(new Set(cage.animals.map((animal) => animal.strain.name))).join(", ");
    const alerts = [...(manualAlertsByCageId.get(cage.id) ?? []), ...buildCageRuleAlerts(cage, rules)];

    return {
      id: cage.id,
      cageNumber: cage.cageNumber,
      roomNumber: cage.room.roomNumber,
      rackNumber: cage.rack.rackNumber,
      barcode: cage.barcode,
      status: cage.status,
      occupantCount: cage.animals.length,
      sexComposition,
      strainSummary: strainSummary || "No active occupants",
      warningCount: alerts.length,
    };
  });
}

export async function getCageDetailView(cageId: string) {
  const rules = await getCageRuleContext();
  const cage = await prisma.cage.findUnique({
    where: { id: cageId },
    include: {
      room: { select: { roomNumber: true } },
      rack: { select: { rackNumber: true } },
      animals: {
        where: { outcomeStatus: "alive" },
        orderBy: { animalId: "asc" },
        include: {
          alleles: {
            include: {
              allele: { select: { name: true } },
            },
          },
        },
      },
      healthNotes: {
        where: { cageId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          note: true,
          severity: true,
          resolved: true,
          createdAt: true,
        },
      },
    },
  });

  if (!cage) {
    return null;
  }

  const manualAlerts = await prisma.alert.findMany({
    where: {
      entityType: "cage",
      entityId: cage.id,
      status: "open",
    },
    orderBy: { generatedAt: "desc" },
  });

  const alerts = [
    ...manualAlerts.map<Alert>((alert) => ({
      id: alert.id,
      entityType: "cage",
      entityId: alert.entityId,
      alertType: alert.alertType,
      severity: alert.severity,
      message: alert.message,
      status: alert.status,
      generatedAt: alert.generatedAt.toISOString(),
      resolvedAt: alert.resolvedAt?.toISOString(),
      source: (alert.source as "rule" | "manual") ?? "manual",
    })),
    ...buildCageRuleAlerts(cage, rules),
  ].sort((left, right) => compareDesc(new Date(left.generatedAt), new Date(right.generatedAt)));

  return {
    cage: {
      id: cage.id,
      barcode: cage.barcode,
      status: cage.status,
      lastUpdatedAt: cage.lastUpdatedAt.toISOString(),
      notes: cage.notes ?? "",
    },
    cageLabel: buildCageLabel(cage),
    occupants: cage.animals.map((animal) => ({
      id: animal.id,
      animalId: animal.animalId,
      sex: animal.sex,
      dob: animal.dob.toISOString(),
      ageLabel: getAgeLabel(animal.dob, rules.today),
      status: animal.status,
      genotypeSummary: buildGenotypeSummary(animal.alleles),
    })),
    notes: cage.healthNotes.map((note) => ({
      id: note.id,
      note: note.note,
      createdAt: note.createdAt.toISOString(),
    })),
    alerts,
  };
}
