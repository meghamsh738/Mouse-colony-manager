import { differenceInDays } from "date-fns";

import {
  buildLineFertilityAdjustment,
  parseStrainFertilityProfiles,
  type StrainFertilityProfile,
} from "@/lib/fertility-rules";
import { prisma } from "@/lib/prisma";
import type { BreedingSuggestion } from "@/lib/types";
import { formatAgeLabel, formatPercent } from "@/lib/utils";

type BreedingRuleContext = {
  breederMaxAgeDays: number;
  breederMinAgeDays: number;
  fertilityTargetLitterSize: number;
  fertilityHighAveragePups: number;
  fertilityLowAveragePups: number;
  fertilityHistoryBoostScore: number;
  fertilityHistoryPenaltyScore: number;
  activeWorkloadPenaltyScore: number;
  surplusPenaltyPerPup: number;
  surplusWarningPups: number;
  strainFertilityProfiles: Map<string, StrainFertilityProfile>;
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
        notes?: string;
        progenyCount: number;
      }
    | null;
  ageDays: number;
};

type BreedingSuggestionSummary = BreedingSuggestion & {
  probabilityLabel: string;
};

type BreederHistory = {
  activeBreedings: number;
  totalBreedings: number;
  litterCount: number;
  failedBreedings: number;
  averageLitterSize: number | null;
  latestLitterDate: string | null;
  summary: string;
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

function isVariantCall(zygosity: string) {
  const normalized = zygosity.toLowerCase();

  return normalized !== "wt/wt" && normalized !== "wildtype" && normalized !== "pending";
}

function isHomozygousVariant(zygosity: string) {
  const normalized = zygosity.toLowerCase();

  return normalized.includes("+/+") || normalized.includes("flox/flox") || normalized.includes("hom");
}

export function evaluateBreedingRuleRisks(
  sireAlleles: Array<{
    zygosity: string;
    allele: {
      name: string;
      harmfulHomozygous: boolean;
      maintainAsHet: boolean;
      prohibitedPairings: unknown;
    };
  }>,
  damAlleles: Array<{
    zygosity: string;
    allele: {
      name: string;
      harmfulHomozygous: boolean;
      maintainAsHet: boolean;
      prohibitedPairings: unknown;
    };
  }>,
) {
  const warnings: string[] = [];
  let criticalCount = 0;
  let warningCount = 0;
  const damByAlleleName = new Map(damAlleles.map((allele) => [allele.allele.name, allele]));

  for (const sireAllele of sireAlleles) {
    const damAllele = damByAlleleName.get(sireAllele.allele.name);

    if (!damAllele) {
      continue;
    }

    const sireCarrier = isVariantCall(sireAllele.zygosity);
    const damCarrier = isVariantCall(damAllele.zygosity);
    const bothCarriers = sireCarrier && damCarrier;
    const homozygousParent = isHomozygousVariant(sireAllele.zygosity) || isHomozygousVariant(damAllele.zygosity);

    if (sireAllele.zygosity.toLowerCase() === "pending" || damAllele.zygosity.toLowerCase() === "pending") {
      warningCount += 1;
      warnings.push(`${sireAllele.allele.name} has a pending parent genotype call`);
    }

    if (sireAllele.allele.harmfulHomozygous && bothCarriers) {
      criticalCount += 1;
      warnings.push(`Harmful homozygous risk for ${sireAllele.allele.name}`);
    }

    if (sireAllele.allele.maintainAsHet && bothCarriers) {
      warningCount += 1;
      warnings.push(`${sireAllele.allele.name} line is configured to maintain as heterozygous`);
    }

    if (sireAllele.allele.maintainAsHet && homozygousParent) {
      criticalCount += 1;
      warnings.push(`${sireAllele.allele.name} homozygous breeder conflicts with het-only maintenance`);
    }

    if (Array.isArray(sireAllele.allele.prohibitedPairings) && sireAllele.allele.prohibitedPairings.length > 0 && bothCarriers) {
      warningCount += 1;
      warnings.push(`${sireAllele.allele.name} has configured prohibited-pairing notes to review`);
    }
  }

  return {
    warnings,
    criticalCount,
    warningCount,
    severity: criticalCount > 0 ? "critical" : warningCount > 0 ? "warning" : "ok",
  } as const;
}

function buildBreederHistory(
  breedingAdults: Array<{
    breedingSetup: {
      status: string;
      startDate: Date;
      litters: Array<{
        birthDate: Date;
        litterSizeBirth: number;
      }>;
    };
  }>,
): BreederHistory {
  const litters = breedingAdults.flatMap((adult) => adult.breedingSetup.litters);
  const averageLitterSize = litters.length
    ? Number((litters.reduce((sum, litter) => sum + litter.litterSizeBirth, 0) / litters.length).toFixed(1))
    : null;
  const latestLitter = [...litters].sort((left, right) => right.birthDate.getTime() - left.birthDate.getTime())[0] ?? null;
  const activeBreedings = breedingAdults.filter((adult) => adult.breedingSetup.status === "active").length;
  const failedBreedings = breedingAdults.filter((adult) => adult.breedingSetup.status === "failed").length;

  return {
    activeBreedings,
    totalBreedings: breedingAdults.length,
    litterCount: litters.length,
    failedBreedings,
    averageLitterSize,
    latestLitterDate: latestLitter?.birthDate.toISOString() ?? null,
    summary: litters.length
      ? `${litters.length} litters, average ${averageLitterSize} pups`
      : breedingAdults.length
        ? `${breedingAdults.length} breeding setups, no litter history yet`
        : "No breeding history",
  };
}

function fertilityHistoryAdjustment(sireHistory: BreederHistory, damHistory: BreederHistory, rules: BreedingRuleContext) {
  const knownAverages = [sireHistory.averageLitterSize, damHistory.averageLitterSize].filter(
    (value): value is number => value !== null,
  );

  if (!knownAverages.length) {
    return -2;
  }

  const combinedAverage = knownAverages.reduce((sum, value) => sum + value, 0) / knownAverages.length;

  if (combinedAverage >= rules.fertilityHighAveragePups) {
    return rules.fertilityHistoryBoostScore;
  }

  if (combinedAverage >= rules.fertilityLowAveragePups) {
    return Math.round(rules.fertilityHistoryBoostScore / 2);
  }

  return -rules.fertilityHistoryPenaltyScore;
}

function expectedLitterSizeFromHistory(sireHistory: BreederHistory, damHistory: BreederHistory, rules: BreedingRuleContext) {
  const knownAverages = [sireHistory.averageLitterSize, damHistory.averageLitterSize].filter(
    (value): value is number => value !== null,
  );

  if (!knownAverages.length) {
    return rules.fertilityTargetLitterSize;
  }

  return Number((knownAverages.reduce((sum, value) => sum + value, 0) / knownAverages.length).toFixed(1));
}

function buildWorkloadSummary(sireHistory: BreederHistory, damHistory: BreederHistory) {
  const active = sireHistory.activeBreedings + damHistory.activeBreedings;

  return active ? `${active} active breeding workload flags` : "No active breeding workload";
}

async function getBreedingRuleContext(): Promise<BreedingRuleContext> {
  const ruleKeys = [
    "breeder_max_age_days",
    "breeder_min_age_days",
    "breeding_fertility_target_litter_size",
    "breeding_fertility_high_average_pups",
    "breeding_fertility_low_average_pups",
    "breeding_fertility_history_boost_score",
    "breeding_fertility_history_penalty_score",
    "breeding_active_workload_penalty_score",
    "breeding_surplus_penalty_per_pup",
    "breeding_surplus_warning_pups",
    "breeding_strain_fertility_profiles",
  ];
  const rules = await prisma.ruleConfig.findMany({
    where: {
      key: { in: ruleKeys },
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
    breederMaxAgeDays: getNumber("breeder_max_age_days", 0),
    breederMinAgeDays: getNumber("breeder_min_age_days", 0),
    fertilityTargetLitterSize: getNumber("breeding_fertility_target_litter_size", 6),
    fertilityHighAveragePups: getNumber("breeding_fertility_high_average_pups", 7),
    fertilityLowAveragePups: getNumber("breeding_fertility_low_average_pups", 5),
    fertilityHistoryBoostScore: getNumber("breeding_fertility_history_boost_score", 8),
    fertilityHistoryPenaltyScore: getNumber("breeding_fertility_history_penalty_score", 8),
    activeWorkloadPenaltyScore: getNumber("breeding_active_workload_penalty_score", 8),
    surplusPenaltyPerPup: getNumber("breeding_surplus_penalty_per_pup", 2),
    surplusWarningPups: getNumber("breeding_surplus_warning_pups", 4),
    strainFertilityProfiles: parseStrainFertilityProfiles(values.get("breeding_strain_fertility_profiles")),
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
          notes: true,
          _count: {
            select: {
              litterAnimals: true,
            },
          },
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
            notes: latestLitter.notes ?? undefined,
            progenyCount: latestLitter._count.litterAnimals,
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
          allele: { select: { name: true, harmfulHomozygous: true, maintainAsHet: true, prohibitedPairings: true } },
        },
      },
      breedingAdults: {
        include: {
          breedingSetup: {
            select: {
              status: true,
              startDate: true,
              litters: {
                select: {
                  birthDate: true,
                  litterSizeBirth: true,
                },
              },
            },
          },
        },
      },
      strain: { select: { name: true } },
    },
  });

  const males = animals.filter((animal) => animal.sex === "male");
  const females = animals.filter((animal) => animal.sex === "female");

  const suggestions = males
    .flatMap((sire) => {
      const sireAge = getAgeDays(sire.dob, rules.today);
      const sireGenotypeSummary = buildGenotypeSummary(sire.alleles);
      const sireHistory = buildBreederHistory(sire.breedingAdults);

      return females.map((dam) => {
        const damAge = getAgeDays(dam.dob, rules.today);
        const damGenotypeSummary = buildGenotypeSummary(dam.alleles);
        const damHistory = buildBreederHistory(dam.breedingAdults);
        const lineFertility = buildLineFertilityAdjustment(sire, dam, rules.strainFertilityProfiles);
        const genotypeScore = Math.min(
          0.95,
          pairScore(sireGenotypeSummary, desiredGenotype) + pairScore(damGenotypeSummary, desiredGenotype),
        );
        const fertilityPenalty = sire.status === "breeding" && dam.status === "breeding" ? 0 : 0.08;
        const agePenalty =
          sireAge > rules.breederMaxAgeDays || damAge > rules.breederMaxAgeDays ? 18 : 0;
        const criticalPenalty =
          sireAge < rules.breederMinAgeDays || damAge < rules.breederMinAgeDays ? 40 : 0;
        const ruleRisks = evaluateBreedingRuleRisks(sire.alleles, dam.alleles);
        const rulePenalty = ruleRisks.criticalCount * 35 + ruleRisks.warningCount * 10;
        const workloadPenalty = (sireHistory.activeBreedings + damHistory.activeBreedings) * rules.activeWorkloadPenaltyScore;
        const historyAdjustment = fertilityHistoryAdjustment(sireHistory, damHistory, rules);
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

        if (sireHistory.activeBreedings || damHistory.activeBreedings) {
          warnings.push("One or both breeders are already carrying active breeding workload");
        }

        if (sireHistory.failedBreedings || damHistory.failedBreedings) {
          warnings.push("Breeding history includes failed setups");
        }

        warnings.push(...ruleRisks.warnings);
        warnings.push(...lineFertility.notes.map((note) => `Line fertility note: ${note}`));

        const expectedProbability = Math.max(0.1, Number(((genotypeScore - fertilityPenalty) * lineFertility.probabilityMultiplier).toFixed(2)));
        const expectedLitterSize = Number(
          Math.max(1, expectedLitterSizeFromHistory(sireHistory, damHistory, rules) * lineFertility.litterSizeMultiplier).toFixed(1),
        );
        const expectedUsablePups = Number((expectedProbability * expectedLitterSize).toFixed(1));
        const estimatedSurplusPups = Number(Math.max(0, expectedLitterSize - expectedUsablePups).toFixed(1));
        const surplusPenalty = Math.max(
          0,
          Math.round(estimatedSurplusPups * rules.surplusPenaltyPerPup * lineFertility.surplusPenaltyMultiplier),
        );
        const estimatedPupsNeeded = Math.max(6, Math.ceil(minimumYield / Math.max(expectedProbability, 0.1)));

        if (estimatedSurplusPups >= rules.surplusWarningPups) {
          warnings.push(`High surplus risk: about ${estimatedSurplusPups} pups may miss the requested genotype`);
        }

        const priorityScore = Math.max(
          0,
          Math.round(
            expectedProbability * 100 +
              (desiredSex === "female" ? 5 : 0) -
              agePenalty -
              criticalPenalty -
              rulePenalty -
              workloadPenalty -
              surplusPenalty +
              historyAdjustment,
          ),
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
          estimatedSurplusPups,
          expectedLitterSize,
          fertilitySummary: `Sire: ${sireHistory.summary}; dam: ${damHistory.summary}`,
          lineFertilitySummary: lineFertility.summary,
          workloadSummary: buildWorkloadSummary(sireHistory, damHistory),
          warnings,
          ruleSeverity: ruleRisks.severity,
          ruleSummary:
            ruleRisks.severity === "ok"
              ? "No configured genotype rule conflicts"
              : `${ruleRisks.criticalCount} critical and ${ruleRisks.warningCount} warning rule checks`,
          priorityScore,
        };
      });
    })
    .sort((left, right) => right.priorityScore - left.priorityScore);

  const topSuggestions = suggestions.slice(0, 5);
  const riskPreview = suggestions.find(
    (suggestion) => suggestion.ruleSeverity !== "ok" && !topSuggestions.some((top) => top.id === suggestion.id),
  );

  return riskPreview ? [...topSuggestions, riskPreview] : topSuggestions;
}

export async function getBreedingSuggestionSummaryView(): Promise<BreedingSuggestionSummary[]> {
  const suggestions = await getBreedingSuggestionsView();

  return suggestions.map((suggestion) => ({
    ...suggestion,
    probabilityLabel: formatPercent(suggestion.expectedGenotypeProbability),
  }));
}

export async function getBreedingSetupOptionsView() {
  const referenceDate = getReferenceDate();
  const animals = await prisma.animal.findMany({
    where: {
      outcomeStatus: "alive",
      sex: { in: ["male", "female"] },
      currentCageId: { not: null },
    },
    orderBy: [{ sex: "asc" }, { animalId: "asc" }],
    include: {
      currentCage: {
        include: {
          room: { select: { roomNumber: true } },
          rack: { select: { rackNumber: true } },
        },
      },
    },
  });

  const formatOptionLabel = (animal: (typeof animals)[number]) =>
    [
      animal.animalId,
      formatAgeLabel(getAgeDays(animal.dob, referenceDate)),
      animal.status.replaceAll("_", " "),
      animal.currentCage ? `${animal.currentCage.room.roomNumber} / ${animal.currentCage.rack.rackNumber} / ${animal.currentCage.cageNumber}` : "Archived",
    ].join(" · ");

  return {
    sireOptions: animals
      .filter((animal) => animal.sex === "male")
      .map((animal) => ({
        id: animal.id,
        label: formatOptionLabel(animal),
      })),
    damOptions: animals
      .filter((animal) => animal.sex === "female")
      .map((animal) => ({
        id: animal.id,
        label: formatOptionLabel(animal),
      })),
  };
}

export async function getBreedingWeaningOptionsView() {
  const [cages, strains] = await prisma.$transaction([
    prisma.cage.findMany({
      where: {
        active: true,
        status: {
          notIn: ["closed", "retired"],
        },
      },
      orderBy: [{ room: { roomNumber: "asc" } }, { rack: { rackNumber: "asc" } }, { cageNumber: "asc" }],
      include: {
        room: { select: { roomNumber: true } },
        rack: { select: { rackNumber: true } },
      },
    }),
    prisma.strain.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        background: true,
      },
    }),
  ]);

  return {
    cageOptions: cages.map((cage) => ({
      id: cage.id,
      label: `${cage.room.roomNumber} / ${cage.rack.rackNumber} / ${cage.cageNumber} · ${cage.barcode}`,
    })),
    strainOptions: strains.map((strain) => ({
      id: strain.id,
      label: strain.background ? `${strain.name} · ${strain.background}` : strain.name,
    })),
  };
}
