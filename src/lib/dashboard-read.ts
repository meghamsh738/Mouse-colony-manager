import { compareDesc, differenceInDays, format } from "date-fns";

import { getAnimalListView } from "@/lib/animals-read";
import { getBreedingSuggestionSummaryView } from "@/lib/breeding-read";
import { prisma } from "@/lib/prisma";
import type { Alert } from "@/lib/types";
import { formatAgeLabel } from "@/lib/utils";

type DashboardRuleContext = {
  breederMaxAgeDays: number;
  breederMinAgeDays: number;
  breedingDurationMaxDays: number;
  weaningDueDays: number;
  genotypePendingDays: number;
  cageMaxOccupancy: number;
  mixedSexHoldingAllowed: boolean;
  reservationStartGraceDays: number;
  projectAssignmentRequiredDays: number;
  today: string;
};

function getReferenceDate() {
  return process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString();
}

function getAgeDays(dob: Date, referenceDate: string) {
  return differenceInDays(new Date(referenceDate), dob);
}

function buildCageLabel(
  cage?:
    | {
        cageNumber: string;
        room: { roomNumber: string };
        rack: { rackNumber: string };
      }
    | null
    | undefined,
) {
  if (!cage) {
    return "Archived";
  }

  return `${cage.room.roomNumber} / ${cage.rack.rackNumber} / ${cage.cageNumber}`;
}

async function getDashboardRuleContext(): Promise<DashboardRuleContext> {
  const keys = [
    "breeder_max_age_days",
    "breeder_min_age_days",
    "breeding_duration_max_days",
    "weaning_due_days",
    "genotype_pending_days",
    "cage_max_occupancy",
    "mixed_sex_holding_allowed",
    "reservation_start_grace_days",
    "project_assignment_required_days",
  ];
  const rules = await prisma.ruleConfig.findMany({
    where: {
      key: { in: keys },
    },
    select: {
      key: true,
      value: true,
    },
  });

  const values = new Map(rules.map((rule) => [rule.key, rule.value]));

  return {
    breederMaxAgeDays: Number(values.get("breeder_max_age_days") ?? 0),
    breederMinAgeDays: Number(values.get("breeder_min_age_days") ?? 0),
    breedingDurationMaxDays: Number(values.get("breeding_duration_max_days") ?? 0),
    weaningDueDays: Number(values.get("weaning_due_days") ?? 0),
    genotypePendingDays: Number(values.get("genotype_pending_days") ?? 0),
    cageMaxOccupancy: Number(values.get("cage_max_occupancy") ?? 0),
    mixedSexHoldingAllowed: Boolean(values.get("mixed_sex_holding_allowed") ?? false),
    reservationStartGraceDays: Number(values.get("reservation_start_grace_days") ?? 0),
    projectAssignmentRequiredDays: Number(values.get("project_assignment_required_days") ?? 0),
    today: getReferenceDate(),
  };
}

async function getDashboardData() {
  const rules = await getDashboardRuleContext();
  const [animals, breedings, litters, cages, assignments, manualAlerts] = await prisma.$transaction([
    prisma.animal.findMany({
      where: {
        outcomeStatus: "alive",
      },
      orderBy: { animalId: "asc" },
      include: {
        currentCage: {
          include: {
            room: { select: { roomNumber: true } },
            rack: { select: { rackNumber: true } },
          },
        },
        alleles: {
          select: {
            zygosity: true,
          },
        },
        healthNotes: {
          where: {
            resolved: false,
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            note: true,
            severity: true,
            followupRequired: true,
            createdAt: true,
          },
        },
        genotypingRecords: {
          orderBy: { sampleDate: "desc" },
          select: {
            sampleDate: true,
            status: true,
          },
        },
        projectAllocations: {
          where: { endedAt: null },
          select: {
            id: true,
          },
        },
      },
    }),
    prisma.breedingSetup.findMany({
      where: { status: "active" },
      select: {
        id: true,
        startDate: true,
      },
    }),
    prisma.litter.findMany({
      where: { litterSizeWean: null },
      select: {
        id: true,
        birthDate: true,
        breedingSetupId: true,
      },
    }),
    prisma.cage.findMany({
      orderBy: [{ room: { roomNumber: "asc" } }, { rack: { rackNumber: "asc" } }, { cageNumber: "asc" }],
      include: {
        room: { select: { roomNumber: true } },
        rack: { select: { rackNumber: true } },
        animals: {
          where: { outcomeStatus: "alive" },
          select: {
            sex: true,
          },
        },
        healthNotes: {
          where: { resolved: false },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            note: true,
            severity: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.experimentAssignment.findMany({
      where: { status: "reserved" },
      include: {
        experiment: { select: { experimentCode: true } },
        animal: { select: { animalId: true } },
      },
    }),
    prisma.alert.findMany({
      where: { status: "open" },
      orderBy: { generatedAt: "desc" },
    }),
  ]);

  const ruleAlerts: Alert[] = [];

  for (const animal of animals) {
    const ageDays = getAgeDays(animal.dob, rules.today);
    const unresolvedHealthNote = animal.healthNotes.find((note) => note.followupRequired);
    const pendingRecord = animal.genotypingRecords.find((record) => record.status === "pending");

    if (animal.status === "breeding" && ageDays > rules.breederMaxAgeDays) {
      ruleAlerts.push({
        id: `rule-breeder-old-${animal.id}`,
        entityType: "animal",
        entityId: animal.id,
        alertType: "breeder_too_old",
        severity: "warning",
        message: `${animal.animalId} is ${ageDays} days old and above the breeder age preference.`,
        status: "open",
        generatedAt: rules.today,
        source: "rule",
      });
    }

    if (animal.status === "breeding" && ageDays < rules.breederMinAgeDays) {
      ruleAlerts.push({
        id: `rule-breeder-young-${animal.id}`,
        entityType: "animal",
        entityId: animal.id,
        alertType: "breeder_too_young",
        severity: "critical",
        message: `${animal.animalId} is not yet old enough for breeding under the configured threshold.`,
        status: "open",
        generatedAt: rules.today,
        source: "rule",
      });
    }

    if (pendingRecord && differenceInDays(new Date(rules.today), pendingRecord.sampleDate) > rules.genotypePendingDays) {
      ruleAlerts.push({
        id: `rule-genotype-pending-${animal.id}`,
        entityType: "animal",
        entityId: animal.id,
        alertType: "genotype_pending",
        severity: "warning",
        message: `${animal.animalId} still has a pending genotype result beyond the configured threshold.`,
        status: "open",
        generatedAt: rules.today,
        source: "rule",
      });
    }

    if (animal.status === "colony_holding" && ageDays > rules.projectAssignmentRequiredDays && animal.projectAllocations.length === 0) {
      ruleAlerts.push({
        id: `rule-project-missing-${animal.id}`,
        entityType: "animal",
        entityId: animal.id,
        alertType: "project_missing",
        severity: "info",
        message: `${animal.animalId} is older than the project assignment threshold without an active allocation.`,
        status: "open",
        generatedAt: rules.today,
        source: "rule",
      });
    }

    if (unresolvedHealthNote) {
      ruleAlerts.push({
        id: `rule-health-followup-${animal.id}`,
        entityType: "animal",
        entityId: animal.id,
        alertType: "health_followup",
        severity: unresolvedHealthNote.severity,
        message: `${animal.animalId} has an unresolved follow-up note: ${unresolvedHealthNote.note}`,
        status: "open",
        generatedAt: unresolvedHealthNote.createdAt.toISOString(),
        source: "rule",
      });
    }
  }

  for (const breeding of breedings) {
    if (differenceInDays(new Date(rules.today), breeding.startDate) > rules.breedingDurationMaxDays) {
      ruleAlerts.push({
        id: `rule-breeding-duration-${breeding.id}`,
        entityType: "cage",
        entityId: breeding.id,
        alertType: "breeding_duration",
        severity: "warning",
        message: `${breeding.id} has been active beyond the configured breeding duration window.`,
        status: "open",
        generatedAt: rules.today,
        source: "rule",
      });
    }
  }

  for (const litter of litters) {
    const litterAge = differenceInDays(new Date(rules.today), litter.birthDate);

    if (litterAge > rules.weaningDueDays) {
      ruleAlerts.push({
        id: `rule-weaning-${litter.id}`,
        entityType: "litter",
        entityId: litter.id,
        alertType: "weaning_due",
        severity: "warning",
        message: `${litter.id} is ${litterAge} days old and still has no recorded weaning outcome.`,
        status: "open",
        generatedAt: rules.today,
        source: "rule",
      });
    }
  }

  for (const cage of cages) {
    const sexes = new Set(cage.animals.map((animal) => animal.sex));

    if (cage.animals.length > rules.cageMaxOccupancy) {
      ruleAlerts.push({
        id: `rule-cage-capacity-${cage.id}`,
        entityType: "cage",
        entityId: cage.id,
        alertType: "cage_overcapacity",
        severity: "critical",
        message: `${buildCageLabel(cage)} holds ${cage.animals.length} active animals, above the configured occupancy limit.`,
        status: "open",
        generatedAt: rules.today,
        source: "rule",
      });
    }

    if (!rules.mixedSexHoldingAllowed && cage.status !== "breeding" && sexes.has("male") && sexes.has("female")) {
      ruleAlerts.push({
        id: `rule-mixed-sex-${cage.id}`,
        entityType: "cage",
        entityId: cage.id,
        alertType: "mixed_sex_holding",
        severity: "critical",
        message: `${buildCageLabel(cage)} is a non-breeding cage holding mixed-sex occupants.`,
        status: "open",
        generatedAt: rules.today,
        source: "rule",
      });
    }

    for (const note of cage.healthNotes) {
      ruleAlerts.push({
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
    }
  }

  for (const assignment of assignments) {
    if (differenceInDays(new Date(rules.today), assignment.startDate) > rules.reservationStartGraceDays) {
      ruleAlerts.push({
        id: `rule-reserved-stale-${assignment.id}`,
        entityType: "experiment",
        entityId: assignment.experimentId,
        alertType: "reserved_not_started",
        severity: "warning",
        message: `${assignment.animal.animalId} has been reserved for ${assignment.experiment.experimentCode} without starting.`,
        status: "open",
        generatedAt: rules.today,
        source: "rule",
      });
    }
  }

  const normalizedManualAlerts: Alert[] = manualAlerts.map((alert) => ({
    id: alert.id,
    entityType: alert.entityType as Alert["entityType"],
    entityId: alert.entityId,
    alertType: alert.alertType,
    severity: alert.severity,
    message: alert.message,
    status: alert.status,
    generatedAt: alert.generatedAt.toISOString(),
    resolvedAt: alert.resolvedAt?.toISOString(),
    source: (alert.source as "manual" | "rule") ?? "manual",
  }));

  return {
    rules,
    animals,
    litters,
    alerts: [...normalizedManualAlerts, ...ruleAlerts].sort((left, right) =>
      compareDesc(new Date(left.generatedAt), new Date(right.generatedAt)),
    ),
  };
}

export async function getDashboardMetricsView() {
  const { rules, animals, alerts } = await getDashboardData();
  const availableForExperiment = (await getAnimalListView()).filter((animal) => animal.availableForExperiment).length;

  return {
    activeAnimals: animals.length,
    activeBreeders: animals.filter((animal) => animal.status === "breeding").length,
    pendingGenotypes: animals.filter((animal) => animal.genotypingRecords.some((record) => record.status === "pending")).length,
    availableForExperiment,
    openAlerts: alerts.filter((alert) => alert.status === "open").length,
    oldBreeders: animals.filter(
      (animal) => animal.status === "breeding" && getAgeDays(animal.dob, rules.today) > rules.breederMaxAgeDays,
    ).length,
  };
}

export async function getColonyCompositionView() {
  const { animals } = await getDashboardData();

  return {
    males: animals.filter((animal) => animal.sex === "male").length,
    females: animals.filter((animal) => animal.sex === "female").length,
    breeding: animals.filter((animal) => animal.status === "breeding").length,
    transgenic: animals.filter((animal) => animal.alleles.some((allele) => allele.zygosity !== "WT/WT")).length,
  };
}

export async function getDashboardHighlightsView() {
  const { rules, animals, litters, alerts } = await getDashboardData();

  return {
    upcomingWean: litters.map((litter) => ({
      litterId: litter.id,
      dueDate: format(new Date(litter.birthDate.getTime() + rules.weaningDueDays * 86_400_000), "dd MMM yyyy"),
      breedingId: litter.breedingSetupId,
    })),
    breeders: animals
      .filter((animal) => animal.status === "breeding")
      .map((animal) => ({
        animalId: animal.animalId,
        ageLabel: formatAgeLabel(getAgeDays(animal.dob, rules.today)),
        cageLabel: buildCageLabel(animal.currentCage),
      })),
    alerts: alerts.slice(0, 6),
  };
}

export async function getDashboardAlertsView() {
  const { alerts } = await getDashboardData();

  return alerts;
}

export async function getDashboardOpenAlertCount() {
  const metrics = await getDashboardMetricsView();

  return metrics.openAlerts;
}

export { getBreedingSuggestionSummaryView };
