import { randomUUID } from "node:crypto";

import { compareDesc, differenceInDays } from "date-fns";

import { getCageCapacityState, resolveEffectiveCageCapacity } from "@/lib/cage-capacity";
import { canManageLab, canViewLab, getActorLabAccess, type LabActor } from "@/lib/lab-access";
import { prisma } from "@/lib/prisma";
import type {
  Alert,
  AnimalTransferWorkspaceView,
  CageLabelPrintView,
  CageListItem,
  CageStatus,
} from "@/lib/types";
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

function isActionableHealthNote(note: { severity: Alert["severity"]; followupRequired: boolean }) {
  return note.followupRequired || note.severity === "warning" || note.severity === "critical";
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

async function getCageResponsibilityOptions(labId: string) {
  const memberships = await prisma.labMembership.findMany({
    where: {
      labId,
      active: true,
      role: { in: ["owner", "manager", "staff"] },
      lab: { active: true },
      user: { active: true },
    },
    orderBy: [{ user: { name: "asc" } }, { user: { email: "asc" } }],
    select: {
      userId: true,
      role: true,
      user: { select: { name: true, email: true } },
    },
  });

  return memberships.map((membership) => ({
    userId: membership.userId,
    name: membership.user.name,
    email: membership.user.email,
    membershipRole: membership.role,
  }));
}

function mapCageResponsibilities(assignments: Array<{
  id: string;
  userId: string;
  assignedAt: Date;
  reason: string;
  user: { name: string; email: string; active: boolean };
  membership: { role: "owner" | "manager" | "staff" | "viewer"; active: boolean };
}>) {
  return assignments.map((assignment) => ({
    id: assignment.id,
    userId: assignment.userId,
    name: assignment.user.name,
    email: assignment.user.email,
    membershipRole: assignment.membership.role,
    active: assignment.user.active && assignment.membership.active,
    assignedAt: assignment.assignedAt.toISOString(),
    reason: assignment.reason,
  }));
}

function buildCageRuleAlerts(
  cage: {
    id: string;
    status: string;
    cageNumber: string;
    rack: { rackNumber: string };
    capacityOverride?: number | null;
    room: { roomNumber: string; facility?: { maxCageOccupancy: number } };
    animals: Array<{ sex: string }>;
    healthNotes: Array<{
      id: string;
      note: string;
      severity: Alert["severity"];
      followupRequired: boolean;
      resolved: boolean;
      createdAt: Date;
    }>;
  },
  rules: CageRuleContext,
) {
  const alerts: Alert[] = [];
  const occupantCount = cage.animals.length;
  const sexes = new Set(cage.animals.map((animal) => animal.sex));
  const unresolvedNotes = cage.healthNotes.filter((note) => !note.resolved && isActionableHealthNote(note));
  const label = buildCageLabel(cage);

  const effectiveCapacity = resolveEffectiveCageCapacity(
    cage.room.facility?.maxCageOccupancy ?? rules.cageMaxOccupancy,
    cage.capacityOverride,
  );

  if (occupantCount > effectiveCapacity) {
    alerts.push({
      id: `rule-cage-capacity-${cage.id}`,
      entityType: "cage",
      entityId: cage.id,
      alertType: "cage_overcapacity",
      severity: "critical",
      message: `${label} holds ${occupantCount} active animals, above its ${effectiveCapacity}-animal occupancy limit.`,
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

async function getLabOptions(actor?: LabActor) {
  const access = actor ? await getActorLabAccess(actor) : null;

  const labs = await prisma.lab.findMany({
    where: {
      active: true,
      ...(access && !access.canViewAll ? { id: { in: access.memberLabIds } } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
    },
  });

  return labs;
}

export async function getChargeCategoryOptions() {
  return prisma.cageChargeCategory.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      dailyRateCents: true,
      currencyCode: true,
      active: true,
    },
  });
}

function getCageChargeState(cage: {
  active: boolean;
  status: string;
  chargePeriods: Array<{ id: string }>;
}) {
  if (!cage.active || cage.status === "closed") {
    return "exited" as const;
  }

  return cage.chargePeriods.length ? ("chargeable" as const) : ("unpriced" as const);
}

export async function getCageListView(
  actor?: LabActor,
  options: { includeTerminalAnimals?: boolean } = {},
): Promise<CageListItem[]> {
  const rules = await getCageRuleContext();
  const access = actor ? await getActorLabAccess(actor) : null;
  const cages = await prisma.cage.findMany({
    where: {
      ...(access && !access.canViewAll ? { labId: { in: access.memberLabIds } } : {}),
    },
    orderBy: [{ room: { roomNumber: "asc" } }, { rack: { rackNumber: "asc" } }, { cageNumber: "asc" }],
    include: {
      room: { select: { roomNumber: true, facility: { select: { maxCageOccupancy: true } } } },
      rack: { select: { rackNumber: true } },
      lab: { select: { id: true, name: true, code: true } },
      closure: { select: { billingCutoffAt: true } },
      chargePeriods: {
        where: { endedAt: null },
        take: 1,
        orderBy: { startedAt: "desc" },
        include: {
          category: {
            select: {
              id: true,
              name: true,
              code: true,
              dailyRateCents: true,
              currencyCode: true,
            },
          },
        },
      },
      animals: {
        where: options.includeTerminalAnimals ? {} : { outcomeStatus: "alive" },
        include: {
          strain: { select: { name: true } },
          alleles: { include: { allele: { select: { name: true } } } },
          projectAllocations: {
            where: { endedAt: null },
            include: {
              project: {
                select: {
                  projectCode: true,
                  labId: true,
                },
              },
            },
          },
        },
      },
      healthNotes: {
        where: { cageId: { not: null } },
        select: {
          id: true,
          labId: true,
          note: true,
          severity: true,
          followupRequired: true,
          resolved: true,
          createdAt: true,
        },
      },
    },
  });

  const manualAlerts = cages.length
    ? await prisma.alert.findMany({
        where: {
          entityType: "cage",
          entityId: { in: cages.map((cage) => cage.id) },
          status: "open",
        },
        orderBy: { generatedAt: "desc" },
      })
    : [];

  const manualAlertsByCageId = new Map<string, Alert[]>();

  const cageLabById = new Map(cages.map((cage) => [cage.id, cage.labId]));
  manualAlerts.forEach((alert) => {
    if (!alert.labId || alert.labId !== cageLabById.get(alert.entityId)) return;
    const existing = manualAlertsByCageId.get(alert.entityId) ?? [];
    existing.push(...normalizeManualAlerts([alert]));
    manualAlertsByCageId.set(alert.entityId, existing);
  });

  return cages.map((cage) => {
    const scopedAnimals = cage.animals.filter((animal) => animal.owningLabId === cage.labId);
    const healthNotes = cage.healthNotes.filter((note) => note.labId === cage.labId);
    const sexCounts = scopedAnimals.reduce<Record<string, number>>((accumulator, animal) => {
      accumulator[animal.sex] = (accumulator[animal.sex] ?? 0) + 1;
      return accumulator;
    }, {});
    const sexComposition = scopedAnimals.length
      ? Object.entries(sexCounts)
          .map(([sex, count]) => `${count}${sex === "male" ? "M" : sex === "female" ? "F" : "U"}`)
          .join(" / ")
      : "Empty";
    const strainSummary = Array.from(new Set(scopedAnimals.map((animal) => animal.strain.name))).join(", ");
    const alerts = [
      ...(manualAlertsByCageId.get(cage.id) ?? []),
      ...buildCageRuleAlerts({ ...cage, animals: scopedAnimals, healthNotes }, rules),
    ];
    const capacity = getCageCapacityState({
      facilityLimit: cage.room.facility.maxCageOccupancy,
      cageOverride: cage.capacityOverride,
      occupantCount: scopedAnimals.length,
    });
    const activeChargePeriod = cage.chargePeriods[0];
    const visibleAnimals = scopedAnimals.map((animal) => ({
      ...animal,
      projectAllocations: animal.projectAllocations.filter((allocation) => allocation.project.labId === cage.labId),
    }));
    const activeProjectCodes = Array.from(
      new Set(
        visibleAnimals.flatMap((animal) =>
          animal.projectAllocations.map((allocation) => allocation.project.projectCode),
        ),
      ),
    );

    return {
      id: cage.id,
      roomId: cage.roomId,
      cageNumber: cage.cageNumber,
      roomNumber: cage.room.roomNumber,
      rackNumber: cage.rack.rackNumber,
      barcode: cage.barcode,
      labId: cage.lab?.id ?? null,
      labName: cage.lab?.name ?? null,
      labCode: cage.lab?.code ?? null,
      status: cage.status,
      active: cage.active,
      occupantCount: scopedAnimals.length,
      capacity: capacity.effectiveLimit,
      remainingCapacity: capacity.remainingCapacity,
      capacityOverride: cage.capacityOverride,
      animalIdentifiers: scopedAnimals.map((animal) => animal.animalId),
      animalLabIdentifiers: scopedAnimals.map((animal) => animal.labId),
      sexComposition,
      strainSummary: strainSummary || "No active occupants",
      projectSummary: activeProjectCodes.join(", ") || "Unallocated",
      chargeCategoryId: activeChargePeriod?.category.id ?? null,
      chargeCategoryName: activeChargePeriod?.category.name ?? null,
      dailyRateCents: activeChargePeriod?.dailyRateCents ?? null,
      currencyCode: activeChargePeriod?.currencyCode ?? null,
      chargeState: getCageChargeState(cage),
      billingCutoffAt: cage.closure?.billingCutoffAt.toISOString() ?? null,
      warningCount: alerts.length,
      warningMessages: alerts.map((alert) => alert.message),
      animals: visibleAnimals.map((animal) => ({
        id: animal.id,
        animalId: animal.animalId,
        labAnimalId: animal.labId,
        sex: animal.sex,
        dob: animal.dob.toISOString(),
        status: animal.status,
        healthStatus: animal.healthStatus,
        strain: animal.strain.name,
        genotype: animal.alleles.length
          ? animal.alleles.map(({ allele, zygosity }) => `${allele.name} ${zygosity}`).join(" ; ")
          : "Genotype not recorded",
        projectCodes: animal.projectAllocations.map((allocation) => allocation.project.projectCode),
      })),
    };
  });
}

type PrintableCageLabelFilters = {
  cageId?: string;
  search?: string;
  status?: "all" | CageStatus;
  warningsOnly?: boolean;
};

export async function getPrintableCageLabelView(
  filters: PrintableCageLabelFilters = {},
  actor?: LabActor,
): Promise<CageLabelPrintView> {
  const cages = await getCageListView(actor);
  const normalizedSearch = filters.search?.trim().toLowerCase() ?? "";

  const labels = cages
    .filter((cage) => {
      const matchesCageId = filters.cageId ? cage.id === filters.cageId : true;
      const matchesStatus = filters.status && filters.status !== "all" ? cage.status === filters.status : true;
      const matchesWarnings = filters.warningsOnly ? cage.warningCount > 0 : true;
      const matchesSearch = normalizedSearch
        ? [
            cage.roomNumber,
            cage.rackNumber,
            cage.cageNumber,
            cage.barcode,
            cage.sexComposition,
            cage.strainSummary,
            cage.status,
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
        : true;

      return matchesCageId && matchesStatus && matchesWarnings && matchesSearch;
    })
    .map((cage) => ({
      id: cage.id,
      barcode: cage.barcode,
      locationLabel: buildLocationLabel({
        roomNumber: cage.roomNumber,
        rackNumber: cage.rackNumber,
        cageNumber: cage.cageNumber,
      }),
      status: cage.status,
      occupantCount: cage.occupantCount,
      sexComposition: cage.sexComposition,
      strainSummary: cage.strainSummary,
      warningCount: cage.warningCount,
    }));

  return {
    labels,
    printedAt: getReferenceDate(),
    total: cages.length,
  };
}

export async function getAnimalTransferWorkspaceView(
  requestedDestinationCageId: string,
  actor?: LabActor,
): Promise<AnimalTransferWorkspaceView> {
  const access = actor ? await getActorLabAccess(actor) : null;
  const [rules, animals, cages] = await Promise.all([
    getCageRuleContext(),
    prisma.animal.findMany({
      where: {
        outcomeStatus: "alive",
        currentCageId: { not: null },
        ...(access && !access.canViewAll ? { owningLabId: { in: access.memberLabIds } } : {}),
      },
      orderBy: { animalId: "asc" },
      include: {
        strain: {
          select: {
            name: true,
          },
        },
        currentCage: {
          select: {
            id: true,
            barcode: true,
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
        owningLab: {
          select: {
            name: true,
            code: true,
          },
        },
      },
    }),
    prisma.cage.findMany({
      where: {
        active: true,
        status: {
          notIn: ["closed", "retired"],
        },
        ...(access && !access.canViewAll ? { labId: { in: access.memberLabIds } } : {}),
      },
      orderBy: [{ room: { roomNumber: "asc" } }, { rack: { rackNumber: "asc" } }, { cageNumber: "asc" }],
      include: {
        room: { select: { roomNumber: true, facility: { select: { maxCageOccupancy: true } } } },
        rack: { select: { rackNumber: true } },
        lab: {
          select: {
            name: true,
            code: true,
          },
        },
        animals: {
          where: { outcomeStatus: "alive" },
          include: {
            strain: {
              select: {
                name: true,
              },
            },
          },
        },
      healthNotes: {
        where: { cageId: { not: null } },
        select: {
          id: true,
          labId: true,
          note: true,
            severity: true,
            followupRequired: true,
            resolved: true,
            createdAt: true,
          },
        },
      },
    }),
  ]);

  const cageOptions = cages.map((cage) => {
    const healthNotes = cage.healthNotes.filter((note) => note.labId === cage.labId);
    const maleCount = cage.animals.filter((animal) => animal.sex === "male").length;
    const femaleCount = cage.animals.filter((animal) => animal.sex === "female").length;
    const unknownCount = cage.animals.filter((animal) => animal.sex === "unknown").length;
    const sexComposition = cage.animals.length
      ? [
          maleCount ? `${maleCount}M` : null,
          femaleCount ? `${femaleCount}F` : null,
          unknownCount ? `${unknownCount}U` : null,
        ]
          .filter(Boolean)
          .join(" / ")
      : "Empty";
    const strainSummary = Array.from(new Set(cage.animals.map((animal) => animal.strain.name))).join(", ");
    const capacity = getCageCapacityState({
      facilityLimit: cage.room.facility.maxCageOccupancy,
      cageOverride: cage.capacityOverride,
      occupantCount: cage.animals.length,
    });

    return {
      id: cage.id,
      labId: cage.labId ?? "",
      barcode: cage.barcode,
      label: buildCageLabel(cage),
      status: cage.status,
      labName: cage.lab?.name ?? "Unassigned lab",
      labCode: cage.lab?.code ?? null,
      occupantCount: cage.animals.length,
      capacity: capacity.effectiveLimit,
      remainingCapacity: capacity.remainingCapacity,
      maleCount,
      femaleCount,
      sexComposition,
      strainSummary: strainSummary || "No active occupants",
      warningCount: buildCageRuleAlerts({ ...cage, healthNotes }, rules).length,
    };
  });

  const defaultDestinationCageId = cageOptions.some((cage) => cage.id === requestedDestinationCageId)
    ? requestedDestinationCageId
    : (cageOptions[0]?.id ?? requestedDestinationCageId);

  return {
    commandNonce: randomUUID(),
    defaultDestinationCageId,
    defaultDate: rules.today.slice(0, 10),
    rules: {
      cageMaxOccupancy: rules.cageMaxOccupancy,
      mixedSexHoldingAllowed: rules.mixedSexHoldingAllowed,
    },
    animalOptions: animals
      .filter((animal) => animal.currentCageId && animal.currentCage)
      .map((animal) => ({
        id: animal.id,
        version: animal.version,
        animalId: animal.animalId,
        labId: animal.labId,
        owningLabId: animal.owningLabId ?? "",
        owningLabName: animal.owningLab?.name ?? "Unassigned lab",
        owningLabCode: animal.owningLab?.code ?? null,
        sex: animal.sex,
        status: animal.status,
        healthStatus: animal.healthStatus ?? "Not recorded",
        strain: animal.strain.name,
        currentCageId: animal.currentCageId ?? "",
        currentCageBarcode: animal.currentCage?.barcode ?? "",
        currentCageLabel: animal.currentCage ? buildCageLabel(animal.currentCage) : "Unassigned",
      })),
    cageOptions,
  };
}

export async function getCageDetailView(cageId: string, actor?: LabActor) {
  const rules = await getCageRuleContext();
  const cage = await prisma.cage.findUnique({
    where: { id: cageId },
    include: {
      room: { select: { roomNumber: true, facility: { select: { maxCageOccupancy: true } } } },
      rack: { select: { rackNumber: true } },
      lab: { select: { id: true, name: true, code: true } },
      closure: {
        include: {
          closedBy: { select: { name: true, email: true } },
          chargePeriod: {
            select: {
              id: true,
              category: { select: { name: true, code: true } },
              dailyRateCents: true,
              currencyCode: true,
              startedAt: true,
              endedAt: true,
            },
          },
        },
      },
      chargePeriods: {
        where: { endedAt: null },
        take: 1,
        orderBy: { startedAt: "desc" },
        include: {
          category: {
            select: {
              id: true,
              name: true,
              code: true,
              dailyRateCents: true,
              currencyCode: true,
            },
          },
        },
      },
      animals: {
        where: { outcomeStatus: "alive" },
        orderBy: { animalId: "asc" },
        include: {
          owningLab: { select: { id: true, name: true, code: true } },
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
          labId: true,
          note: true,
          severity: true,
          followupRequired: true,
          resolved: true,
          createdAt: true,
          attachments: {
            select: {
              id: true,
              labId: true,
              label: true,
              fileName: true,
              fileType: true,
              storageUrl: true,
            },
          },
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
      userAssignments: {
        where: { endedAt: null },
        orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          userId: true,
          assignedAt: true,
          reason: true,
          user: { select: { name: true, email: true, active: true } },
          membership: { select: { role: true, active: true } },
        },
      },
    },
  });
  const access = actor ? await getActorLabAccess(actor) : null;

  if (!cage) {
    return null;
  }

  if (access && !canViewLab(access, cage.labId)) {
    return null;
  }

  const [moveOptions, chargeCategoryOptions, labOptions, responsibilityOptions] = await Promise.all([
    getCageMoveOptions(),
    getChargeCategoryOptions(),
    getLabOptions(actor),
    actor && access && canManageLab(access, cage.labId) ? getCageResponsibilityOptions(cage.labId) : Promise.resolve([]),
  ]);

  const manualAlerts = await prisma.alert.findMany({
    where: {
      labId: cage.labId,
      entityType: "cage",
      entityId: cage.id,
      status: "open",
    },
    orderBy: { generatedAt: "desc" },
  });

  const healthNotes = cage.healthNotes
    .filter((note) => note.labId === cage.labId)
    .map((note) => ({
      ...note,
      attachments: note.attachments.filter((attachment) => attachment.labId === cage.labId),
    }));
  const scopedAnimals = cage.animals.filter((animal) => animal.owningLabId === cage.labId);
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
    ...buildCageRuleAlerts({ ...cage, animals: scopedAnimals, healthNotes }, rules),
  ].sort((left, right) => compareDesc(new Date(left.generatedAt), new Date(right.generatedAt)));
  const capacity = getCageCapacityState({
    facilityLimit: cage.room.facility.maxCageOccupancy,
    cageOverride: cage.capacityOverride,
    occupantCount: scopedAnimals.length,
  });

  return {
    cage: {
      id: cage.id,
      version: cage.version,
      barcode: cage.barcode,
      status: cage.status,
      active: cage.active,
      capacity: capacity.effectiveLimit,
      remainingCapacity: capacity.remainingCapacity,
      capacityOverride: cage.capacityOverride,
      labId: cage.lab?.id ?? null,
      labName: cage.lab?.name ?? null,
      labCode: cage.lab?.code ?? null,
      welfareFlags: Array.isArray(cage.welfareFlags) ? cage.welfareFlags.map((flag) => String(flag)) : [],
      lastUpdatedAt: cage.lastUpdatedAt.toISOString(),
      notes: cage.notes ?? "",
      chargeCategoryId: cage.chargePeriods[0]?.category.id ?? null,
      chargeCategoryName: cage.chargePeriods[0]?.category.name ?? null,
      chargePeriodId: cage.chargePeriods[0]?.id ?? null,
      chargePeriodStartedAt: cage.chargePeriods[0]?.startedAt.toISOString() ?? null,
      dailyRateCents: cage.chargePeriods[0]?.dailyRateCents ?? null,
      currencyCode: cage.chargePeriods[0]?.currencyCode ?? null,
      chargeState: getCageChargeState(cage),
      closure: cage.closure
        ? {
            id: cage.closure.id,
            closedAt: cage.closure.closedAt.toISOString(),
            billingCutoffAt: cage.closure.billingCutoffAt.toISOString(),
            reason: cage.closure.reason,
            closedBy: cage.closure.closedBy?.name ?? cage.closure.closedBy?.email ?? "Legacy migration",
            chargePeriodId: cage.closure.chargePeriod.id,
            chargeCategoryName: cage.closure.chargePeriod.category.name,
            chargeCategoryCode: cage.closure.chargePeriod.category.code,
            dailyRateCents: cage.closure.chargePeriod.dailyRateCents,
            currencyCode: cage.closure.chargePeriod.currencyCode,
            chargePeriodStartedAt: cage.closure.chargePeriod.startedAt.toISOString(),
            chargePeriodEndedAt: cage.closure.chargePeriod.endedAt?.toISOString() ?? null,
          }
        : null,
    },
    closureCommandNonce: randomUUID(),
    cageLabel: buildCageLabel(cage),
    currentLocationLabel: buildLocationLabel({
      roomNumber: cage.room.roomNumber,
      rackNumber: cage.rack.rackNumber,
      cageNumber: cage.cageNumber,
    }),
    occupants: scopedAnimals.map((animal) => ({
      id: animal.id,
      animalId: animal.animalId,
      labId: animal.labId,
      owningLabName: animal.owningLab?.name ?? null,
      sex: animal.sex,
      dob: animal.dob.toISOString(),
      ageLabel: getAgeLabel(animal.dob, rules.today),
      status: animal.status,
      healthStatus: animal.healthStatus ?? "Not recorded",
      genotypeSummary: buildGenotypeSummary(animal.alleles),
    })),
    notes: healthNotes.map((note) => ({
      id: note.id,
      note: note.note,
      createdAt: note.createdAt.toISOString(),
      attachments: note.attachments.map((attachment) => ({
        id: attachment.id,
        label: attachment.label,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
        storageUrl: attachment.storageUrl,
      })),
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
    chargeCategoryOptions,
    responsibility: {
      assignments: mapCageResponsibilities(cage.userAssignments),
      options: responsibilityOptions,
    },
    labOptions,
    alerts,
  };
}

export async function getScanCageViewByBarcode(barcode: string, actor?: LabActor) {
  const rules = await getCageRuleContext();
  const cage = await prisma.cage.findUnique({
    where: { barcode },
    include: {
      room: { select: { roomNumber: true, facility: { select: { maxCageOccupancy: true } } } },
      rack: { select: { rackNumber: true } },
      lab: { select: { id: true, name: true, code: true } },
      closure: {
        include: {
          closedBy: { select: { name: true, email: true } },
          chargePeriod: {
            select: {
              id: true,
              category: { select: { name: true, code: true } },
              dailyRateCents: true,
              currencyCode: true,
              startedAt: true,
              endedAt: true,
            },
          },
        },
      },
      chargePeriods: {
        where: { endedAt: null },
        take: 1,
        orderBy: { startedAt: "desc" },
        include: {
          category: {
            select: {
              id: true,
              name: true,
              code: true,
              dailyRateCents: true,
              currencyCode: true,
            },
          },
        },
      },
      animals: {
        where: { outcomeStatus: "alive" },
        orderBy: { animalId: "asc" },
        select: {
          id: true,
          animalId: true,
          labId: true,
          owningLabId: true,
          sex: true,
          status: true,
          healthStatus: true,
          owningLab: {
            select: {
              name: true,
              code: true,
            },
          },
        },
      },
      healthNotes: {
        where: { cageId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          labId: true,
          note: true,
          severity: true,
          followupRequired: true,
          resolved: true,
          createdAt: true,
          attachments: {
            select: {
              id: true,
              labId: true,
              label: true,
              fileName: true,
              fileType: true,
              storageUrl: true,
            },
          },
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
      userAssignments: {
        where: { endedAt: null },
        orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          userId: true,
          assignedAt: true,
          reason: true,
          user: { select: { name: true, email: true, active: true } },
          membership: { select: { role: true, active: true } },
        },
      },
    },
  });
  const access = actor ? await getActorLabAccess(actor) : null;

  if (!cage) {
    return null;
  }

  if (access && !canViewLab(access, cage.labId)) {
    return null;
  }

  const [moveOptions, chargeCategoryOptions, labOptions, responsibilityOptions] = await Promise.all([
    getCageMoveOptions(),
    getChargeCategoryOptions(),
    getLabOptions(actor),
    actor && access && canManageLab(access, cage.labId) ? getCageResponsibilityOptions(cage.labId) : Promise.resolve([]),
  ]);

  const manualAlerts = await prisma.alert.findMany({
    where: {
      labId: cage.labId,
      entityType: "cage",
      entityId: cage.id,
      status: "open",
    },
    orderBy: { generatedAt: "desc" },
  });

  const healthNotes = cage.healthNotes
    .filter((note) => note.labId === cage.labId)
    .map((note) => ({
      ...note,
      attachments: note.attachments.filter((attachment) => attachment.labId === cage.labId),
    }));
  const scopedAnimals = cage.animals.filter((animal) => animal.owningLabId === cage.labId);
  const alerts = [...normalizeManualAlerts(manualAlerts), ...buildCageRuleAlerts({ ...cage, animals: scopedAnimals, healthNotes }, rules)].sort((left, right) =>
    compareDesc(new Date(left.generatedAt), new Date(right.generatedAt)),
  );
  const capacity = getCageCapacityState({
    facilityLimit: cage.room.facility.maxCageOccupancy,
    cageOverride: cage.capacityOverride,
    occupantCount: scopedAnimals.length,
  });

  return {
    cage: {
      id: cage.id,
      version: cage.version,
      barcode: cage.barcode,
      status: cage.status,
      active: cage.active,
      capacity: capacity.effectiveLimit,
      remainingCapacity: capacity.remainingCapacity,
      capacityOverride: cage.capacityOverride,
      labId: cage.lab?.id ?? null,
      labName: cage.lab?.name ?? null,
      labCode: cage.lab?.code ?? null,
      welfareFlags: Array.isArray(cage.welfareFlags) ? cage.welfareFlags.map((flag) => String(flag)) : [],
      cageNumber: cage.cageNumber,
      roomNumber: cage.room.roomNumber,
      rackNumber: cage.rack.rackNumber,
      notes: cage.notes ?? "",
      chargeCategoryId: cage.chargePeriods[0]?.category.id ?? null,
      chargeCategoryName: cage.chargePeriods[0]?.category.name ?? null,
      chargePeriodId: cage.chargePeriods[0]?.id ?? null,
      chargePeriodStartedAt: cage.chargePeriods[0]?.startedAt.toISOString() ?? null,
      dailyRateCents: cage.chargePeriods[0]?.dailyRateCents ?? null,
      currencyCode: cage.chargePeriods[0]?.currencyCode ?? null,
      chargeState: getCageChargeState(cage),
      closure: cage.closure
        ? {
            id: cage.closure.id,
            closedAt: cage.closure.closedAt.toISOString(),
            billingCutoffAt: cage.closure.billingCutoffAt.toISOString(),
            reason: cage.closure.reason,
            closedBy: cage.closure.closedBy?.name ?? cage.closure.closedBy?.email ?? "Legacy migration",
            chargePeriodId: cage.closure.chargePeriod.id,
            chargeCategoryName: cage.closure.chargePeriod.category.name,
            chargeCategoryCode: cage.closure.chargePeriod.category.code,
            dailyRateCents: cage.closure.chargePeriod.dailyRateCents,
            currencyCode: cage.closure.chargePeriod.currencyCode,
            chargePeriodStartedAt: cage.closure.chargePeriod.startedAt.toISOString(),
            chargePeriodEndedAt: cage.closure.chargePeriod.endedAt?.toISOString() ?? null,
          }
        : null,
      currentLocationLabel: buildLocationLabel({
        roomNumber: cage.room.roomNumber,
        rackNumber: cage.rack.rackNumber,
        cageNumber: cage.cageNumber,
      }),
    },
    closureCommandNonce: randomUUID(),
    occupants: scopedAnimals.map((animal) => ({
      id: animal.id,
      animalId: animal.animalId,
      labId: animal.labId,
      owningLabName: animal.owningLab?.name ?? null,
      sex: animal.sex,
      status: animal.status,
      healthStatus: animal.healthStatus ?? "Not recorded",
    })),
    notes: healthNotes.map((note) => ({
      id: note.id,
      note: note.note,
      createdAt: note.createdAt.toISOString(),
      attachments: note.attachments.map((attachment) => ({
        id: attachment.id,
        label: attachment.label,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
        storageUrl: attachment.storageUrl,
      })),
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
    chargeCategoryOptions,
    responsibility: {
      assignments: mapCageResponsibilities(cage.userAssignments),
      options: responsibilityOptions,
    },
    labOptions,
    alerts,
  };
}
