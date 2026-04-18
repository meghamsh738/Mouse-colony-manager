import { differenceInDays } from "date-fns";

import { prisma } from "@/lib/prisma";
import type {
  ExperimentCandidate,
  ExperimentExclusionSummary,
  ExperimentGroupSuggestion,
  ExperimentPlannerFilters,
  ExperimentPlannerView,
} from "@/lib/types";
import { formatAgeLabel } from "@/lib/utils";

type ExperimentOverviewItem = {
  id: string;
  experimentCode: string;
  title: string;
  status: string;
  projectCode: string;
  assignments: Array<{
    id: string;
    animalId: string;
    status: string;
    startDate: string;
  }>;
};

type PlannerSearchParams = Record<string, string | string[] | undefined>;

function getReferenceDate() {
  return process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString();
}

function asString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseNumber(value: string | undefined, fallback: number, bounds?: { min?: number; max?: number }) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const withMin = bounds?.min !== undefined ? Math.max(bounds.min, parsed) : parsed;
  return bounds?.max !== undefined ? Math.min(bounds.max, withMin) : withMin;
}

function parseBoolean(value: string | undefined, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  return value === "true" || value === "on" || value === "1";
}

function normalizeSeed(value: string | undefined) {
  return value?.trim() || "colony-balance";
}

function seededScore(seed: string, value: string) {
  const input = `${seed}:${value}`;
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
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

function normalizeSiblingGroup(input: { sireId: string | null; damId: string | null; animalId: string }) {
  if (!input.sireId && !input.damId) {
    return `standalone:${input.animalId}`;
  }

  return `${input.sireId ?? "unknown"}:${input.damId ?? "unknown"}`;
}

function summarizeExclusions(reasonCounts: Map<string, number>): ExperimentExclusionSummary[] {
  return [...reasonCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => ({ reason, count }));
}

function scoreAgeWindow(ageDays: number, minAgeDays: number, maxAgeDays: number) {
  const midpoint = minAgeDays + (maxAgeDays - minAgeDays) / 2;
  const distance = Math.abs(ageDays - midpoint);

  return Math.max(0, 16 - Math.round(distance / 7));
}

function buildAdjustedSuggestion(
  candidate: ExperimentCandidate,
  index: number,
  selected: ExperimentGroupSuggestion[],
  filters: ExperimentPlannerFilters,
) {
  let adjustedScore = candidate.score;
  const reasons = [candidate.inclusionReason];

  if (filters.balanceByCage && selected.some((entry) => entry.reasons.some((reason) => reason === candidate.cageLabel))) {
    adjustedScore -= 18;
    reasons.push("Same cage as an already selected animal");
  } else if (filters.balanceByCage) {
    reasons.push(candidate.cageLabel);
  }

  if (
    filters.avoidSiblingClustering &&
    selected.some((entry) => entry.reasons.some((reason) => reason === `siblings:${candidate.siblingGroup}`))
  ) {
    adjustedScore -= 14;
    reasons.push("Sibling cluster penalty applied");
  } else if (filters.avoidSiblingClustering) {
    reasons.push(`siblings:${candidate.siblingGroup}`);
  }

  return {
    animalId: candidate.animalId,
    rank: index + 1,
    adjustedScore,
    reasons,
  };
}

function pickBalancedCohort(candidates: ExperimentCandidate[], filters: ExperimentPlannerFilters) {
  const selected: ExperimentGroupSuggestion[] = [];
  const remaining = [...candidates];

  while (selected.length < filters.desiredNumber && remaining.length > 0) {
    let bestIndex = 0;
    let bestSuggestion = buildAdjustedSuggestion(remaining[0], selected.length, selected, filters);

    for (let index = 1; index < remaining.length; index += 1) {
      const suggestion = buildAdjustedSuggestion(remaining[index], selected.length, selected, filters);

      if (suggestion.adjustedScore > bestSuggestion.adjustedScore) {
        bestSuggestion = suggestion;
        bestIndex = index;
      }
    }

    selected.push(bestSuggestion);
    remaining.splice(bestIndex, 1);
  }

  const alternates = remaining
    .slice(0, Math.max(2, Math.min(4, filters.desiredNumber)))
    .map((candidate, index) => buildAdjustedSuggestion(candidate, selected.length + index, selected, filters));

  return { selected, alternates };
}

export function parseExperimentPlannerFilters(searchParams?: PlannerSearchParams): ExperimentPlannerFilters {
  const desiredSex = asString(searchParams?.sex);
  const minAgeDays = parseNumber(asString(searchParams?.minAgeDays), 42, { min: 14, max: 365 });
  const maxAgeDays = parseNumber(asString(searchParams?.maxAgeDays), 120, { min: minAgeDays, max: 540 });

  return {
    desiredNumber: parseNumber(asString(searchParams?.desiredNumber), 4, { min: 1, max: 24 }),
    desiredSex: desiredSex === "male" || desiredSex === "female" ? desiredSex : "either",
    minAgeDays,
    maxAgeDays,
    genotypeKeyword: asString(searchParams?.genotypeKeyword)?.trim() ?? "Cre",
    strainId: asString(searchParams?.strainId)?.trim() || undefined,
    projectId: asString(searchParams?.projectId)?.trim() || undefined,
    includeReserved: parseBoolean(asString(searchParams?.includeReserved), false),
    allowOverlap: parseBoolean(asString(searchParams?.allowOverlap), false),
    balanceByCage: parseBoolean(asString(searchParams?.balanceByCage), true),
    avoidSiblingClustering: parseBoolean(asString(searchParams?.avoidSiblingClustering), true),
    groupCount: parseNumber(asString(searchParams?.groupCount), 2, { min: 2, max: 6 }),
    randomSeed: normalizeSeed(asString(searchParams?.randomSeed)),
    blockBySex: parseBoolean(asString(searchParams?.blockBySex), true),
    blockBySiblingGroup: parseBoolean(asString(searchParams?.blockBySiblingGroup), true),
  };
}

function buildRandomizationPlan(
  selected: ExperimentGroupSuggestion[],
  ranked: ExperimentCandidate[],
  filters: ExperimentPlannerFilters,
) {
  const selectedCandidates = selected
    .map((entry) => ranked.find((candidate) => candidate.animalId === entry.animalId))
    .filter((candidate): candidate is ExperimentCandidate => Boolean(candidate));

  const groups = Array.from({ length: filters.groupCount }, (_, index) => ({
    name: `Group ${String.fromCharCode(65 + index)}`,
    members: [] as Array<{
      animalId: string;
      sex: ExperimentCandidate["sex"];
      ageLabel: string;
      cageLabel: string;
      genotypeSummary: string;
      siblingGroup: string;
    }>,
    summary: {
      total: 0,
      males: 0,
      females: 0,
    },
  }));

  const strategy = [
    "Seeded ordering from the selected cohort",
    ...(filters.blockBySex ? ["Block by sex before assignment"] : []),
    ...(filters.blockBySiblingGroup ? ["Keep sibling groups from front-loading the same treatment arm"] : []),
    "Serpentine distribution across groups",
  ];

  const ordered = [...selectedCandidates].sort((left, right) => {
    const leftBlock = [
      filters.blockBySex ? left.sex : "",
      filters.blockBySiblingGroup ? left.siblingGroup : "",
    ].join("|");
    const rightBlock = [
      filters.blockBySex ? right.sex : "",
      filters.blockBySiblingGroup ? right.siblingGroup : "",
    ].join("|");

    if (leftBlock !== rightBlock) {
      return leftBlock.localeCompare(rightBlock);
    }

    return (
      seededScore(filters.randomSeed, `${left.animalId}:${leftBlock}`) -
        seededScore(filters.randomSeed, `${right.animalId}:${rightBlock}`) ||
      left.animalId.localeCompare(right.animalId)
    );
  });

  for (const [index, candidate] of ordered.entries()) {
    const cycle = Math.floor(index / groups.length);
    const position = index % groups.length;
    const groupIndex = cycle % 2 === 0 ? position : groups.length - 1 - position;
    const targetGroup = groups[groupIndex];

    targetGroup.members.push({
      animalId: candidate.animalId,
      sex: candidate.sex,
      ageLabel: candidate.ageLabel,
      cageLabel: candidate.cageLabel,
      genotypeSummary: candidate.genotypeSummary,
      siblingGroup: candidate.siblingGroup,
    });
    targetGroup.summary.total += 1;
    targetGroup.summary.males += candidate.sex === "male" ? 1 : 0;
    targetGroup.summary.females += candidate.sex === "female" ? 1 : 0;
  }

  return {
    groups,
    seed: filters.randomSeed,
    strategy,
  };
}

export async function getExperimentOverviewView(): Promise<ExperimentOverviewItem[]> {
  const experiments = await prisma.experiment.findMany({
    orderBy: [{ status: "asc" }, { experimentCode: "asc" }],
    include: {
      project: {
        select: {
          projectCode: true,
        },
      },
      assignments: {
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
        include: {
          animal: {
            select: {
              animalId: true,
            },
          },
        },
      },
    },
  });

  return experiments.map((experiment) => ({
    id: experiment.id,
    experimentCode: experiment.experimentCode,
    title: experiment.title,
    status: experiment.status,
    projectCode: experiment.project.projectCode,
    assignments: experiment.assignments.map((assignment) => ({
      id: assignment.id,
      animalId: assignment.animal.animalId,
      status: assignment.status,
      startDate: assignment.startDate.toISOString(),
    })),
  }));
}

export async function getExperimentPlannerOptions() {
  const [projects, strains] = await prisma.$transaction([
    prisma.project.findMany({
      orderBy: { projectCode: "asc" },
      select: { id: true, projectCode: true, title: true },
    }),
    prisma.strain.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return {
    projectOptions: projects.map((project) => ({
      id: project.id,
      label: `${project.projectCode} · ${project.title}`,
    })),
    strainOptions: strains.map((strain) => ({
      id: strain.id,
      label: strain.name,
    })),
  };
}

export async function getExperimentPlannerView(filters: ExperimentPlannerFilters): Promise<ExperimentPlannerView> {
  const referenceDate = getReferenceDate();
  const animals = await prisma.animal.findMany({
    where: {
      outcomeStatus: "alive",
    },
    orderBy: { animalId: "asc" },
    include: {
      strain: { select: { id: true, name: true } },
      currentCage: {
        include: {
          room: { select: { roomNumber: true } },
          rack: { select: { rackNumber: true } },
        },
      },
      alleles: {
        include: {
          allele: { select: { name: true } },
        },
      },
      projectAllocations: {
        where: {
          endedAt: null,
        },
        include: {
          project: { select: { id: true, projectCode: true } },
        },
      },
      experimentAssignments: {
        where: {
          status: { in: ["planned", "reserved", "active"] },
        },
        include: {
          experiment: {
            select: {
              experimentCode: true,
              status: true,
            },
          },
        },
      },
      healthNotes: {
        where: {
          resolved: false,
          followupRequired: true,
        },
        select: {
          noteType: true,
          note: true,
        },
      },
    },
  });

  const reasonCounts = new Map<string, number>();
  const candidates: ExperimentCandidate[] = [];

  for (const animal of animals) {
    const ageDays = differenceInDays(new Date(referenceDate), animal.dob);
    const genotypeSummary = buildGenotypeSummary(animal.alleles);
    const genotypeConfirmed = animal.alleles.length > 0 && animal.alleles.every((allele) => allele.callStatus === "confirmed");
    const activeProjectCodes = animal.projectAllocations.map((allocation) => allocation.project.projectCode);
    const hasOverlapConflict = animal.experimentAssignments.length > 0;
    const siblingGroup = normalizeSiblingGroup(animal);

    const exclusionReason =
      !["colony_holding", "reserved", "experiment_completed"].includes(animal.status)
        ? "Lifecycle status is not experiment-ready"
        : filters.desiredSex !== "either" && animal.sex !== filters.desiredSex
          ? "Sex filter mismatch"
          : ageDays < filters.minAgeDays || ageDays > filters.maxAgeDays
            ? "Age outside requested range"
            : filters.genotypeKeyword &&
                !genotypeSummary.toLowerCase().includes(filters.genotypeKeyword.toLowerCase())
              ? "Genotype filter mismatch"
              : filters.strainId && animal.strainId !== filters.strainId
                ? "Strain filter mismatch"
                : filters.projectId &&
                    !animal.projectAllocations.some((allocation) => allocation.project.id === filters.projectId)
                  ? "Project filter mismatch"
                  : animal.status === "reserved" && !filters.includeReserved
                    ? "Reserved animals excluded"
                    : hasOverlapConflict && !filters.allowOverlap
                      ? "Experiment overlap blocked"
                      : null;

    if (exclusionReason) {
      reasonCounts.set(exclusionReason, (reasonCounts.get(exclusionReason) ?? 0) + 1);
      continue;
    }

    const warnings = [
      ...animal.healthNotes.map((note) => `Follow-up ${note.noteType.replaceAll("_", " ")}: ${note.note}`),
      ...(genotypeConfirmed ? [] : ["Genotype is not fully confirmed"]),
      ...(animal.status === "reserved" ? ["Already reserved for another workflow"] : []),
      ...(hasOverlapConflict ? [`Overlap with ${animal.experimentAssignments[0]?.experiment.experimentCode}`] : []),
    ];

    const genotypeMatch = !filters.genotypeKeyword
      ? true
      : genotypeSummary.toLowerCase().includes(filters.genotypeKeyword.toLowerCase());
    const projectMatch = !filters.projectId
      ? true
      : animal.projectAllocations.some((allocation) => allocation.project.id === filters.projectId);

    const score =
      48 +
      (animal.status === "colony_holding" ? 15 : 8) +
      (animal.sex === filters.desiredSex || filters.desiredSex === "either" ? 8 : 0) +
      scoreAgeWindow(ageDays, filters.minAgeDays, filters.maxAgeDays) +
      (genotypeMatch ? 16 : 0) +
      (projectMatch ? 10 : 0) +
      (genotypeConfirmed ? 8 : -14) +
      (hasOverlapConflict ? -18 : 10) -
      warnings.length * 4;

    candidates.push({
      animalId: animal.animalId,
      score,
      inclusionReason: genotypeConfirmed
        ? "Eligible under the active planner filters"
        : "Included with a genotype-confirmation warning",
      warnings,
      cageLabel: buildCageLabel(animal.currentCage),
      sex: animal.sex,
      ageDays,
      ageLabel: formatAgeLabel(ageDays),
      strain: animal.strain.name,
      genotypeSummary,
      projectCodes: activeProjectCodes,
      siblingGroup,
    });
  }

  const ranked = candidates.sort((left, right) => right.score - left.score || left.animalId.localeCompare(right.animalId));
  const { selected, alternates } = pickBalancedCohort(ranked, filters);
  const randomization = buildRandomizationPlan(selected, ranked, filters);

  return {
    filters,
    candidates: ranked,
    selected,
    alternates,
    randomization,
    exclusions: summarizeExclusions(reasonCounts),
    summary: {
      totalReviewed: animals.length,
      included: ranked.length,
      selected: selected.length,
      alternates: alternates.length,
      excluded: animals.length - ranked.length,
    },
  };
}

export async function getExperimentCandidateView(
  desiredNumber = 4,
  desiredSex: "male" | "female" | "either" = "female",
  minAgeDays = 28,
  maxAgeDays = 140,
  genotypeKeyword = "Cre",
): Promise<ExperimentCandidate[]> {
  const view = await getExperimentPlannerView({
    desiredNumber,
    desiredSex,
    minAgeDays,
    maxAgeDays,
    genotypeKeyword,
    includeReserved: true,
    allowOverlap: true,
    balanceByCage: true,
    avoidSiblingClustering: true,
    groupCount: 2,
    randomSeed: "colony-balance",
    blockBySex: true,
    blockBySiblingGroup: true,
  });

  return view.candidates;
}
