"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  deletePlannedExperimentAssignment,
  planExperimentCohortAssignments,
  promotePlannedExperimentAssignments,
  updatePlannedExperimentAssignment,
} from "@/lib/colony-write";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { getExperimentPlannerView, parseExperimentPlannerFilters } from "@/lib/experiments-read";
import { requireUser } from "@/lib/session";

const planExperimentCohortSchema = z.object({
  experimentId: z.string().trim().min(1),
  startDate: z.string().trim().min(1),
  notes: z.string().trim().max(400).optional(),
  desiredNumber: z.string().trim().min(1),
  sex: z.string().trim().optional(),
  minAgeDays: z.string().trim().min(1),
  maxAgeDays: z.string().trim().min(1),
  genotypeKeyword: z.string().trim().optional(),
  strainId: z.string().trim().optional(),
  projectId: z.string().trim().optional(),
  includeReserved: z.string().trim().optional(),
  allowOverlap: z.string().trim().optional(),
  balanceByCage: z.string().trim().optional(),
  avoidSiblingClustering: z.string().trim().optional(),
  groupCount: z.string().trim().min(1),
  randomSeed: z.string().trim().optional(),
  blockBySex: z.string().trim().optional(),
  blockBySiblingGroup: z.string().trim().optional(),
});

export async function planExperimentCohortAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser();
  const parsed = planExperimentCohortSchema.safeParse({
    experimentId: formData.get("experimentId"),
    startDate: formData.get("startDate"),
    notes: formData.get("notes") || undefined,
    desiredNumber: formData.get("desiredNumber"),
    sex: formData.get("sex") || undefined,
    minAgeDays: formData.get("minAgeDays"),
    maxAgeDays: formData.get("maxAgeDays"),
    genotypeKeyword: formData.get("genotypeKeyword") || undefined,
    strainId: formData.get("strainId") || undefined,
    projectId: formData.get("projectId") || undefined,
    includeReserved: formData.get("includeReserved") || undefined,
    allowOverlap: formData.get("allowOverlap") || undefined,
    balanceByCage: formData.get("balanceByCage") || undefined,
    avoidSiblingClustering: formData.get("avoidSiblingClustering") || undefined,
    groupCount: formData.get("groupCount"),
    randomSeed: formData.get("randomSeed") || undefined,
    blockBySex: formData.get("blockBySex") || undefined,
    blockBySiblingGroup: formData.get("blockBySiblingGroup") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose an experiment and planned start date before saving the cohort layout.",
    };
  }

  const filters = parseExperimentPlannerFilters({
    desiredNumber: parsed.data.desiredNumber,
    sex: parsed.data.sex,
    minAgeDays: parsed.data.minAgeDays,
    maxAgeDays: parsed.data.maxAgeDays,
    genotypeKeyword: parsed.data.genotypeKeyword,
    strainId: parsed.data.strainId,
    projectId: parsed.data.projectId,
    includeReserved: parsed.data.includeReserved,
    allowOverlap: parsed.data.allowOverlap,
    balanceByCage: parsed.data.balanceByCage,
    avoidSiblingClustering: parsed.data.avoidSiblingClustering,
    groupCount: parsed.data.groupCount,
    randomSeed: parsed.data.randomSeed,
    blockBySex: parsed.data.blockBySex,
    blockBySiblingGroup: parsed.data.blockBySiblingGroup,
  });

  const planner = await getExperimentPlannerView(filters);
  const selectedAnimals = planner.randomization.groups.flatMap((group) =>
    group.members.map((member) => ({
      animalId: member.animalId,
      treatmentGroup: group.name,
    })),
  );

  const result = await planExperimentCohortAssignments(
    {
      experimentId: parsed.data.experimentId,
      startDate: parsed.data.startDate,
      notes: parsed.data.notes,
      selectedAnimals,
    },
    { id: user.id, role: user.role },
  );

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/");
  revalidatePath("/animals");
  revalidatePath("/experiments");

  return {
    status: "success",
    message: result.message,
  };
}

const promotePlannedCohortSchema = z.object({
  experimentId: z.string().trim().min(1),
});

export async function promotePlannedCohortAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser();
  const parsed = promotePlannedCohortSchema.safeParse({
    experimentId: formData.get("experimentId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose an experiment before promoting the planned cohort.",
    };
  }

  const result = await promotePlannedExperimentAssignments(parsed.data, { id: user.id, role: user.role });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/");
  revalidatePath("/animals");
  revalidatePath("/experiments");

  return {
    status: "success",
    message: result.message,
  };
}

const updatePlannedAssignmentSchema = z.object({
  assignmentId: z.string().trim().min(1),
  startDate: z.string().trim().min(1),
  treatmentGroup: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(400).optional(),
});

export async function updatePlannedAssignmentAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser();
  const parsed = updatePlannedAssignmentSchema.safeParse({
    assignmentId: formData.get("assignmentId"),
    startDate: formData.get("startDate"),
    treatmentGroup: formData.get("treatmentGroup") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a valid start date before updating the planned assignment.",
    };
  }

  const result = await updatePlannedExperimentAssignment(parsed.data, { id: user.id, role: user.role });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/");
  revalidatePath("/animals");
  revalidatePath("/experiments");

  return {
    status: "success",
    message: result.message,
  };
}

const deletePlannedAssignmentSchema = z.object({
  assignmentId: z.string().trim().min(1),
});

export async function deletePlannedAssignmentAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser();
  const parsed = deletePlannedAssignmentSchema.safeParse({
    assignmentId: formData.get("assignmentId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a planned assignment before removing it.",
    };
  }

  const result = await deletePlannedExperimentAssignment(parsed.data, { id: user.id, role: user.role });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/");
  revalidatePath("/animals");
  revalidatePath("/experiments");

  return {
    status: "success",
    message: result.message,
  };
}
