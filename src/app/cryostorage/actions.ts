"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createCryostorageRecord, updateCryostorageRecord } from "@/lib/colony-write";
import {
  executeCancelCryostorageRequestCommand,
  executeCryostorageRequestCommand,
  executeSubmitCryostorageRequestCommand,
} from "@/lib/cryostorage-write";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

const commandIdentitySchema = z.object({
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
});

const submitCryostorageRequestSchema = commandIdentitySchema.extend({
  labId: z.string().trim().min(1),
  requestType: z.enum(["store", "recover", "discard"]),
  targetRecordId: z.string().trim().optional(),
  strainId: z.string().trim().optional(),
  projectId: z.string().trim().optional(),
  sampleLabel: z.string().trim().max(80).optional(),
  materialType: z.string().trim().max(80).optional(),
  requestedQuantityLabel: z.string().trim().max(100).optional(),
  requestedStorageLocation: z.string().trim().max(160).optional(),
  requestedFor: z.string().trim().min(1),
  notes: z.string().trim().max(1000).optional(),
});

const cancelCryostorageRequestSchema = commandIdentitySchema.extend({
  cryostorageRequestId: z.string().trim().min(1),
  labId: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3).max(1000),
});

const executeCryostorageRequestSchema = commandIdentitySchema.extend({
  cryostorageRequestId: z.string().trim().min(1),
  labId: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  action: z.enum(["complete", "reject"]),
  performedAt: z.string().trim().optional(),
  resultingStatus: z.enum(["recovered", "depleted"]).optional(),
  storageLocation: z.string().trim().max(160).optional(),
  quantityLabel: z.string().trim().max(100).optional(),
  reason: z.string().trim().max(1000).optional(),
  operationNotes: z.string().trim().max(1000).optional(),
});

function commandFormState(result: { ok: boolean; message?: string; result?: unknown }): FormActionState {
  if (!result.ok) return { status: "error", message: result.message ?? "The cryostorage request could not be saved." };
  const payload = result.result && typeof result.result === "object" ? result.result as { message?: string } : null;
  return { status: "success", message: payload?.message ?? "Cryostorage request saved." };
}

function revalidateCryostorageViews() {
  revalidatePath("/cryostorage");
  revalidatePath("/workbook");
  revalidatePath("/forecast");
}

export async function submitCryostorageRequestAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "cryostorage:request" });
  const parsed = submitCryostorageRequestSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
    labId: formData.get("labId"),
    requestType: formData.get("requestType"),
    targetRecordId: formData.get("targetRecordId") || undefined,
    strainId: formData.get("strainId") || undefined,
    projectId: formData.get("projectId") || undefined,
    sampleLabel: formData.get("sampleLabel") || undefined,
    materialType: formData.get("materialType") || undefined,
    requestedQuantityLabel: formData.get("requestedQuantityLabel") || undefined,
    requestedStorageLocation: formData.get("requestedStorageLocation") || undefined,
    requestedFor: formData.get("requestedFor"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { status: "error", message: "Complete the request details and try again." };
  const { idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeSubmitCryostorageRequestCommand({ actor, command, idempotencyKey, requestId });
  if (result.ok) revalidateCryostorageViews();
  return commandFormState(result);
}

export async function cancelCryostorageRequestAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "cryostorage:request" });
  const parsed = cancelCryostorageRequestSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
    cryostorageRequestId: formData.get("cryostorageRequestId"),
    labId: formData.get("labId"),
    expectedVersion: formData.get("expectedVersion"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { status: "error", message: "Enter a clear cancellation reason." };
  const { cryostorageRequestId, expectedVersion, idempotencyKey, requestId, ...fields } = parsed.data;
  const result = await executeCancelCryostorageRequestCommand({
    actor,
    command: { ...fields, requestId: cryostorageRequestId },
    expectedVersion,
    idempotencyKey,
    requestId,
  });
  if (result.ok) revalidateCryostorageViews();
  return commandFormState(result);
}

export async function executeCryostorageRequestAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "cryostorage:manage" });
  const parsed = executeCryostorageRequestSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
    cryostorageRequestId: formData.get("cryostorageRequestId"),
    labId: formData.get("labId"),
    expectedVersion: formData.get("expectedVersion"),
    action: formData.get("action"),
    performedAt: formData.get("performedAt") || undefined,
    resultingStatus: formData.get("resultingStatus") || undefined,
    storageLocation: formData.get("storageLocation") || undefined,
    quantityLabel: formData.get("quantityLabel") || undefined,
    reason: formData.get("reason") || undefined,
    operationNotes: formData.get("operationNotes") || undefined,
  });
  if (!parsed.success) return { status: "error", message: "Complete the operation details and try again." };
  const { cryostorageRequestId, expectedVersion, idempotencyKey, requestId, ...fields } = parsed.data;
  const result = await executeCryostorageRequestCommand({
    actor,
    command: { ...fields, requestId: cryostorageRequestId },
    expectedVersion,
    idempotencyKey,
    requestId,
  });
  if (result.ok) revalidateCryostorageViews();
  return commandFormState(result);
}

const recordCryostorageSchema = z.object({
  strainId: z.string().trim().min(1),
  projectId: z.string().trim().optional(),
  sampleLabel: z.string().trim().min(3).max(80),
  materialType: z.string().trim().min(2).max(80),
  status: z.enum(["stored", "reserved", "recovered", "depleted", "discarded"]),
  storedAt: z.string().trim().min(1),
  storageLocation: z.string().trim().max(120).optional(),
  quantityLabel: z.string().trim().max(80).optional(),
  recoveryNotes: z.string().trim().max(400).optional(),
  notes: z.string().trim().max(400).optional(),
});

export async function recordCryostorageAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "cryostorage:manage" });
  const parsed = recordCryostorageSchema.safeParse({
    strainId: formData.get("strainId"),
    projectId: formData.get("projectId") || undefined,
    sampleLabel: formData.get("sampleLabel"),
    materialType: formData.get("materialType"),
    status: formData.get("status"),
    storedAt: formData.get("storedAt"),
    storageLocation: formData.get("storageLocation") || undefined,
    quantityLabel: formData.get("quantityLabel") || undefined,
    recoveryNotes: formData.get("recoveryNotes") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a strain, add the cryostorage label and material type, then enter the storage date before saving.",
    };
  }

  const result = await createCryostorageRecord(parsed.data, { id: user.id, role: user.role, activeLabId: user.activeLabId });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/cryostorage");
  revalidatePath("/settings");

  return {
    status: "success",
    message: result.message,
  };
}

const updateCryostorageSchema = z.object({
  recordId: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  status: z.enum(["stored", "reserved", "recovered", "depleted", "discarded"]),
  storageLocation: z.string().trim().max(120).optional(),
  quantityLabel: z.string().trim().max(80).optional(),
  recoveryNotes: z.string().trim().max(400).optional(),
  notes: z.string().trim().max(400).optional(),
});

export async function updateCryostorageInventoryAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const user = await requireUser({ capability: "cryostorage:manage" });
  const parsed = updateCryostorageSchema.safeParse({
    recordId: formData.get("recordId"),
    expectedVersion: formData.get("expectedVersion"),
    status: formData.get("status"),
    storageLocation: formData.get("storageLocation") || undefined,
    quantityLabel: formData.get("quantityLabel") || undefined,
    recoveryNotes: formData.get("recoveryNotes") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Choose a valid status and keep storage, quantity, recovery notes, and notes within their limits.",
    };
  }

  const result = await updateCryostorageRecord(parsed.data, { id: user.id, role: user.role, activeLabId: user.activeLabId });

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
    };
  }

  revalidatePath("/cryostorage");
  revalidatePath("/settings");

  return {
    status: "success",
    message: result.message,
  };
}
