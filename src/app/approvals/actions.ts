"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { FormActionState } from "@/lib/form-state";
import {
  executeCancelLabTransferCommand,
  executeDecideLabTransferCommand,
  executeFinalizeLabTransferCommand,
  executeRequestLabTransferCommand,
  executeReviseLabTransferCommand,
} from "@/lib/lab-transfer-write";
import { requireUser } from "@/lib/session";

const identitySchema = {
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
};

const transferRequestSchema = z.object({
  subjectType: z.enum(["cage", "animals"]),
  sourceCageId: z.string().trim().optional(),
  animalIdsJson: z.string().trim().optional(),
  destinationLabId: z.string().trim().min(1),
  requestedEffectiveAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3).max(600),
  sourcePrivateNote: z.string().trim().max(1_000).optional(),
  sourceProtocolAuthorizationId: z.string().trim().min(1),
  ...identitySchema,
});

const decisionSchema = z.object({
  transferRequestId: z.string().trim().min(1),
  decision: z.enum(["accept", "reject"]),
  destinationCageId: z.string().trim().optional(),
  note: z.string().trim().max(600).optional(),
  destinationProtocolAuthorizationId: z.string().trim().optional(),
  expectedVersion: z.coerce.number().int().min(1),
  ...identitySchema,
});

const revisionSchema = z.object({
  transferRequestId: z.string().trim().min(1),
  destinationLabId: z.string().trim().min(1),
  requestedEffectiveAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3).max(600),
  sourcePrivateNote: z.string().trim().max(1_000).optional(),
  sourceProtocolAuthorizationId: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().min(1),
  ...identitySchema,
});

const cancelSchema = z.object({
  transferRequestId: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(600),
  expectedVersion: z.coerce.number().int().min(1),
  ...identitySchema,
});

const finalizeSchema = z.object({
  transferRequestId: z.string().trim().min(1),
  overrideReason: z.string().trim().max(1_000).optional(),
  expectedVersion: z.coerce.number().int().min(1),
  ...identitySchema,
});

function resultFeedback(result: { ok: boolean; message?: string; result?: unknown }, fallback: string): FormActionState {
  if (!result.ok) return { status: "error", message: result.message ?? fallback };
  const payload = result.result && typeof result.result === "object" && !Array.isArray(result.result)
    ? result.result as { message?: string }
    : null;
  return { status: "success", message: payload?.message ?? fallback };
}

function revalidateTransfers() {
  revalidatePath("/");
  revalidatePath("/approvals");
  revalidatePath("/animals");
  revalidatePath("/cages");
  revalidatePath("/billing");
  revalidatePath("/notifications");
  revalidatePath("/workbook");
}

export async function requestLabTransferAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "transfers:request" });
  const parsed = transferRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose an active source protocol, destination lab, transfer date, and reason." };
  let animalIds: string[] = [];
  if (parsed.data.subjectType === "animals") {
    try {
      const decoded: unknown = JSON.parse(parsed.data.animalIdsJson || "[]");
      animalIds = z.array(z.string().trim().min(1)).min(1).max(50).parse(decoded);
    } catch {
      return { status: "error", message: "Choose at least one source-lab animal." };
    }
  }
  const { idempotencyKey, requestId, animalIdsJson: _animalIdsJson, ...fields } = parsed.data;
  void _animalIdsJson;
  const result = await executeRequestLabTransferCommand({
    actor,
    command: { ...fields, animalIds },
    idempotencyKey,
    requestId,
  });
  if (result.ok) revalidateTransfers();
  return resultFeedback(result, "Transfer request could not be created.");
}

export async function decideLabTransferAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "transfers:approve" });
  const parsed = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success || (parsed.data.decision === "accept" && !parsed.data.destinationProtocolAuthorizationId)) {
    return { status: "error", message: "Choose an active destination protocol before accepting the transfer." };
  }
  const { transferRequestId, expectedVersion, idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeDecideLabTransferCommand({
    actor,
    command: { ...command, requestId: transferRequestId },
    expectedVersion,
    idempotencyKey,
    requestId,
  });
  if (result.ok) revalidateTransfers();
  return resultFeedback(result, "Destination decision could not be saved.");
}

export async function reviseLabTransferAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "transfers:request" });
  const parsed = revisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Review the active source protocol, destination, date, and reason." };
  const { transferRequestId, expectedVersion, idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeReviseLabTransferCommand({
    actor,
    command: { ...command, requestId: transferRequestId },
    expectedVersion,
    idempotencyKey,
    requestId,
  });
  if (result.ok) revalidateTransfers();
  return resultFeedback(result, "Transfer packet could not be revised.");
}

export async function cancelLabTransferAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "transfers:request" });
  const parsed = cancelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Enter a cancellation reason." };
  const { transferRequestId, expectedVersion, idempotencyKey, requestId, reason } = parsed.data;
  const result = await executeCancelLabTransferCommand({
    actor,
    command: { requestId: transferRequestId, reason },
    expectedVersion,
    idempotencyKey,
    requestId,
  });
  if (result.ok) revalidateTransfers();
  return resultFeedback(result, "Transfer request could not be cancelled.");
}

export async function finalizeLabTransferAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "transfers:finalize" });
  const parsed = finalizeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the request and review finalization details." };
  const { transferRequestId, expectedVersion, idempotencyKey, requestId, overrideReason } = parsed.data;
  const result = await executeFinalizeLabTransferCommand({
    actor,
    command: { requestId: transferRequestId, overrideReason },
    expectedVersion,
    idempotencyKey,
    requestId,
  });
  if (result.ok) revalidateTransfers();
  return resultFeedback(result, "Transfer could not be finalized.");
}
