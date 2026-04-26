import { addDays, differenceInDays, format } from "date-fns";

import { prisma } from "@/lib/prisma";
import type { BreedingForecastItem, ForecastDemandItem, ForecastSummary, SurplusMinimizationView } from "@/lib/types";
import { formatPercent } from "@/lib/utils";

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
      key: { in: ["breeder_max_age_days", "weaning_due_days"] },
    },
    select: {
      key: true,
      value: true,
    },
  });

  const values = new Map(rules.map((rule) => [rule.key, Number(rule.value)]));

  return {
    breederMaxAgeDays: values.get("breeder_max_age_days") ?? 270,
    weaningDueDays: values.get("weaning_due_days") ?? 21,
    today: getReferenceDate(),
  };
}

export async function getBreedingForecastView(): Promise<BreedingForecastItem[]> {
  const rules = await getForecastRuleContext();
  const referenceDate = new Date(rules.today);
  const activeBreedings = await prisma.breedingSetup.findMany({
    where: { status: "active" },
    orderBy: [{ startDate: "desc" }, { id: "asc" }],
    include: {
      adults: {
        include: {
          animal: {
            select: {
              id: true,
              animalId: true,
              dob: true,
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
    const expectedProbability = estimateProbability(breeding.targetGenotype, sireSummary, damSummary);
    const expectedLitterSize = latestLitter?.litterSizeBirth ?? 6;
    const expectedUsablePups = Math.max(1, Number((expectedLitterSize * expectedProbability).toFixed(1)));
    const expectedSurplusPups = Number(Math.max(0, expectedLitterSize - expectedUsablePups).toFixed(1));
    const projectedNextLitterDate = latestLitter ? addDays(latestLitter.birthDate, 28) : addDays(breeding.startDate, 28);
    const projectedExperimentReadyDate = addDays(projectedNextLitterDate, rules.weaningDueDays + 21);
    const sireAgeDays = sire ? differenceInDays(referenceDate, sire.dob) : 0;
    const damAgeDays = dam ? differenceInDays(referenceDate, dam.dob) : 0;

    return {
      id: breeding.id,
      pairLabel: `${sire?.animalId ?? "Unknown sire"} x ${dam?.animalId ?? "Unknown dam"}`,
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
        ...(expectedSurplusPups >= 4 ? [`Projected surplus risk of ${expectedSurplusPups} pups from this litter`] : []),
      ],
    };
  });
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

export async function getSurplusMinimizationView(horizonDays = 45): Promise<SurplusMinimizationView> {
  const rules = await getForecastRuleContext();
  const referenceDate = new Date(rules.today);
  const horizonDate = addDays(referenceDate, horizonDays);
  const [forecastRows, availableNow, experiments] = await Promise.all([
    getBreedingForecastView(),
    prisma.animal.count({
      where: {
        outcomeStatus: "alive",
        status: "colony_holding",
      },
    }),
    prisma.experiment.findMany({
      where: {
        status: { in: ["planned", "active"] },
        assignments: {
          some: {
            status: { in: ["planned", "reserved", "active"] },
            startDate: { lte: horizonDate },
          },
        },
      },
      orderBy: [{ status: "asc" }, { experimentCode: "asc" }],
      include: {
        project: { select: { projectCode: true } },
        assignments: {
          where: {
            status: { in: ["planned", "reserved", "active"] },
            startDate: { lte: horizonDate },
          },
          select: {
            status: true,
            startDate: true,
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

    return {
      experimentId: experiment.id,
      experimentCode: experiment.experimentCode,
      projectCode: experiment.project.projectCode,
      title: experiment.title,
      startDate: earliestStart?.toISOString() ?? referenceDate.toISOString(),
      requestedAnimals: plannedAnimals + reservedAnimals,
      plannedAnimals,
      reservedAnimals,
      activeAnimals,
      supplyGap: 0,
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

export async function getForecastSummaryView(): Promise<ForecastSummary> {
  const rules = await getForecastRuleContext();
  const referenceDate = new Date(rules.today);
  const [forecastRows, surplusView, cryostorageCount, animalCounts] = await Promise.all([
    getBreedingForecastView(),
    getSurplusMinimizationView(),
    prisma.cryostorageRecord.count({
      where: {
        status: { in: ["stored", "reserved"] },
      },
    }),
    prisma.animal.groupBy({
      by: ["status"],
      where: {
        outcomeStatus: "alive",
      },
      _count: {
        _all: true,
      },
    }),
  ]);

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
    activeBreedingForecasts: forecastRows.length,
    cryostorageBackups: cryostorageCount,
    availableNow: animalCounts.find((item) => item.status === "colony_holding")?._count._all ?? 0,
    reservedPressure: animalCounts.find((item) => item.status === "reserved")?._count._all ?? 0,
  };
}

export async function getForecastCalloutsView() {
  const rows = await getBreedingForecastView();

  return rows.map((row) => ({
    ...row,
    probabilityLabel: formatPercent(row.expectedProbability),
    nextLitterLabel: format(new Date(row.projectedNextLitterDate), "dd MMM yyyy"),
    readyLabel: format(new Date(row.projectedExperimentReadyDate), "dd MMM yyyy"),
  }));
}

export async function getSurplusMinimizationCalloutsView() {
  const view = await getSurplusMinimizationView();

  return {
    ...view,
    demandItems: view.demandItems.map((item) => ({
      ...item,
      startLabel: format(new Date(item.startDate), "dd MMM yyyy"),
    })),
  };
}
