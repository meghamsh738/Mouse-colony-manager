import { differenceInDays } from "date-fns";

import { normalizeUserRole } from "@/lib/capabilities";
import { prisma } from "@/lib/prisma";
import { getActorLabAccess, labScopedWhere, type LabActor } from "@/lib/lab-access";
import type {
  ExperimentCandidate,
  ExperimentExclusionSummary,
  ExperimentGroupSuggestion,
  ExperimentPlannerFilters,
  ExperimentPlannerView,
} from "@/lib/types";
import { formatAgeLabel } from "@/lib/utils";

export type ExperimentOverviewItem = {
  id: string;
  labId: string;
  labCode: string;
  experimentCode: string;
  title: string;
  status: string;
  projectCode: string;
  projectId: string;
  protocolAuthorizationId: string | null;
  version: number;
  visibility: "full" | "operational";
  ownerContact: string;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  operationalContact: string | null;
  procedureSummary: string | null;
  treatmentSummary: string | null;
  welfareRisks: string | null;
  scheduleNotes: string | null;
  operationalNotes: string | null;
  researchNotes?: string | null;
  resultSummary?: string | null;
  assignments: Array<{
    id: string;
    animalId: string;
    animalRecordId: string;
    sex: string;
    strain: string;
    genotype: string;
    cageBarcode: string | null;
    cageLocation: string | null;
    status: string;
    startDate: string;
    endDate: string | null;
    treatmentGroup: string | null;
    notes?: string | null;
    version: number;
    provenance: {
      action: string;
      timestamp: string;
      actorName: string | null;
    } | null;
  }>;
};

function isExperimentAssignmentAction(action: string) {
  return ["reserve", "plan", "promote_plan", "demote_reservation", "update_plan", "delete_plan"].includes(action);
}

type PlannerSearchParams = Record<string, string | string[] | undefined>;
const GLOBAL_READ_ACTOR: LabActor = { id: "internal-global-read", role: "facility_admin" };

function canReadFullExperimentDetails(actor: LabActor) {
  const role = normalizeUserRole(actor.role);
  return role === "facility_admin" || role === "lab_user";
}

function assertFullExperimentAccess(actor: LabActor) {
  if (!canReadFullExperimentDetails(actor)) {
    throw new Error("Research planning details are not available in the operational experiment view.");
  }
}

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

function scoreAgeWindow(ageDays: number, minAgeDays: number, maxAgeDays: number) {
  const midpoint = minAgeDays + (maxAgeDays - minAgeDays) / 2;
  const distance = Math.abs(ageDays - midpoint);

  return Math.max(0, 16 - Math.round(distance / 7));
}

function getAgeBand(ageDays: number) {
  if (ageDays < 56) {
    return "juvenile";
  }

  if (ageDays < 112) {
    return "young adult";
  }

  if (ageDays < 240) {
    return "adult";
  }

  return "older";
}

type ExclusionBucket = {
  count: number;
  exampleAnimalIds: string[];
  severity: ExperimentExclusionSummary["severity"];
};

function recordExclusion(buckets: Map<string, ExclusionBucket>, reason: string, animalId: string) {
  const existing = buckets.get(reason) ?? {
    count: 0,
    exampleAnimalIds: [],
    severity: reason.includes("blocked") || reason.includes("mismatch") ? "warning" : "info",
  };

  existing.count += 1;

  if (existing.exampleAnimalIds.length < 3) {
    existing.exampleAnimalIds.push(animalId);
  }

  buckets.set(reason, existing);
}

function summarizeExclusionBuckets(buckets: Map<string, ExclusionBucket>): ExperimentExclusionSummary[] {
  return [...buckets.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
    .map(([reason, bucket]) => ({ reason, ...bucket }));
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

  if (candidate.allocationRisk === "multi_project") {
    adjustedScore -= 6;
    reasons.push("Multi-project allocation review");
  } else if (candidate.allocationRisk === "unallocated") {
    adjustedScore -= 4;
    reasons.push("Project allocation missing");
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
    balanceByAge: parseBoolean(asString(searchParams?.balanceByAge), true),
    maxSameCagePerGroup: parseNumber(asString(searchParams?.maxSameCagePerGroup), 1, { min: 1, max: 6 }),
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
      ageDays: number;
      ageLabel: string;
      ageBand: string;
      cageLabel: string;
      genotypeSummary: string;
      siblingGroup: string;
    }>,
    summary: {
      total: 0,
      males: 0,
      females: 0,
      averageAgeDays: 0,
      cageCount: 0,
    },
    constraintWarnings: [] as string[],
  }));

  const strategy = [
    "Seeded ordering from the selected cohort",
    ...(filters.blockBySex ? ["Block by sex before assignment"] : []),
    ...(filters.blockBySiblingGroup ? ["Keep sibling groups from front-loading the same treatment arm"] : []),
    ...(filters.balanceByAge ? ["Balance by age band before assignment"] : []),
    `Limit same-cage animals per treatment arm to ${filters.maxSameCagePerGroup}`,
    "Constraint-aware serpentine distribution across groups",
  ];

  const ordered = [...selectedCandidates].sort((left, right) => {
    const leftBlock = [
      filters.blockBySex ? left.sex : "",
      filters.balanceByAge ? left.ageBand : "",
      filters.blockBySiblingGroup ? left.siblingGroup : "",
    ].join("|");
    const rightBlock = [
      filters.blockBySex ? right.sex : "",
      filters.balanceByAge ? right.ageBand : "",
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

  const getConstraintPenalty = (group: (typeof groups)[number], candidate: ExperimentCandidate) => {
    const sameCageCount = group.members.filter((member) => member.cageLabel === candidate.cageLabel).length;
    const siblingCount = group.members.filter((member) => member.siblingGroup === candidate.siblingGroup).length;
    const ageBandCount = group.members.filter((member) => member.ageBand === candidate.ageBand).length;
    const sexCount = group.members.filter((member) => member.sex === candidate.sex).length;

    return (
      group.members.length * 2 +
      (sameCageCount >= filters.maxSameCagePerGroup ? 50 : sameCageCount * 6) +
      (filters.blockBySiblingGroup ? siblingCount * 22 : 0) +
      (filters.balanceByAge ? ageBandCount * 4 : 0) +
      (filters.blockBySex ? sexCount * 3 : 0)
    );
  };

  for (const [index, candidate] of ordered.entries()) {
    const cycle = Math.floor(index / groups.length);
    const position = index % groups.length;
    const preferredIndex = cycle % 2 === 0 ? position : groups.length - 1 - position;
    const preferenceOrder = groups.map((_, groupIndex) => ({
      groupIndex,
      distanceFromPreferred: Math.abs(groupIndex - preferredIndex),
    }));
    const groupIndex = preferenceOrder
      .sort((left, right) => {
        const leftPenalty = getConstraintPenalty(groups[left.groupIndex], candidate);
        const rightPenalty = getConstraintPenalty(groups[right.groupIndex], candidate);

        return leftPenalty - rightPenalty || left.distanceFromPreferred - right.distanceFromPreferred;
      })[0].groupIndex;
    const targetGroup = groups[groupIndex];

    targetGroup.members.push({
      animalId: candidate.animalId,
      sex: candidate.sex,
      ageDays: candidate.ageDays,
      ageLabel: candidate.ageLabel,
      ageBand: candidate.ageBand,
      cageLabel: candidate.cageLabel,
      genotypeSummary: candidate.genotypeSummary,
      siblingGroup: candidate.siblingGroup,
    });
    targetGroup.summary.total += 1;
    targetGroup.summary.males += candidate.sex === "male" ? 1 : 0;
    targetGroup.summary.females += candidate.sex === "female" ? 1 : 0;
    targetGroup.summary.averageAgeDays = Math.round(
      targetGroup.members.reduce((sum, member) => sum + member.ageDays, 0) / targetGroup.members.length,
    );
    targetGroup.summary.cageCount = new Set(targetGroup.members.map((member) => member.cageLabel)).size;
  }

  for (const group of groups) {
    const cageCounts = new Map<string, number>();
    const siblingCounts = new Map<string, number>();

    for (const member of group.members) {
      cageCounts.set(member.cageLabel, (cageCounts.get(member.cageLabel) ?? 0) + 1);
      siblingCounts.set(member.siblingGroup, (siblingCounts.get(member.siblingGroup) ?? 0) + 1);
    }

    for (const [cageLabel, count] of cageCounts.entries()) {
      if (count > filters.maxSameCagePerGroup) {
        group.constraintWarnings.push(`${count} animals from ${cageLabel}`);
      }
    }

    if (filters.blockBySiblingGroup) {
      for (const count of siblingCounts.values()) {
        if (count > 1) {
          group.constraintWarnings.push("Sibling group repeated in this treatment arm");
          break;
        }
      }
    }
  }

  return {
    groups,
    seed: filters.randomSeed,
    strategy,
  };
}

type ExperimentOverviewProjection = {
  id: string;
  labId: string;
  experimentCode: string;
  title: string;
  status: string;
  version: number;
  protocolAuthorizationId: string | null;
  plannedStartAt: Date | null;
  plannedEndAt: Date | null;
  operationalContact: string | null;
  procedureSummary: string | null;
  treatmentSummary: string | null;
  welfareRisks: string | null;
  scheduleNotes: string | null;
  operationalNotes: string | null;
  notes?: string | null;
  resultSummary?: string | null;
  lab: { code: string };
  project: { id: string; projectCode: string };
  owner: { name: string | null; email: string };
  assignments: Array<{
    id: string;
    status: string;
    startDate: Date;
    endDate: Date | null;
    treatmentGroup: string | null;
    notes?: string | null;
    version: number;
    animal: {
      id: string;
      animalId: string;
      sex: string;
      strain: { name: string };
      alleles: Array<{ zygosity: string; allele: { name: string } }>;
      currentCage: {
        barcode: string;
        cageNumber: string;
        room: { roomNumber: string };
        rack: { rackNumber: string };
      } | null;
    };
  }>;
};

export async function getExperimentOverviewView(actor: LabActor = GLOBAL_READ_ACTOR): Promise<ExperimentOverviewItem[]> {
  const access = await getActorLabAccess(actor);
  const full = canReadFullExperimentDetails(actor);
  const where = labScopedWhere(access);
  const assignmentWhere = access.canViewAll ? {} : { animal: { owningLabId: { in: access.memberLabIds } } };
  const experiments: ExperimentOverviewProjection[] = full
    ? await prisma.experiment.findMany({
        where,
        orderBy: [{ status: "asc" }, { experimentCode: "asc" }],
        select: {
          id: true,
          labId: true,
          experimentCode: true,
          title: true,
          status: true,
          version: true,
          protocolAuthorizationId: true,
          plannedStartAt: true,
          plannedEndAt: true,
          operationalContact: true,
          procedureSummary: true,
          treatmentSummary: true,
          welfareRisks: true,
          scheduleNotes: true,
          operationalNotes: true,
          notes: true,
          resultSummary: true,
          lab: { select: { code: true } },
          project: { select: { id: true, projectCode: true } },
          owner: { select: { name: true, email: true } },
          assignments: {
            where: assignmentWhere,
            orderBy: [{ startDate: "asc" }, { id: "asc" }],
            select: {
              id: true,
              status: true,
              startDate: true,
              endDate: true,
              treatmentGroup: true,
              notes: true,
              version: true,
              animal: {
                select: {
                  id: true,
                  animalId: true,
                  sex: true,
                  strain: { select: { name: true } },
                  alleles: { include: { allele: { select: { name: true } } } },
                  currentCage: {
                    select: {
                      barcode: true,
                      cageNumber: true,
                      room: { select: { roomNumber: true } },
                      rack: { select: { rackNumber: true } },
                    },
                  },
                },
              },
            },
          },
        },
      })
    : await prisma.experiment.findMany({
        where,
        orderBy: [{ status: "asc" }, { experimentCode: "asc" }],
        select: {
          id: true,
          labId: true,
          experimentCode: true,
          title: true,
          status: true,
          version: true,
          protocolAuthorizationId: true,
          plannedStartAt: true,
          plannedEndAt: true,
          operationalContact: true,
          procedureSummary: true,
          treatmentSummary: true,
          welfareRisks: true,
          scheduleNotes: true,
          operationalNotes: true,
          lab: { select: { code: true } },
          project: { select: { id: true, projectCode: true } },
          owner: { select: { name: true, email: true } },
          assignments: {
            where: assignmentWhere,
            orderBy: [{ startDate: "asc" }, { id: "asc" }],
            select: {
              id: true,
              status: true,
              startDate: true,
              endDate: true,
              treatmentGroup: true,
              version: true,
              animal: {
                select: {
                  id: true,
                  animalId: true,
                  sex: true,
                  strain: { select: { name: true } },
                  alleles: { include: { allele: { select: { name: true } } } },
                  currentCage: {
                    select: {
                      barcode: true,
                      cageNumber: true,
                      room: { select: { roomNumber: true } },
                      rack: { select: { rackNumber: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });

  const assignmentIds = experiments.flatMap((experiment) => experiment.assignments.map((assignment) => assignment.id));
  const latestAuditEntries = assignmentIds.length
    ? await prisma.auditLog.findMany({
        where: {
          entityType: "experiment_assignment",
          entityId: { in: assignmentIds },
          action: {
            in: ["reserve", "plan", "promote_plan", "demote_reservation", "update_plan", "delete_plan"],
          },
        },
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
        include: {
          actor: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      })
    : [];

  const latestAuditByAssignmentId = new Map<
    string,
    {
      action: string;
      timestamp: string;
      actorName: string | null;
    }
  >();

  for (const entry of latestAuditEntries) {
    if (!isExperimentAssignmentAction(entry.action) || latestAuditByAssignmentId.has(entry.entityId)) {
      continue;
    }

    latestAuditByAssignmentId.set(entry.entityId, {
      action: entry.action,
      timestamp: entry.timestamp.toISOString(),
      actorName: entry.actor?.name ?? entry.actor?.email ?? null,
    });
  }

  return experiments.map((experiment) => ({
    id: experiment.id,
    labId: experiment.labId,
    labCode: experiment.lab.code,
    experimentCode: experiment.experimentCode,
    title: experiment.title,
    status: experiment.status,
    projectCode: experiment.project.projectCode,
    projectId: experiment.project.id,
    protocolAuthorizationId: experiment.protocolAuthorizationId,
    version: experiment.version,
    visibility: full ? "full" : "operational",
    ownerContact: experiment.owner.name ?? experiment.owner.email,
    plannedStartAt: experiment.plannedStartAt?.toISOString() ?? null,
    plannedEndAt: experiment.plannedEndAt?.toISOString() ?? null,
    operationalContact: experiment.operationalContact,
    procedureSummary: experiment.procedureSummary,
    treatmentSummary: experiment.treatmentSummary,
    welfareRisks: experiment.welfareRisks,
    scheduleNotes: experiment.scheduleNotes,
    operationalNotes: experiment.operationalNotes,
    ...(full
      ? {
          researchNotes: experiment.notes ?? null,
          resultSummary: experiment.resultSummary ?? null,
        }
      : {}),
    assignments: experiment.assignments.map((assignment) => ({
      id: assignment.id,
      animalId: assignment.animal.animalId,
      animalRecordId: assignment.animal.id,
      sex: assignment.animal.sex,
      strain: assignment.animal.strain.name,
      genotype: assignment.animal.alleles.length
        ? assignment.animal.alleles.map(({ allele, zygosity }) => `${allele.name} ${zygosity}`).join(" ; ")
        : "Genotype not recorded",
      cageBarcode: assignment.animal.currentCage?.barcode ?? null,
      cageLocation: assignment.animal.currentCage
        ? `${assignment.animal.currentCage.room.roomNumber} / ${assignment.animal.currentCage.rack.rackNumber} / ${assignment.animal.currentCage.cageNumber}`
        : null,
      status: assignment.status,
      startDate: assignment.startDate.toISOString(),
      endDate: assignment.endDate?.toISOString() ?? null,
      treatmentGroup: assignment.treatmentGroup ?? null,
      ...(full ? { notes: assignment.notes ?? null } : {}),
      version: assignment.version,
      provenance: latestAuditByAssignmentId.get(assignment.id) ?? null,
    })),
  }));
}

export async function getExperimentPlannerOptions(actor: LabActor = GLOBAL_READ_ACTOR) {
  assertFullExperimentAccess(actor);
  const access = await getActorLabAccess(actor);
  const [projects, strains, experiments] = await prisma.$transaction([
    prisma.project.findMany({
      where: labScopedWhere(access),
      orderBy: { projectCode: "asc" },
      select: { id: true, projectCode: true, title: true },
    }),
    prisma.strain.findMany({
      where: access.canViewAll
        ? {}
        : { animals: { some: { owningLabId: { in: access.memberLabIds } } } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.experiment.findMany({
      where: {
        status: { in: ["planned", "active"] },
        ...labScopedWhere(access),
      },
      orderBy: [{ status: "asc" }, { experimentCode: "asc" }],
      select: {
        id: true,
        experimentCode: true,
        title: true,
        version: true,
      },
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
    experimentOptions: experiments.map((experiment) => ({
      id: experiment.id,
      label: `${experiment.experimentCode} · ${experiment.title}`,
      version: experiment.version,
    })),
  };
}

export async function getExperimentPlannerView(
  actor: LabActor,
  filters: ExperimentPlannerFilters,
): Promise<ExperimentPlannerView> {
  assertFullExperimentAccess(actor);
  const access = await getActorLabAccess(actor);
  const referenceDate = getReferenceDate();
  const animals = await prisma.animal.findMany({
    where: {
      outcomeStatus: "alive",
      ...labScopedWhere(access, "owningLabId"),
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
          ...(access.canViewAll ? {} : { project: { labId: { in: access.memberLabIds } } }),
        },
        include: {
          project: { select: { id: true, projectCode: true } },
        },
      },
      experimentAssignments: {
        where: {
          status: { in: ["planned", "reserved", "active"] },
          ...(access.canViewAll ? {} : { experiment: { labId: { in: access.memberLabIds } } }),
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
          ...labScopedWhere(access),
        },
        select: {
          noteType: true,
          note: true,
        },
      },
    },
  });

  const exclusionBuckets = new Map<string, ExclusionBucket>();
  const candidates: ExperimentCandidate[] = [];

  for (const animal of animals) {
    const ageDays = differenceInDays(new Date(referenceDate), animal.dob);
    const ageBand = getAgeBand(ageDays);
    const genotypeSummary = buildGenotypeSummary(animal.alleles);
    const genotypeConfirmed = animal.alleles.length > 0 && animal.alleles.every((allele) => allele.callStatus === "confirmed");
    const activeProjectCodes = [...new Set(animal.projectAllocations.map((allocation) => allocation.project.projectCode))];
    const chargeableProjectCodes = [
      ...new Set(
        animal.projectAllocations
          .filter((allocation) => allocation.chargeable)
          .map((allocation) => allocation.project.projectCode),
      ),
    ];
    const allocationRisk =
      activeProjectCodes.length > 1 ? "multi_project" : activeProjectCodes.length === 0 ? "unallocated" : "none";
    const allocationSummary =
      activeProjectCodes.length > 0
        ? `${activeProjectCodes.join(", ")}${chargeableProjectCodes.length ? ` · chargeable ${chargeableProjectCodes.join(", ")}` : ""}`
        : "No active project allocation";
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
      recordExclusion(exclusionBuckets, exclusionReason, animal.animalId);
      continue;
    }

    const warnings = [
      ...animal.healthNotes.map((note) => `Follow-up ${note.noteType.replaceAll("_", " ")}: ${note.note}`),
      ...(genotypeConfirmed ? [] : ["Genotype is not fully confirmed"]),
      ...(animal.status === "reserved" ? ["Already reserved for another workflow"] : []),
      ...(hasOverlapConflict ? [`Overlap with ${animal.experimentAssignments[0]?.experiment.experimentCode}`] : []),
      ...(allocationRisk === "multi_project" ? [`Multi-project allocation: ${activeProjectCodes.join(", ")}`] : []),
      ...(allocationRisk === "unallocated" ? ["No active project allocation"] : []),
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
      (allocationRisk === "none" ? 6 : allocationRisk === "multi_project" ? -6 : -4) +
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
      ageBand,
      strain: animal.strain.name,
      genotypeSummary,
      projectCodes: activeProjectCodes,
      chargeableProjectCodes,
      activeProjectCount: activeProjectCodes.length,
      allocationRisk,
      allocationSummary,
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
    exclusions: summarizeExclusionBuckets(exclusionBuckets),
    summary: {
      totalReviewed: animals.length,
      included: ranked.length,
      selected: selected.length,
      alternates: alternates.length,
      excluded: animals.length - ranked.length,
      allocationWarnings: ranked.filter((candidate) => candidate.allocationRisk !== "none").length,
      multiProjectCandidates: ranked.filter((candidate) => candidate.allocationRisk === "multi_project").length,
      unallocatedCandidates: ranked.filter((candidate) => candidate.allocationRisk === "unallocated").length,
    },
  };
}

export async function getExperimentCandidateView(
  actor: LabActor = GLOBAL_READ_ACTOR,
  desiredNumber = 4,
  desiredSex: "male" | "female" | "either" = "female",
  minAgeDays = 28,
  maxAgeDays = 140,
  genotypeKeyword = "Cre",
): Promise<ExperimentCandidate[]> {
  const view = await getExperimentPlannerView(actor, {
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
    balanceByAge: true,
    maxSameCagePerGroup: 1,
  });

  return view.candidates;
}
