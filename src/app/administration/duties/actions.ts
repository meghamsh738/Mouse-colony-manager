"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  decideFacilityDutyRequest,
  requestFacilityDutyGrant,
  requestFacilityDutyRevoke,
} from "@/lib/facility-duty-governance";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

const dutySchema = z.enum([
  "designated_veterinarian",
  "welfare_officer",
  "protocol_reviewer",
  "training_administrator",
  "billing_administrator",
  "data_steward",
]);

const grantSchema = z.object({
  targetUserId: z.string().min(1),
  duty: dutySchema,
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date(),
  reason: z.string().trim().min(5).max(500),
});
const revokeSchema = z.object({
  assignmentId: z.string().min(1),
  assignmentVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(5).max(500),
});
const decisionSchema = z.object({
  requestId: z.string().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional(),
});

function revalidateDutySurfaces() {
  revalidatePath("/administration/duties");
  revalidatePath("/approvals");
}

export async function requestDutyGrantAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "duties:manage" });
  const parsed = grantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a target, duty, valid period, and reason." };
  const result = await requestFacilityDutyGrant(parsed.data, actor);
  if (!result.ok) return { status: "error", message: result.message };
  revalidateDutySurfaces();
  return { status: "success", message: result.message };
}

export async function requestDutyRevokeAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "duties:manage" });
  const parsed = revokeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the assignment and provide a revocation reason." };
  const result = await requestFacilityDutyRevoke(parsed.data, actor);
  if (!result.ok) return { status: "error", message: result.message };
  revalidateDutySurfaces();
  return { status: "success", message: result.message };
}

export async function decideDutyRequestAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "duties:manage" });
  const parsed = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success || (parsed.data.decision === "reject" && (parsed.data.reason?.length ?? 0) < 5)) {
    return { status: "error", message: "Refresh the request and provide a rejection reason when rejecting." };
  }
  const result = await decideFacilityDutyRequest(parsed.data, actor);
  if (!result.ok) return { status: "error", message: result.message };
  revalidateDutySurfaces();
  return { status: "success", message: result.message };
}
