"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import {
  executeDeletePlannedExperimentAssignmentCommand,
  executeDemoteExperimentAssignmentsCommand,
  executePlanExperimentAssignmentsCommand,
  executePromoteExperimentAssignmentsCommand,
  executeUpdatePlannedExperimentAssignmentCommand,
} from "@/lib/experiment-assignment-write";
import {
  executeCreateExperimentCommand,
  executeTransitionExperimentCommand,
  executeUpdateExperimentCommand,
} from "@/lib/experiments-write";
import { requireUser } from "@/lib/session";

const experimentDetailsSchema = z.object({
  labId: z.string().trim().optional(),
  projectId: z.string().trim().min(1),
  protocolAuthorizationId: z.string().trim().optional(),
  experimentCode: z.string().trim().min(2).max(40),
  title: z.string().trim().min(3).max(160),
  plannedStartAt: z.string().trim().optional(),
  plannedEndAt: z.string().trim().optional(),
  operationalContact: z.string().trim().max(160).optional(),
  procedureSummary: z.string().trim().max(2_000).optional(),
  treatmentSummary: z.string().trim().max(2_000).optional(),
  welfareRisks: z.string().trim().max(2_000).optional(),
  scheduleNotes: z.string().trim().max(2_000).optional(),
  operationalNotes: z.string().trim().max(2_000).optional(),
  notes: z.string().trim().max(4_000).optional(),
  resultSummary: z.string().trim().max(4_000).optional(),
  idempotencyKey: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
});

function experimentDetailsFromForm(formData: FormData) {
  return {
    labId: formData.get("labId") || undefined,
    projectId: formData.get("projectId"),
    protocolAuthorizationId: formData.get("protocolAuthorizationId") || undefined,
    experimentCode: formData.get("experimentCode"),
    title: formData.get("title"),
    plannedStartAt: formData.get("plannedStartAt") || undefined,
    plannedEndAt: formData.get("plannedEndAt") || undefined,
    operationalContact: formData.get("operationalContact") || undefined,
    procedureSummary: formData.get("procedureSummary") || undefined,
    treatmentSummary: formData.get("treatmentSummary") || undefined,
    welfareRisks: formData.get("welfareRisks") || undefined,
    scheduleNotes: formData.get("scheduleNotes") || undefined,
    operationalNotes: formData.get("operationalNotes") || undefined,
    notes: formData.get("notes") || undefined,
    resultSummary: formData.get("resultSummary") || undefined,
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
  };
}

function revalidateExperiments() {
  revalidatePath("/experiments");
  after(() => {
    revalidatePath("/");
  });
}

function revalidateExperimentAssignments() {
  after(() => {
    revalidatePath("/");
    revalidatePath("/animals");
    revalidatePath("/experiments");
  });
}

function commandMessage(result: { result?: unknown; message?: string }, fallback: string) {
  if (result.result && typeof result.result === "object" && !Array.isArray(result.result)) {
    const message = (result.result as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return result.message ?? fallback;
}

function parseJsonField(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function createExperimentAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "experiments:manage" });
  const parsed = experimentDetailsSchema.safeParse(experimentDetailsFromForm(formData));
  if (!parsed.success) {
    return { status: "error", message: "Enter a lab, project, experiment code, title, and valid worksheet details." };
  }
  const { idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeCreateExperimentCommand({ actor: user, command, idempotencyKey, requestId });
  if (!result.ok) return { status: "error", message: result.message };
  revalidateExperiments();
  return { status: "success", message: "Experiment created in planned status." };
}

const updateExperimentSchema = experimentDetailsSchema.extend({
  experimentId: z.string().trim().min(1),
  expectedVersion: z.string().trim().regex(/^\d+$/).transform(Number),
});

export async function updateExperimentAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "experiments:manage" });
  const parsed = updateExperimentSchema.safeParse({
    ...experimentDetailsFromForm(formData),
    experimentId: formData.get("experimentId"),
    expectedVersion: formData.get("expectedVersion"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Refresh the experiment and check every worksheet field before saving." };
  }
  const { idempotencyKey, requestId, expectedVersion, ...command } = parsed.data;
  const result = await executeUpdateExperimentCommand({ actor: user, command, expectedVersion, idempotencyKey, requestId });
  if (!result.ok) return { status: "error", message: result.message };
  revalidateExperiments();
  return { status: "success", message: "Experiment worksheet updated." };
}

const transitionExperimentSchema = z.object({
  experimentId: z.string().trim().min(1),
  labId: z.string().trim().optional(),
  status: z.enum(["active", "completed", "cancelled"]),
  expectedVersion: z.string().trim().regex(/^\d+$/).transform(Number),
  idempotencyKey: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
});

export async function transitionExperimentStatusAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "experiments:manage" });
  const parsed = transitionExperimentSchema.safeParse({
    experimentId: formData.get("experimentId"),
    labId: formData.get("labId") || undefined,
    status: formData.get("status"),
    expectedVersion: formData.get("expectedVersion"),
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
  });
  if (!parsed.success) return { status: "error", message: "Refresh the experiment and choose a valid next status." };
  const { idempotencyKey, requestId, expectedVersion, ...command } = parsed.data;
  const result = await executeTransitionExperimentCommand({ actor: user, command, expectedVersion, idempotencyKey, requestId });
  if (!result.ok) return { status: "error", message: result.message };
  revalidateExperiments();
  return { status: "success", message: `Experiment moved to ${command.status}.` };
}

const planExperimentCohortSchema = z.object({
  experimentId: z.string().trim().min(1),
  startDate: z.string().trim().min(1),
  notes: z.string().trim().max(400).optional(),
  expectedExperimentVersion: z.coerce.number().int().positive(),
  assignments: z.array(z.object({
    animalId: z.string().trim().min(1),
    treatmentGroup: z.string().trim().min(1).max(80),
  })).min(1).max(100),
  idempotencyKey: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
});

export async function planExperimentCohortAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "experiments:manage" });
  const parsed = planExperimentCohortSchema.safeParse({
    experimentId: formData.get("experimentId"),
    startDate: formData.get("startDate"),
    notes: formData.get("notes") || undefined,
    expectedExperimentVersion: formData.get("expectedExperimentVersion"),
    assignments: parseJsonField(formData.get("assignmentsJson")),
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose an experiment and planned start date before saving the cohort layout.",
    };
  }

  const result = await executePlanExperimentAssignmentsCommand({
    actor: user,
    command: {
      experimentId: parsed.data.experimentId,
      startDate: parsed.data.startDate,
      notes: parsed.data.notes,
      assignments: parsed.data.assignments,
    },
    expectedExperimentVersion: parsed.data.expectedExperimentVersion,
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidateExperimentAssignments();

  return {
    status: "success",
    message: commandMessage(result, "Cohort plan saved."),
  };
}

const promotePlannedCohortSchema = z.object({
  experimentId: z.string().trim().min(1),
  expectedExperimentVersion: z.coerce.number().int().positive(),
  assignments: z.array(z.object({
    assignmentId: z.string().trim().min(1),
    expectedVersion: z.number().int().positive(),
  })).min(1).max(100),
  idempotencyKey: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
});

export async function promotePlannedCohortAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "experiments:manage" });
  const parsed = promotePlannedCohortSchema.safeParse({
    experimentId: formData.get("experimentId"),
    expectedExperimentVersion: formData.get("expectedExperimentVersion"),
    assignments: parseJsonField(formData.get("assignmentsJson")),
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose an experiment before promoting the planned cohort.",
    };
  }

  const result = await executePromoteExperimentAssignmentsCommand({
    actor: user,
    command: { experimentId: parsed.data.experimentId, assignments: parsed.data.assignments },
    expectedExperimentVersion: parsed.data.expectedExperimentVersion,
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidateExperimentAssignments();

  return {
    status: "success",
    message: commandMessage(result, "Planned cohort promoted."),
  };
}

export async function demoteReservedCohortAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "experiments:manage" });
  const parsed = promotePlannedCohortSchema.safeParse({
    experimentId: formData.get("experimentId"),
    expectedExperimentVersion: formData.get("expectedExperimentVersion"),
    assignments: parseJsonField(formData.get("assignmentsJson")),
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose an experiment before rolling back reserved assignments.",
    };
  }

  const result = await executeDemoteExperimentAssignmentsCommand({
    actor: user,
    command: { experimentId: parsed.data.experimentId, assignments: parsed.data.assignments },
    expectedExperimentVersion: parsed.data.expectedExperimentVersion,
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidateExperimentAssignments();

  return {
    status: "success",
    message: commandMessage(result, "Reserved cohort returned to planned."),
  };
}

const updatePlannedAssignmentSchema = z.object({
  experimentId: z.string().trim().min(1),
  assignmentId: z.string().trim().min(1),
  startDate: z.string().trim().min(1),
  treatmentGroup: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(400).optional(),
  expectedExperimentVersion: z.coerce.number().int().positive(),
  expectedAssignmentVersion: z.coerce.number().int().positive(),
  idempotencyKey: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
});

export async function updatePlannedAssignmentAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "experiments:manage" });
  const parsed = updatePlannedAssignmentSchema.safeParse({
    experimentId: formData.get("experimentId"),
    assignmentId: formData.get("assignmentId"),
    startDate: formData.get("startDate"),
    treatmentGroup: formData.get("treatmentGroup") || undefined,
    notes: formData.get("notes") || undefined,
    expectedExperimentVersion: formData.get("expectedExperimentVersion"),
    expectedAssignmentVersion: formData.get("expectedAssignmentVersion"),
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a valid start date before updating the planned assignment.",
    };
  }

  const result = await executeUpdatePlannedExperimentAssignmentCommand({
    actor: user,
    command: {
      experimentId: parsed.data.experimentId,
      assignmentId: parsed.data.assignmentId,
      startDate: parsed.data.startDate,
      treatmentGroup: parsed.data.treatmentGroup,
      notes: parsed.data.notes,
    },
    expectedExperimentVersion: parsed.data.expectedExperimentVersion,
    expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidateExperimentAssignments();

  return {
    status: "success",
    message: commandMessage(result, "Planned assignment updated."),
  };
}

const deletePlannedAssignmentSchema = z.object({
  experimentId: z.string().trim().min(1),
  assignmentId: z.string().trim().min(1),
  expectedExperimentVersion: z.coerce.number().int().positive(),
  expectedAssignmentVersion: z.coerce.number().int().positive(),
  idempotencyKey: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
});

export async function deletePlannedAssignmentAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "experiments:manage" });
  const parsed = deletePlannedAssignmentSchema.safeParse({
    experimentId: formData.get("experimentId"),
    assignmentId: formData.get("assignmentId"),
    expectedExperimentVersion: formData.get("expectedExperimentVersion"),
    expectedAssignmentVersion: formData.get("expectedAssignmentVersion"),
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a planned assignment before removing it.",
    };
  }

  const result = await executeDeletePlannedExperimentAssignmentCommand({
    actor: user,
    command: { experimentId: parsed.data.experimentId, assignmentId: parsed.data.assignmentId },
    expectedExperimentVersion: parsed.data.expectedExperimentVersion,
    expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidateExperimentAssignments();

  return {
    status: "success",
    message: commandMessage(result, "Planned assignment removed."),
  };
}
