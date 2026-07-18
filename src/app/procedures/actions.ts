"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import {
  executeCancelProcedurePlanCommand,
  executeCreateProcedurePlanCommand,
  executeRecordProcedureOccurrenceCommand,
} from "@/lib/procedure-write";
import { requireUser } from "@/lib/session";

const identityFields = {
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
};

const createPlanSchema = z.object({
  planId: z.string().trim().min(16),
  labId: z.string().trim().min(1),
  assignmentId: z.string().trim().min(1),
  sopAssignmentId: z.string().trim().min(1),
  procedureCode: z.string().trim().min(2).max(80),
  title: z.string().trim().min(2).max(160),
  scheduledAt: z.string().trim().min(1),
  expectedAssignmentVersion: z.coerce.number().int().positive(),
  expectedExperimentVersion: z.coerce.number().int().positive(),
  ...identityFields,
});

const cancelPlanSchema = z.object({
  planId: z.string().trim().min(1),
  labId: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(400),
  expectedVersion: z.coerce.number().int().positive(),
  ...identityFields,
});

const recordOccurrenceSchema = z.object({
  planId: z.string().trim().min(1),
  labId: z.string().trim().min(1),
  occurrenceKey: z.string().trim().min(1).max(120),
  occurredAt: z.string().trim().min(1),
  status: z.enum(["completed", "not_performed", "aborted"]),
  outcomeNote: z.string().trim().max(500).optional(),
  expectedVersion: z.coerce.number().int().positive(),
  ...identityFields,
}).superRefine((value, context) => {
  if (value.status !== "completed" && (value.outcomeNote?.length ?? 0) < 3) {
    context.addIssue({ code: "custom", path: ["outcomeNote"], message: "Describe why the procedure was not completed." });
  }
});

function revalidateProcedures(planId?: string) {
  revalidatePath("/");
  revalidatePath("/animals");
  revalidatePath("/experiments");
  revalidatePath("/procedures");
  if (planId) revalidatePath(`/api/v1/procedures/${planId}/occurrences`);
}

function feedback(
  result: { ok: boolean; message?: string; result?: unknown },
  fallback: string,
): FormActionState {
  if (!result.ok) return { status: "error", message: result.message ?? fallback };
  const saved = result.result as { message?: string } | undefined;
  return { status: "success", message: saved?.message ?? fallback };
}

export async function createProcedurePlanAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "procedures:plan" });
  const parsed = createPlanSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose an assignment, assigned SOP, schedule, code, and title." };
  const { expectedAssignmentVersion, expectedExperimentVersion, idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeCreateProcedurePlanCommand({
    actor,
    command,
    expectedAssignmentVersion,
    expectedExperimentVersion,
    idempotencyKey,
    requestId,
  });
  if (result.ok) revalidateProcedures(command.planId);
  return feedback(result, "Procedure plan could not be saved.");
}

export async function cancelProcedurePlanAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "procedures:plan" });
  const parsed = cancelPlanSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the plan and enter a cancellation reason." };
  const { expectedVersion, idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeCancelProcedurePlanCommand({ actor, command, expectedVersion, idempotencyKey, requestId });
  if (result.ok) revalidateProcedures(command.planId);
  return feedback(result, "Procedure plan could not be cancelled.");
}

export async function recordProcedureOccurrenceAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "procedures:execute" });
  const parsed = recordOccurrenceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose the occurrence time and provide an outcome reason when needed." };
  const { expectedVersion, idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeRecordProcedureOccurrenceCommand({ actor, command, expectedVersion, idempotencyKey, requestId });
  if (result.ok) revalidateProcedures(command.planId);
  return feedback(result, "Procedure outcome could not be recorded.");
}
