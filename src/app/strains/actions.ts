"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";
import {
  executeCreateStrainDirectoryListingCommand,
  executeDecideStrainDirectoryRequestCommand,
  executeSubmitStrainDirectoryRequestCommand,
  executeUpdateStrainDirectoryListingCommand,
} from "@/lib/strain-directory-write";

const commandIdentitySchema = z.object({
  idempotencyKey: z.string().trim().min(16),
  requestId: z.string().trim().min(16),
});

const createListingSchema = commandIdentitySchema.extend({
  labId: z.string().trim().min(1),
  strainId: z.string().trim().min(1),
  contactUserId: z.string().trim().min(1),
});

const updateListingSchema = commandIdentitySchema.extend({
  listingId: z.string().trim().min(1),
  contactUserId: z.string().trim().min(1),
  status: z.enum(["draft", "shared", "paused"]),
  expectedVersion: z.coerce.number().int().positive(),
});

const submitRequestSchema = commandIdentitySchema.extend({
  listingId: z.string().trim().min(1),
  requestType: z.enum(["contact", "material"]),
  purpose: z.string().trim().max(500).optional(),
});

const decideRequestSchema = commandIdentitySchema.extend({
  strainDirectoryRequestId: z.string().trim().min(1),
  action: z.enum(["accepted", "declined"]),
  reason: z.string().trim().max(500).optional(),
  expectedVersion: z.coerce.number().int().positive(),
});

function commandFormState(result: { ok: boolean; message?: string; result?: unknown }): FormActionState {
  if (!result.ok) return { status: "error", message: result.message ?? "The directory action could not be saved." };
  const payload = result.result && typeof result.result === "object" ? result.result as { message?: string } : null;
  return { status: "success", message: payload?.message ?? "Directory action saved." };
}

function revalidateDirectoryViews() {
  revalidatePath("/strains");
  revalidatePath("/notifications");
}

export async function createStrainDirectoryListingAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "strains:manage" });
  const parsed = createListingSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
    labId: formData.get("labId"),
    strainId: formData.get("strainId"),
    contactUserId: formData.get("contactUserId"),
  });
  if (!parsed.success) return { status: "error", message: "Choose a lab, an existing strain, and an active owner or manager as contact." };
  const { idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeCreateStrainDirectoryListingCommand({ actor, command, idempotencyKey, requestId });
  if (result.ok) revalidateDirectoryViews();
  return commandFormState(result);
}

export async function updateStrainDirectoryListingAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "strains:manage" });
  const parsed = updateListingSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
    listingId: formData.get("listingId"),
    contactUserId: formData.get("contactUserId"),
    status: formData.get("status"),
    expectedVersion: formData.get("expectedVersion"),
  });
  if (!parsed.success) return { status: "error", message: "Refresh the listing and choose a valid contact and sharing state." };
  const { idempotencyKey, requestId, expectedVersion, ...command } = parsed.data;
  const result = await executeUpdateStrainDirectoryListingCommand({ actor, command, expectedVersion, idempotencyKey, requestId });
  if (result.ok) revalidateDirectoryViews();
  return commandFormState(result);
}

export async function submitStrainDirectoryRequestAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "strains:request" });
  const parsed = submitRequestSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
    listingId: formData.get("listingId"),
    requestType: formData.get("requestType"),
    purpose: formData.get("purpose") || undefined,
  });
  if (!parsed.success) return { status: "error", message: "Choose a request type and keep the note within 500 characters." };
  const { idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeSubmitStrainDirectoryRequestCommand({ actor, command, idempotencyKey, requestId });
  if (result.ok) revalidateDirectoryViews();
  return commandFormState(result);
}

export async function decideStrainDirectoryRequestAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "strains:manage" });
  const parsed = decideRequestSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    requestId: formData.get("requestId"),
    strainDirectoryRequestId: formData.get("strainDirectoryRequestId"),
    action: formData.get("action"),
    reason: formData.get("reason") || undefined,
    expectedVersion: formData.get("expectedVersion"),
  });
  if (!parsed.success) return { status: "error", message: "Refresh the request and provide a brief reason when declining." };
  const { idempotencyKey, requestId, strainDirectoryRequestId, expectedVersion, ...command } = parsed.data;
  const result = await executeDecideStrainDirectoryRequestCommand({
    actor,
    command: { ...command, requestId: strainDirectoryRequestId },
    expectedVersion,
    idempotencyKey,
    requestId,
  });
  if (result.ok) revalidateDirectoryViews();
  return commandFormState(result);
}
