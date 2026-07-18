"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { prepareWorkflowReview } from "@/lib/command-foundation";
import type { FormActionState } from "@/lib/form-state";
import {
  executeAdmitQuarantineCaseCommand,
  executeRecordQuarantineObservationCommand,
  executeRequestQuarantineReleaseCommand,
  executeFinalizeQuarantineReleaseCommand,
} from "@/lib/quarantine-write";
import { requireUser } from "@/lib/session";

const identitySchema = {
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
};

const admissionSchema = z.object({
  cageId: z.string().trim().min(1),
  admittedAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  minimumHoldDays: z.coerce.number().int().min(1).max(180),
  reason: z.string().trim().min(3).max(400),
  expectedCageVersion: z.coerce.number().int().min(1),
  ...identitySchema,
});

const observationSchema = z.object({
  caseId: z.string().trim().min(1),
  observedAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  result: z.enum(["clear", "monitor", "exception", "exception_resolved"]),
  severity: z.enum(["info", "warning", "critical"]),
  note: z.string().trim().min(3).max(600),
  followupRequired: z.enum(["on"]).optional().transform(Boolean),
  expectedVersion: z.coerce.number().int().min(1),
  ...identitySchema,
});

const releaseRequestSchema = z.object({
  caseId: z.string().trim().min(1),
  requestedAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3).max(400),
  expectedVersion: z.coerce.number().int().min(1),
  ...identitySchema,
});

const releaseAssignmentSchema = z.array(z.object({
  animalId: z.string().trim().min(1),
  toCageId: z.string().trim().min(1),
})).max(100);

const finalizeReleaseSchema = z.object({
  caseId: z.string().trim().min(1),
  releasedAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3).max(400),
  expectedVersion: z.coerce.number().int().min(1),
  assignmentsJson: z.string().trim().min(2),
  workflowDraftId: z.string().trim().min(16),
  ...identitySchema,
});

function feedback(result: { ok: boolean; message?: string; result?: unknown }, fallback: string): FormActionState {
  if (!result.ok) return { status: "error", message: result.message ?? fallback };
  const payload = result.result && typeof result.result === "object" && !Array.isArray(result.result)
    ? result.result as { message?: string }
    : null;
  return { status: "success", message: payload?.message ?? fallback };
}

function revalidateQuarantine() {
  revalidatePath("/");
  revalidatePath("/quarantine");
  revalidatePath("/cages");
  revalidatePath("/notifications");
}

export async function admitQuarantineCaseAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "quarantine:manage" });
  const parsed = admissionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a cage, admission date, holding period, and reason." };
  const { expectedCageVersion, idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeAdmitQuarantineCaseCommand({ actor, command, expectedCageVersion, idempotencyKey, requestId });
  if (result.ok) revalidateQuarantine();
  return feedback(result, "Quarantine admission could not be saved.");
}

export async function recordQuarantineObservationAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "quarantine:manage" });
  const parsed = observationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose an observation result, severity, date, and note." };
  const { expectedVersion, idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeRecordQuarantineObservationCommand({ actor, command, expectedVersion, idempotencyKey, requestId });
  if (result.ok) revalidateQuarantine();
  return feedback(result, "Quarantine observation could not be saved.");
}

export async function requestQuarantineReleaseAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "quarantine:manage" });
  const parsed = releaseRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a request date and enter a release reason." };
  const { expectedVersion, idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeRequestQuarantineReleaseCommand({ actor, command, expectedVersion, idempotencyKey, requestId });
  if (result.ok) revalidateQuarantine();
  return feedback(result, "Quarantine release could not be requested.");
}

export async function finalizeQuarantineReleaseAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "quarantine:manage" });
  const parsed = finalizeReleaseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Review every animal destination, release date, and reason before finalizing." };
  let assignments: z.infer<typeof releaseAssignmentSchema>;
  try {
    assignments = releaseAssignmentSchema.parse(JSON.parse(parsed.data.assignmentsJson));
  } catch {
    return { status: "error", message: "The release assignment plan is invalid. Refresh and review it again." };
  }
  const { expectedVersion, idempotencyKey, requestId, workflowDraftId, assignmentsJson: _assignmentsJson, ...fields } = parsed.data;
  void _assignmentsJson;
  const command = { ...fields, assignments };
  const review = await prepareWorkflowReview({
    actor,
    draftId: workflowDraftId,
    workflowType: "quarantine.release",
    requiredCapability: "quarantine:manage",
    labId: actor.canonicalRole === "lab_user" ? actor.activeLabId : null,
    payload: { command, expectedVersion } as unknown as Prisma.InputJsonValue,
    allowCommittedReplay: true,
  });
  if (!review.ok) return { status: "error", message: review.message };
  const result = await executeFinalizeQuarantineReleaseCommand({
    actor,
    command,
    expectedVersion,
    idempotencyKey,
    requestId,
    workflowDraftId: review.draft.id,
    reviewSnapshotId: review.snapshot.id,
  });
  if (result.ok) {
    revalidateQuarantine();
    for (const assignment of assignments) revalidatePath(`/animals/${assignment.animalId}`);
  }
  return feedback(result, "Quarantine release could not be finalized.");
}
