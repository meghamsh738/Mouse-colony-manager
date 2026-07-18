import { addDays, differenceInDays } from "date-fns";

import { normalizeUserRole } from "@/lib/capabilities";
import { buildLineFertilityAdjustment, parseStrainFertilityProfiles } from "@/lib/fertility-rules";
import { prisma } from "@/lib/prisma";
import { getActorLabAccess, type ActorLabAccess } from "@/lib/lab-access";
import type { ResolvedActor } from "@/lib/session";
import type { BreedingForecastItem, ForecastDemandItem, ForecastSummary, SurplusMinimizationView } from "@/lib/types";
import { formatDate, formatPercent } from "@/lib/utils";

export type ForecastFilters = {
  labId?: string;
  cageId?: string;
  responsibleUserId?: string;
};

type ForecastFilterOption = { id: string; label: string };

type ForecastScope = {
  access: ActorLabAccess;
  labIds: string[];
  cageIds: string[] | undefined;
  filters: Required<ForecastFilters>;
  invalid: boolean;
  options: {
    labs: ForecastFilterOption[];
    cages: ForecastFilterOption[];
    responsibleUsers: ForecastFilterOption[];
  };
};

function getReferenceDate() {
  return process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString();
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

function estimateProbability(targetGenotype: string, sireSummary: string, damSummary: string) {
  const tokens = targetGenotype
    .toLowerCase()
    .split(/[;,/]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  if (!tokens.length) {
    return 0.4;
  }

  const matched = tokens.filter(
    (token) => sireSummary.toLowerCase().includes(token) || damSummary.toLowerCase().includes(token),
  ).length;

  return Math.max(0.2, Math.min(0.85, 0.2 + matched * 0.15));
}

function buildWarnings(input: {
  sireAgeDays: number;
  damAgeDays: number;
  breederMaxAgeDays: number;
  latestLitterExists: boolean;
  nextLitterDate: Date;
  referenceDate: Date;
}) {
  const warnings: string[] = [];

  if (input.sireAgeDays > input.breederMaxAgeDays) {
    warnings.push("Sire is above the configured breeder age threshold");
  }

  if (input.damAgeDays > input.breederMaxAgeDays) {
    warnings.push("Dam is above the configured breeder age threshold");
  }

  if (!input.latestLitterExists) {
    warnings.push("No historical litter logged yet for this setup");
  }

  if (differenceInDays(input.nextLitterDate, input.referenceDate) < 0) {
    warnings.push("Projected next litter window is already overdue");
  }

  return warnings;
}

async function getForecastRuleContext() {
  const rules = await prisma.ruleConfig.findMany({
    where: {
      key: {
        in: [
          "breeder_max_age_days",
          "weaning_due_days",
          "forecast_long_range_horizon_days",
          "breeding_strain_fertility_profiles",
        ],
      },
    },
    select: {
      key: true,
      value: true,
    },
  });

  const values = new Map(rules.map((rule) => [rule.key, rule.value]));
  const getNumber = (key: string, fallback: number) => {
    const parsed = Number(values.get(key));

    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    breederMaxAgeDays: getNumber("breeder_max_age_days", 270),
    weaningDueDays: getNumber("weaning_due_days", 21),
    longRangeDemandHorizonDays: getNumber("forecast_long_range_horizon_days", 90),
    strainFertilityProfiles: parseStrainFertilityProfiles(values.get("breeding_strain_fertility_profiles")),
    today: getReferenceDate(),
  };
}

type ForecastRuleContext = Awaited<ReturnType<typeof getForecastRuleContext>>;

type ForecastAnimalStatusCount = {
  status: string;
  _count: {
    _all: number;
  };
};

type ForecastCalloutRow = BreedingForecastItem & {
  probabilityLabel: string;
  nextLitterLabel: string;
  readyLabel: string;
};

type SurplusMinimizationCalloutsView = Omit<SurplusMinimizationView, "demandItems"> & {
  demandItems: Array<ForecastDemandItem & { startLabel: string }>;
};

export type ForecastWorkspaceView = {
  summary: ForecastSummary;
  rows: ForecastCalloutRow[];
  surplus: SurplusMinimizationCalloutsView;
  longRange: SurplusMinimizationCalloutsView;
  partial: boolean;
  issues: string[];
  scope: Pick<ForecastScope, "filters" | "options" | "invalid">;
};

function getDefaultForecastRuleContext(): ForecastRuleContext {
  return {
    breederMaxAgeDays: 270,
    weaningDueDays: 21,
    longRangeDemandHorizonDays: 90,
    strainFertilityProfiles: parseStrainFertilityProfiles(undefined),
    today: getReferenceDate(),
  };
}

function getEmptySurplusMinimizationView(horizonDays: number): SurplusMinimizationView {
  return {
    horizonDays,
    demandAnimals: 0,
    availableSupply: 0,
    projectedUsableSupply: 0,
    projectedSurplusPups: 0,
    supplyGap: 0,
    surplusAfterDemand: 0,
    demandItems: [],
    recommendations: ["Forecast data is temporarily unavailable."],
  };
}

function getEmptyForecastSummary(longRangeHorizonDays: number): ForecastSummary {
  return {
    projectedPups30Days: 0,
    projectedExperimentReady45Days: 0,
    pendingDemand45Days: 0,
    projectedSurplus45Days: 0,
    supplyGap45Days: 0,
    longRangeHorizonDays,
    projectedExperimentReadyLongRangeDays: 0,
    pendingDemandLongRangeDays: 0,
    projectedSurplusLongRangeDays: 0,
    supplyGapLongRangeDays: 0,
    activeBreedingForecasts: 0,
    cryostorageBackups: 0,
    availableNow: 0,
    reservedPressure: 0,
  };
}

function logForecastReadError(label: string, error: unknown) {
  console.error(`[forecast] ${label} unavailable`, error);
}

async function safeForecastRead<T>(label: string, read: () => Promise<T>, fallback: T, issues: string[]) {
  try {
    return await read();
  } catch (error) {
    logForecastReadError(label, error);
    issues.push(`${label} unavailable`);
    return fallback;
  }
}

function normalizeFilters(filters: ForecastFilters = {}): Required<ForecastFilters> {
  return {
    labId: filters.labId?.trim() ?? "",
    cageId: filters.cageId?.trim() ?? "",
    responsibleUserId: filters.responsibleUserId?.trim() ?? "",
  };
}

function cageLabel(cage: {
  barcode: string;
  cageNumber: string;
  room: { roomNumber: string };
  rack: { rackNumber: string };
}) {
  return `${cage.barcode} · ${cage.room.roomNumber} / ${cage.rack.rackNumber} / ${cage.cageNumber}`;
}

async function resolveForecastScope(actor: ResolvedActor, requestedFilters: ForecastFilters = {}): Promise<ForecastScope> {
  const filters = normalizeFilters(requestedFilters);
  const currentUser = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { active: true, authzVersion: true, role: true },
  });
  if (
    !currentUser?.active
    || currentUser.authzVersion !== actor.authzVersion
    || normalizeUserRole(currentUser.role) !== actor.canonicalRole
    || !actor.capabilities.includes("forecast:read")
  ) {
    return {
      access: { canViewAll: false, memberLabIds: [], manageableLabIds: [], membershipByLabId: new Map() },
      labIds: [],
      cageIds: [],
      filters,
      invalid: true,
      options: { labs: [], cages: [], responsibleUsers: [] },
    };
  }

  const access = await getActorLabAccess(actor);
  const labs = await prisma.lab.findMany({
    where: {
      active: true,
      ...(access.canViewAll ? {} : { id: { in: access.memberLabIds } }),
    },
    orderBy: [{ name: "asc" }, { code: "asc" }],
    select: { id: true, name: true, code: true },
  });
  const labOptions = labs.map((lab) => ({ id: lab.id, label: `${lab.code} · ${lab.name}` }));
  const accessibleLabIds = labs.map((lab) => lab.id);
  const fixedLabId = access.canViewAll ? "" : accessibleLabIds[0] ?? "";
  const selectedLabId = access.canViewAll ? filters.labId : fixedLabId;
  let invalid = Boolean(
    (access.canViewAll && filters.labId && !accessibleLabIds.includes(filters.labId))
    || (!access.canViewAll && filters.labId && filters.labId !== fixedLabId),
  );
  const labIds = invalid ? [] : selectedLabId ? [selectedLabId] : accessibleLabIds;
  const cages = labIds.length
    ? await prisma.cage.findMany({
        where: { labId: { in: labIds }, active: true, status: { not: "closed" } },
        orderBy: [{ room: { roomNumber: "asc" } }, { rack: { rackNumber: "asc" } }, { cageNumber: "asc" }],
        select: {
          id: true,
          barcode: true,
          cageNumber: true,
          room: { select: { roomNumber: true } },
          rack: { select: { rackNumber: true } },
          userAssignments: {
            where: { endedAt: null, user: { active: true }, membership: { active: true } },
            orderBy: [{ user: { name: "asc" } }, { user: { email: "asc" } }],
            select: { userId: true, user: { select: { name: true, email: true } } },
          },
        },
      })
    : [];
  const cageOptions = cages.map((cage) => ({ id: cage.id, label: cageLabel(cage) }));
  const responsibleUserMap = new Map<string, string>();
  for (const cage of cages) {
    for (const assignment of cage.userAssignments) {
      responsibleUserMap.set(assignment.userId, `${assignment.user.name} · ${assignment.user.email}`);
    }
  }
  const responsibleUsers = [...responsibleUserMap]
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => left.label.localeCompare(right.label));

  const requestedCage = filters.cageId ? cages.find((cage) => cage.id === filters.cageId) : null;
  const responsibleUserValid = !filters.responsibleUserId || responsibleUserMap.has(filters.responsibleUserId);
  if ((filters.cageId && !requestedCage) || !responsibleUserValid) invalid = true;

  let cageIds: string[] | undefined;
  if (filters.responsibleUserId) {
    cageIds = cages
      .filter((cage) => cage.userAssignments.some((assignment) => assignment.userId === filters.responsibleUserId))
      .map((cage) => cage.id);
  }
  if (filters.cageId) {
    cageIds = cageIds === undefined
      ? (requestedCage ? [requestedCage.id] : [])
      : cageIds.filter((cageId) => cageId === filters.cageId);
  }
  if (invalid) cageIds = [];

  return {
    access,
    labIds,
    cageIds,
    filters: { ...filters, labId: access.canViewAll ? filters.labId : fixedLabId },
    invalid,
    options: { labs: labOptions, cages: cageOptions, responsibleUsers },
  };
}

function labFilter(scope: ForecastScope, field: "labId" | "owningLabId" = "labId") {
  return { [field]: { in: scope.labIds } };
}

function animalCageFilter(scope: ForecastScope) {
  return scope.cageIds === undefined ? {} : { currentCageId: { in: scope.cageIds } };
}

type ForecastCageContext = {
  id: string;
  barcode: string;
  cageNumber: string;
  room: { roomNumber: string };
  rack: { rackNumber: string };
  userAssignments: Array<{ userId: string; user: { name: string } }>;
};

const forecastCageSelect = {
  id: true,
  barcode: true,
  cageNumber: true,
  room: { select: { roomNumber: true } },
  rack: { select: { rackNumber: true } },
  userAssignments: {
    where: { endedAt: null, user: { active: true }, membership: { active: true } },
    select: { userId: true, user: { select: { name: true } } },
  },
} as const;

function collectCageContext(cages: Array<ForecastCageContext | null | undefined>) {
  const cageById = new Map(cages.filter((cage): cage is ForecastCageContext => Boolean(cage)).map((cage) => [cage.id, cage]));
  const responsibleUsers = new Map<string, string>();
  for (const cage of cageById.values()) {
    for (const assignment of cage.userAssignments) responsibleUsers.set(assignment.userId, assignment.user.name);
  }

  return {
    cageIds: [...cageById.keys()],
    cageLabels: [...cageById.values()].map(cageLabel),
    responsibleUserIds: [...responsibleUsers.keys()],
    responsibleUserNames: [...responsibleUsers.values()],
  };
}

function buildForecastCallouts(rows: BreedingForecastItem[]): ForecastCalloutRow[] {
  return rows.map((row) => ({
    ...row,
    probabilityLabel: formatPercent(row.expectedProbability),
    nextLitterLabel: formatDate(row.projectedNextLitterDate),
    readyLabel: formatDate(row.projectedExperimentReadyDate),
  }));
}

function buildSurplusMinimizationCallouts(view: SurplusMinimizationView): SurplusMinimizationCalloutsView {
  return {
    ...view,
    demandItems: view.demandItems.map((item) => ({
      ...item,
      startLabel: formatDate(item.startDate),
    })),
  };
}

async function getBreedingForecastRows(rules: ForecastRuleContext, scope: ForecastScope): Promise<BreedingForecastItem[]> {
  const referenceDate = new Date(rules.today);
  const activeBreedings = await prisma.breedingSetup.findMany({
    where: {
      status: "active",
      ...labFilter(scope),
      ...(scope.cageIds === undefined
        ? {}
        : { adults: { some: { animal: { currentCageId: { in: scope.cageIds } } } } }),
    },
    orderBy: [{ startDate: "desc" }, { id: "asc" }],
    include: {
      lab: { select: { id: true, name: true, code: true } },
      adults: {
        where: { animal: { owningLabId: { in: scope.labIds } } },
        include: {
          animal: {
            select: {
              id: true,
              animalId: true,
              dob: true,
              strainId: true,
              strain: { select: { name: true } },
              currentCage: { select: forecastCageSelect },
              alleles: {
                include: {
                  allele: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      litters: {
        orderBy: [{ birthDate: "desc" }, { id: "desc" }],
        select: {
          id: true,
          birthDate: true,
          litterSizeBirth: true,
          litterSizeWean: true,
        },
      },
    },
  });

  return activeBreedings.map((breeding) => {
    const sire = breeding.adults.find((adult) => adult.role === "sire")?.animal ?? null;
    const dam = breeding.adults.find((adult) => adult.role === "dam")?.animal ?? null;
    const latestLitter = breeding.litters[0] ?? null;
    const sireSummary = sire ? buildGenotypeSummary(sire.alleles) : "Genotype not recorded";
    const damSummary = dam ? buildGenotypeSummary(dam.alleles) : "Genotype not recorded";
    const lineFertility =
      sire && dam
        ? buildLineFertilityAdjustment(sire, dam, rules.strainFertilityProfiles)
        : {
            litterSizeMultiplier: 1,
            probabilityMultiplier: 1,
            surplusPenaltyMultiplier: 1,
            summary: "No line-specific fertility adjustment",
            notes: [],
          };
    const expectedProbability = Number(
      Math.max(0.1, Math.min(0.95, estimateProbability(breeding.targetGenotype, sireSummary, damSummary) * lineFertility.probabilityMultiplier)).toFixed(2),
    );
    const expectedLitterSize = Number(Math.max(1, (latestLitter?.litterSizeBirth ?? 6) * lineFertility.litterSizeMultiplier).toFixed(1));
    const expectedUsablePups = Math.max(1, Number((expectedLitterSize * expectedProbability).toFixed(1)));
    const expectedSurplusPups = Number(Math.max(0, expectedLitterSize - expectedUsablePups).toFixed(1));
    const projectedNextLitterDate = latestLitter ? addDays(latestLitter.birthDate, 28) : addDays(breeding.startDate, 28);
    const projectedExperimentReadyDate = addDays(projectedNextLitterDate, rules.weaningDueDays + 21);
    const sireAgeDays = sire ? differenceInDays(referenceDate, sire.dob) : 0;
    const damAgeDays = dam ? differenceInDays(referenceDate, dam.dob) : 0;
    const cageContext = collectCageContext([sire?.currentCage, dam?.currentCage]);

    return {
      id: breeding.id,
      labId: breeding.lab.id,
      labLabel: `${breeding.lab.code} · ${breeding.lab.name}`,
      pairLabel: `${sire?.animalId ?? "Unknown sire"} x ${dam?.animalId ?? "Unknown dam"}`,
      ...cageContext,
      targetGenotype: breeding.targetGenotype,
      projectedNextLitterDate: projectedNextLitterDate.toISOString(),
      projectedExperimentReadyDate: projectedExperimentReadyDate.toISOString(),
      expectedLitterSize,
      expectedUsablePups,
      expectedSurplusPups,
      expectedProbability,
      warnings: [
        ...buildWarnings({
          sireAgeDays,
          damAgeDays,
          breederMaxAgeDays: rules.breederMaxAgeDays,
          latestLitterExists: Boolean(latestLitter),
          nextLitterDate: projectedNextLitterDate,
          referenceDate,
        }),
        ...lineFertility.notes.map((note) => `Line fertility note: ${note}`),
        ...(expectedSurplusPups >= 4 ? [`Projected surplus risk of ${expectedSurplusPups} pups from this litter`] : []),
      ],
      lineFertilitySummary: lineFertility.summary,
    };
  });
}

export async function getBreedingForecastView(
  actor: ResolvedActor,
  filters: ForecastFilters = {},
): Promise<BreedingForecastItem[]> {
  const scope = await resolveForecastScope(actor, filters);
  return getBreedingForecastRows(await getForecastRuleContext(), scope);
}

function summarizeDemandItems(items: ForecastDemandItem[], availableSupply: number) {
  let remainingSupply = availableSupply;

  return items.map((item) => {
    const covered = Math.min(item.requestedAnimals, remainingSupply);
    remainingSupply -= covered;

    return {
      ...item,
      supplyGap: Math.max(0, item.requestedAnimals - covered),
    };
  });
}

function buildSurplusRecommendations(input: {
  demandAnimals: number;
  projectedUsableSupply: number;
  projectedSurplusPups: number;
  supplyGap: number;
  surplusAfterDemand: number;
}) {
  const recommendations: string[] = [];

  if (input.supplyGap > 0) {
    recommendations.push(`Demand exceeds forecast supply by ${input.supplyGap} animals; consider one additional high-probability breeding or cryostorage recovery.`);
  }

  if (input.surplusAfterDemand > 0) {
    recommendations.push(`Forecast supply exceeds planned demand by ${input.surplusAfterDemand} animals; pause low-priority pairings before creating avoidable surplus.`);
  }

  if (input.projectedSurplusPups > input.projectedUsableSupply * 0.5) {
    recommendations.push("Projected unusable genotype surplus is high relative to usable output; prefer crosses with higher target probability.");
  }

  if (!recommendations.length) {
    recommendations.push("Current planned demand and projected usable supply are balanced within the forecast horizon.");
  }

  return recommendations;
}

async function buildSurplusMinimizationView(input: {
  rules: ForecastRuleContext;
  forecastRows: BreedingForecastItem[];
  horizonDays: number;
  scope: ForecastScope;
}): Promise<SurplusMinimizationView> {
  const { forecastRows, horizonDays, rules, scope } = input;
  const referenceDate = new Date(rules.today);
  const horizonDate = addDays(referenceDate, horizonDays);
  const [availableNow, experiments] = await Promise.all([
    prisma.animal.count({
      where: {
        outcomeStatus: "alive",
        status: "colony_holding",
        ...labFilter(scope, "owningLabId"),
        ...animalCageFilter(scope),
      },
    }),
    prisma.experiment.findMany({
      where: {
        status: { in: ["planned", "active"] },
        ...labFilter(scope),
        assignments: {
          some: {
            status: { in: ["planned", "reserved", "active"] },
            startDate: { lte: horizonDate },
            ...(scope.cageIds === undefined ? {} : { animal: { currentCageId: { in: scope.cageIds } } }),
          },
        },
      },
      orderBy: [{ status: "asc" }, { experimentCode: "asc" }],
      include: {
        project: { select: { projectCode: true } },
        lab: { select: { id: true, name: true, code: true } },
        assignments: {
          where: {
            status: { in: ["planned", "reserved", "active"] },
            startDate: { lte: horizonDate },
            ...(scope.cageIds === undefined ? {} : { animal: { currentCageId: { in: scope.cageIds } } }),
          },
          select: {
            status: true,
            startDate: true,
            animal: { select: { currentCage: { select: forecastCageSelect } } },
          },
        },
      },
    }),
  ]);

  const projectedRows = forecastRows.filter(
    (row) => differenceInDays(new Date(row.projectedExperimentReadyDate), referenceDate) <= horizonDays,
  );
  const projectedUsableSupply = Math.round(projectedRows.reduce((sum, row) => sum + row.expectedUsablePups, 0));
  const projectedSurplusPups = Number(projectedRows.reduce((sum, row) => sum + row.expectedSurplusPups, 0).toFixed(1));
  const availableSupply = availableNow + projectedUsableSupply;
  const rawDemandItems: ForecastDemandItem[] = experiments.map((experiment) => {
    const plannedAnimals = experiment.assignments.filter((assignment) => assignment.status === "planned").length;
    const reservedAnimals = experiment.assignments.filter((assignment) => assignment.status === "reserved").length;
    const activeAnimals = experiment.assignments.filter((assignment) => assignment.status === "active").length;
    const earliestStart = [...experiment.assignments].sort((left, right) => left.startDate.getTime() - right.startDate.getTime())[0]?.startDate;
    const cageContext = collectCageContext(experiment.assignments.map((assignment) => assignment.animal.currentCage));

    return {
      experimentId: experiment.id,
      labId: experiment.lab.id,
      labLabel: `${experiment.lab.code} · ${experiment.lab.name}`,
      experimentCode: experiment.experimentCode,
      projectCode: experiment.project.projectCode,
      title: experiment.title,
      startDate: earliestStart?.toISOString() ?? referenceDate.toISOString(),
      requestedAnimals: plannedAnimals + reservedAnimals,
      plannedAnimals,
      reservedAnimals,
      activeAnimals,
      supplyGap: 0,
      ...cageContext,
    };
  });
  const demandItems = summarizeDemandItems(rawDemandItems, availableSupply);
  const demandAnimals = rawDemandItems.reduce((sum, item) => sum + item.requestedAnimals, 0);
  const supplyGap = Math.max(0, demandAnimals - availableSupply);
  const surplusAfterDemand = Math.max(0, availableSupply - demandAnimals);

  return {
    horizonDays,
    demandAnimals,
    availableSupply,
    projectedUsableSupply,
    projectedSurplusPups,
    supplyGap,
    surplusAfterDemand,
    demandItems,
    recommendations: buildSurplusRecommendations({
      demandAnimals,
      projectedUsableSupply,
      projectedSurplusPups,
      supplyGap,
      surplusAfterDemand,
    }),
  };
}

export async function getSurplusMinimizationView(
  actor: ResolvedActor,
  requestedHorizonDays = 45,
  filters: ForecastFilters = {},
): Promise<SurplusMinimizationView> {
  const horizonDays = requestedHorizonDays;
  const scope = await resolveForecastScope(actor, filters);
  const rules = await getForecastRuleContext();
  const forecastRows = await getBreedingForecastRows(rules, scope);

  return buildSurplusMinimizationView({ rules, forecastRows, horizonDays, scope });
}

async function getForecastInventoryCounts(scope: ForecastScope): Promise<{
  cryostorageCount: number;
  animalCounts: ForecastAnimalStatusCount[];
}> {
  try {
    const [cryostorageCount, animalCounts] = await Promise.all([
      scope.cageIds === undefined
        ? prisma.cryostorageRecord.count({
            where: {
              status: { in: ["stored", "reserved"] },
              ...labFilter(scope),
            },
          })
        : Promise.resolve(0),
      prisma.animal.groupBy({
        by: ["status"],
        where: {
          outcomeStatus: "alive",
          ...labFilter(scope, "owningLabId"),
          ...animalCageFilter(scope),
        },
        _count: {
          _all: true,
        },
      }),
    ]);

    return { cryostorageCount, animalCounts };
  } catch (error) {
    logForecastReadError("inventory counts", error);

    return { cryostorageCount: 0, animalCounts: [] };
  }
}

async function buildForecastSummaryView(input: {
  rules: ForecastRuleContext;
  forecastRows: BreedingForecastItem[];
  surplusView: SurplusMinimizationView;
  longRangeView: SurplusMinimizationView;
  scope: ForecastScope;
}): Promise<ForecastSummary> {
  const { forecastRows, longRangeView, rules, scope, surplusView } = input;
  const referenceDate = new Date(rules.today);
  const { animalCounts, cryostorageCount } = await getForecastInventoryCounts(scope);

  return {
    projectedPups30Days: Math.round(
      forecastRows
        .filter((row) => differenceInDays(new Date(row.projectedNextLitterDate), referenceDate) <= 30)
        .reduce((sum, row) => sum + row.expectedLitterSize, 0),
    ),
    projectedExperimentReady45Days: Math.round(
      forecastRows
        .filter((row) => differenceInDays(new Date(row.projectedExperimentReadyDate), referenceDate) <= 45)
        .reduce((sum, row) => sum + row.expectedUsablePups, 0),
    ),
    pendingDemand45Days: surplusView.demandAnimals,
    projectedSurplus45Days: Math.round(surplusView.projectedSurplusPups),
    supplyGap45Days: surplusView.supplyGap,
    longRangeHorizonDays: rules.longRangeDemandHorizonDays,
    projectedExperimentReadyLongRangeDays: Math.round(
      forecastRows
        .filter((row) => differenceInDays(new Date(row.projectedExperimentReadyDate), referenceDate) <= rules.longRangeDemandHorizonDays)
        .reduce((sum, row) => sum + row.expectedUsablePups, 0),
    ),
    pendingDemandLongRangeDays: longRangeView.demandAnimals,
    projectedSurplusLongRangeDays: Math.round(longRangeView.projectedSurplusPups),
    supplyGapLongRangeDays: longRangeView.supplyGap,
    activeBreedingForecasts: forecastRows.length,
    cryostorageBackups: cryostorageCount,
    availableNow: animalCounts.find((item) => item.status === "colony_holding")?._count._all ?? 0,
    reservedPressure: animalCounts.find((item) => item.status === "reserved")?._count._all ?? 0,
  };
}

export async function getForecastSummaryView(
  actor: ResolvedActor,
  filters: ForecastFilters = {},
): Promise<ForecastSummary> {
  const scope = await resolveForecastScope(actor, filters);
  const rules = await getForecastRuleContext();
  const forecastRows = await getBreedingForecastRows(rules, scope);
  const [surplusView, longRangeView] = await Promise.all([
    buildSurplusMinimizationView({ rules, forecastRows, horizonDays: 45, scope }),
    buildSurplusMinimizationView({ rules, forecastRows, horizonDays: rules.longRangeDemandHorizonDays, scope }),
  ]);

  return buildForecastSummaryView({ rules, forecastRows, surplusView, longRangeView, scope });
}

export async function getForecastCalloutsView(actor: ResolvedActor, filters: ForecastFilters = {}) {
  return buildForecastCallouts(await getBreedingForecastView(actor, filters));
}

export async function getSurplusMinimizationCalloutsView(
  actor: ResolvedActor,
  requestedHorizonDays = 45,
  filters: ForecastFilters = {},
) {
  return buildSurplusMinimizationCallouts(await getSurplusMinimizationView(actor, requestedHorizonDays, filters));
}

export async function getLongRangeDemandCalloutsView(actor: ResolvedActor, filters: ForecastFilters = {}) {
  const rules = await getForecastRuleContext();

  return getSurplusMinimizationCalloutsView(actor, rules.longRangeDemandHorizonDays, filters);
}

export async function getForecastWorkspaceView(
  actor: ResolvedActor,
  filters: ForecastFilters = {},
): Promise<ForecastWorkspaceView> {
  const issues: string[] = [];
  const scope = await resolveForecastScope(actor, filters);
  const rules = await safeForecastRead("forecast rules", getForecastRuleContext, getDefaultForecastRuleContext(), issues);
  const forecastRows = await safeForecastRead("breeding forecast", () => getBreedingForecastRows(rules, scope), [], issues);
  const surplusView = await safeForecastRead(
    "45-day demand",
    () => buildSurplusMinimizationView({ rules, forecastRows, horizonDays: 45, scope }),
    getEmptySurplusMinimizationView(45),
    issues,
  );
  const longRangeView = await safeForecastRead(
    `${rules.longRangeDemandHorizonDays}-day demand`,
    () => buildSurplusMinimizationView({ rules, forecastRows, horizonDays: rules.longRangeDemandHorizonDays, scope }),
    getEmptySurplusMinimizationView(rules.longRangeDemandHorizonDays),
    issues,
  );
  const summary = await safeForecastRead(
    "forecast summary",
    () => buildForecastSummaryView({ rules, forecastRows, surplusView, longRangeView, scope }),
    getEmptyForecastSummary(rules.longRangeDemandHorizonDays),
    issues,
  );

  return {
    summary,
    rows: buildForecastCallouts(forecastRows),
    surplus: buildSurplusMinimizationCallouts(surplusView),
    longRange: buildSurplusMinimizationCallouts(longRangeView),
    partial: issues.length > 0,
    issues,
    scope: { filters: scope.filters, options: scope.options, invalid: scope.invalid },
  };
}
