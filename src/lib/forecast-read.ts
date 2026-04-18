import { addDays, differenceInDays, format } from "date-fns";

import { prisma } from "@/lib/prisma";
import type { BreedingForecastItem, ForecastSummary } from "@/lib/types";
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
      expectedUsablePups: Math.max(1, Number((expectedLitterSize * expectedProbability).toFixed(1))),
      expectedProbability,
      warnings: buildWarnings({
        sireAgeDays,
        damAgeDays,
        breederMaxAgeDays: rules.breederMaxAgeDays,
        latestLitterExists: Boolean(latestLitter),
        nextLitterDate: projectedNextLitterDate,
        referenceDate,
      }),
    };
  });
}

export async function getForecastSummaryView(): Promise<ForecastSummary> {
  const rules = await getForecastRuleContext();
  const referenceDate = new Date(rules.today);
  const [forecastRows, cryostorageCount, animalCounts] = await Promise.all([
    getBreedingForecastView(),
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
