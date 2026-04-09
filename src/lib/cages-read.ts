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

function buildLocationLabel(location: { roomNumber: string; rackNumber: string; cageNumber: string }) {
  return `${location.roomNumber} / ${location.rackNumber} / ${location.cageNumber}`;
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

function normalizeManualAlerts(
  alerts: Array<{
    id: string;
    entityId: string;
    alertType: string;
    severity: Alert["severity"];
    message: string;
    status: Alert["status"];
    generatedAt: Date;
    resolvedAt: Date | null;
    source: string;
  }>,
) {
  return alerts.map<Alert>((alert) => ({
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
  }));
}

async function getCageMoveOptions() {
  const [rooms, racks] = await Promise.all([
    prisma.room.findMany({
      orderBy: { roomNumber: "asc" },
      select: {
        id: true,
        roomNumber: true,
      },
    }),
    prisma.rack.findMany({
      orderBy: [{ room: { roomNumber: "asc" } }, { rackNumber: "asc" }],
      select: {
        id: true,
        rackNumber: true,
        roomId: true,
        room: {
          select: {
            roomNumber: true,
          },
        },
      },
    }),
  ]);

  return {
    roomOptions: rooms.map((room) => ({
      id: room.id,
      label: room.roomNumber,
    })),
    rackOptions: racks.map((rack) => ({
      id: rack.id,
      roomId: rack.roomId,
      label: `${rack.room.roomNumber} / ${rack.rackNumber}`,
    })),
  };
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
    existing.push(...normalizeManualAlerts([alert]));
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
  const [rules, cage, moveOptions] = await Promise.all([
    getCageRuleContext(),
    prisma.cage.findUnique({
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
        cageMovements: {
          orderBy: { movedAt: "desc" },
          select: {
            id: true,
            fromLocation: true,
            toLocation: true,
            movedAt: true,
            reason: true,
            movedBy: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
    }),
    getCageMoveOptions(),
  ]);

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
      welfareFlags: Array.isArray(cage.welfareFlags) ? cage.welfareFlags.map((flag) => String(flag)) : [],
      lastUpdatedAt: cage.lastUpdatedAt.toISOString(),
      notes: cage.notes ?? "",
    },
    cageLabel: buildCageLabel(cage),
    currentLocationLabel: buildLocationLabel({
      roomNumber: cage.room.roomNumber,
      rackNumber: cage.rack.rackNumber,
      cageNumber: cage.cageNumber,
    }),
    occupants: cage.animals.map((animal) => ({
      id: animal.id,
      animalId: animal.animalId,
      sex: animal.sex,
      dob: animal.dob.toISOString(),
      ageLabel: getAgeLabel(animal.dob, rules.today),
      status: animal.status,
      healthStatus: animal.healthStatus ?? "Not recorded",
      genotypeSummary: buildGenotypeSummary(animal.alleles),
    })),
    notes: cage.healthNotes.map((note) => ({
      id: note.id,
      note: note.note,
      createdAt: note.createdAt.toISOString(),
    })),
    movementHistory: cage.cageMovements.map((movement) => ({
      id: movement.id,
      fromLocation: movement.fromLocation,
      toLocation: movement.toLocation,
      movedAt: movement.movedAt.toISOString(),
      reason: movement.reason ?? "No reason recorded.",
      movedBy: movement.movedBy?.name ?? movement.movedBy?.email ?? "Unknown user",
    })),
    moveForm: {
      defaultDate: rules.today.slice(0, 10),
      defaultRoomId: cage.roomId,
      defaultRackId: cage.rackId,
      defaultCageNumber: cage.cageNumber,
      roomOptions: moveOptions.roomOptions,
      rackOptions: moveOptions.rackOptions,
    },
    alerts,
  };
}

export async function getScanCageViewByBarcode(barcode: string) {
  const [rules, cage, moveOptions] = await Promise.all([
    getCageRuleContext(),
    prisma.cage.findUnique({
      where: { barcode },
      include: {
        room: { select: { roomNumber: true } },
        rack: { select: { rackNumber: true } },
        animals: {
          where: { outcomeStatus: "alive" },
          orderBy: { animalId: "asc" },
          select: {
            id: true,
            animalId: true,
            sex: true,
            status: true,
            healthStatus: true,
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
        cageMovements: {
          orderBy: { movedAt: "desc" },
          take: 3,
          select: {
            id: true,
            fromLocation: true,
            toLocation: true,
            movedAt: true,
            reason: true,
          },
        },
      },
    }),
    getCageMoveOptions(),
  ]);

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

  const alerts = [...normalizeManualAlerts(manualAlerts), ...buildCageRuleAlerts(cage, rules)].sort((left, right) =>
    compareDesc(new Date(left.generatedAt), new Date(right.generatedAt)),
  );

  return {
    cage: {
      id: cage.id,
      barcode: cage.barcode,
      status: cage.status,
      welfareFlags: Array.isArray(cage.welfareFlags) ? cage.welfareFlags.map((flag) => String(flag)) : [],
      cageNumber: cage.cageNumber,
      roomNumber: cage.room.roomNumber,
      rackNumber: cage.rack.rackNumber,
      currentLocationLabel: buildLocationLabel({
        roomNumber: cage.room.roomNumber,
        rackNumber: cage.rack.rackNumber,
        cageNumber: cage.cageNumber,
      }),
    },
    occupants: cage.animals.map((animal) => ({
      id: animal.id,
      animalId: animal.animalId,
      sex: animal.sex,
      status: animal.status,
      healthStatus: animal.healthStatus ?? "Not recorded",
    })),
    notes: cage.healthNotes.map((note) => ({
      id: note.id,
      note: note.note,
      createdAt: note.createdAt.toISOString(),
    })),
    movementHistory: cage.cageMovements.map((movement) => ({
      id: movement.id,
      fromLocation: movement.fromLocation,
      toLocation: movement.toLocation,
      movedAt: movement.movedAt.toISOString(),
      reason: movement.reason ?? "No reason recorded.",
    })),
    moveForm: {
      defaultDate: rules.today.slice(0, 10),
      defaultRoomId: cage.roomId,
      defaultRackId: cage.rackId,
      defaultCageNumber: cage.cageNumber,
      roomOptions: moveOptions.roomOptions,
      rackOptions: moveOptions.rackOptions,
    },
    alerts,
  };
}
