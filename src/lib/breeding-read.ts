import { differenceInDays } from "date-fns";

import { prisma } from "@/lib/prisma";
import type { BreedingSuggestion } from "@/lib/types";
import { formatAgeLabel, formatPercent } from "@/lib/utils";

type BreedingRuleContext = {
  breederMaxAgeDays: number;
  breederMinAgeDays: number;
  today: string;
};

type BreedingOverviewItem = {
  id: string;
  startDate: string;
  status: string;
  targetGenotype: string;
  adults: Array<{
    id: string;
    role: string;
    animal: {
      id: string;
      animalId: string;
    } | null;
  }>;
  litter:
    | {
        id: string;
        birthDate: string;
        litterSizeBirth: number;
        litterSizeWean?: number;
      }
    | null;
  ageDays: number;
};

type BreedingSuggestionSummary = BreedingSuggestion & {
  probabilityLabel: string;
};

function getReferenceDate() {
  return process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString();
}

function getAgeDays(dob: Date, referenceDate: string) {
  return differenceInDays(new Date(referenceDate), dob);
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

function pairScore(genotypeSummary: string, desiredGenotype: string) {
  return desiredGenotype
    .toLowerCase()
    .split(/[;,]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .reduce((score, token) => (genotypeSummary.toLowerCase().includes(token) ? score + 0.2 : score), 0);
}

async function getBreedingRuleContext(): Promise<BreedingRuleContext> {
  const rules = await prisma.ruleConfig.findMany({
    where: {
      key: { in: ["breeder_max_age_days", "breeder_min_age_days"] },
    },
    select: {
      key: true,
      value: true,
    },
  });

  const values = new Map(rules.map((rule) => [rule.key, Number(rule.value)]));

  return {
    breederMaxAgeDays: values.get("breeder_max_age_days") ?? 0,
    breederMinAgeDays: values.get("breeder_min_age_days") ?? 0,
    today: getReferenceDate(),
  };
}

export async function getBreedingOverviewView(): Promise<BreedingOverviewItem[]> {
  const referenceDate = getReferenceDate();
  const breedings = await prisma.breedingSetup.findMany({
    orderBy: [{ startDate: "desc" }, { id: "asc" }],
    include: {
      adults: {
        orderBy: [{ role: "asc" }, { id: "asc" }],
        include: {
          animal: {
            select: {
              id: true,
              animalId: true,
            },
          },
        },
      },
      litters: {
        orderBy: [{ birthDate: "desc" }, { id: "asc" }],
        select: {
          id: true,
          birthDate: true,
          litterSizeBirth: true,
          litterSizeWean: true,
        },
      },
    },
  });

  return breedings.map((breeding) => {
    const latestLitter = breeding.litters[0] ?? null;

    return {
      id: breeding.id,
      startDate: breeding.startDate.toISOString(),
      status: breeding.status,
      targetGenotype: breeding.targetGenotype,
      adults: breeding.adults.map((adult) => ({
        id: adult.id,
        role: adult.role,
        animal: adult.animal,
      })),
      litter: latestLitter
        ? {
            id: latestLitter.id,
            birthDate: latestLitter.birthDate.toISOString(),
            litterSizeBirth: latestLitter.litterSizeBirth,
            litterSizeWean: latestLitter.litterSizeWean ?? undefined,
          }
        : null,
      ageDays: differenceInDays(new Date(referenceDate), breeding.startDate),
    };
  });
}

export async function getBreedingSuggestionsView(
  desiredGenotype = "Cre ; tdTomato",
  desiredSex: "male" | "female" = "female",
  minimumYield = 4,
): Promise<BreedingSuggestion[]> {
  const rules = await getBreedingRuleContext();
  const animals = await prisma.animal.findMany({
    where: {
      outcomeStatus: "alive",
      sex: { in: ["male", "female"] },
    },
    orderBy: { animalId: "asc" },
    include: {
      alleles: {
        include: {
          allele: { select: { name: true } },
        },
      },
    },
  });

  const males = animals.filter((animal) => animal.sex === "male");
  const females = animals.filter((animal) => animal.sex === "female");

  return males
    .flatMap((sire) => {
      const sireAge = getAgeDays(sire.dob, rules.today);
      const sireGenotypeSummary = buildGenotypeSummary(sire.alleles);

      return females.map((dam) => {
        const damAge = getAgeDays(dam.dob, rules.today);
        const damGenotypeSummary = buildGenotypeSummary(dam.alleles);
        const genotypeScore = Math.min(
          0.95,
          pairScore(sireGenotypeSummary, desiredGenotype) + pairScore(damGenotypeSummary, desiredGenotype),
        );
        const fertilityPenalty = sire.status === "breeding" && dam.status === "breeding" ? 0 : 0.08;
        const agePenalty =
          sireAge > rules.breederMaxAgeDays || damAge > rules.breederMaxAgeDays ? 18 : 0;
        const criticalPenalty =
          sireAge < rules.breederMinAgeDays || damAge < rules.breederMinAgeDays ? 40 : 0;
        const warnings: string[] = [];

        if (sireAge > rules.breederMaxAgeDays) {
          warnings.push(`${sire.animalId} exceeds breeder age threshold`);
        }

        if (damAge > rules.breederMaxAgeDays) {
          warnings.push(`${dam.animalId} exceeds breeder age threshold`);
        }

        if (sireGenotypeSummary.includes("CreER +/-") && damGenotypeSummary.includes("tdTomato +/-")) {
          warnings.push("Cross can yield desired dual-transgenic pups");
        }

        const expectedProbability = Math.max(0.1, genotypeScore - fertilityPenalty);
        const expectedUsablePups = Number((expectedProbability * 6).toFixed(1));
        const estimatedPupsNeeded = Math.max(6, Math.ceil(minimumYield / Math.max(expectedProbability, 0.1)));
        const priorityScore = Math.max(
          0,
          Math.round(expectedProbability * 100 + (desiredSex === "female" ? 5 : 0) - agePenalty - criticalPenalty),
        );

        return {
          id: `${sire.id}-${dam.id}`,
          sireId: sire.id,
          damId: dam.id,
          sireLabel: `${sire.animalId} (${formatAgeLabel(sireAge)})`,
          damLabel: `${dam.animalId} (${formatAgeLabel(damAge)})`,
          expectedGenotypeProbability: expectedProbability,
          expectedSexSplit: "50% female / 50% male",
          estimatedPupsNeeded,
          expectedUsablePups,
          warnings,
          priorityScore,
        };
      });
    })
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .slice(0, 5);
}

export async function getBreedingSuggestionSummaryView(): Promise<BreedingSuggestionSummary[]> {
  const suggestions = await getBreedingSuggestionsView();

  return suggestions.map((suggestion) => ({
    ...suggestion,
    probabilityLabel: formatPercent(suggestion.expectedGenotypeProbability),
  }));
}
