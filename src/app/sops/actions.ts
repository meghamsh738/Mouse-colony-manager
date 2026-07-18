"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";
import {
  executeAcknowledgeSopCommand,
  executeAssignSopVersionCommand,
  executeCreateSopCommand,
  executeCreateSopVersionCommand,
  executeDecideSopVersionCommand,
  executeRevokeSopAssignmentCommand,
} from "@/lib/sop-write";

const identitySchema = z.object({
  idempotencyKey: z.string().uuid(),
  requestId: z.string().uuid(),
});

const createSchema = identitySchema.extend({
  scope: z.enum(["facility", "lab"]),
  labId: z.string().trim().optional(),
  code: z.string().trim().min(2).max(40),
  title: z.string().trim().min(3).max(160),
  category: z.string().trim().min(2).max(80),
  contentMarkdown: z.string().trim().min(20).max(50_000),
  changeSummary: z.string().trim().min(3).max(500),
});

const versionSchema = identitySchema.extend({
  sopId: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().min(1),
  title: z.string().trim().min(3).max(160),
  category: z.string().trim().min(2).max(80),
  contentMarkdown: z.string().trim().min(20).max(50_000),
  changeSummary: z.string().trim().min(3).max(500),
});

const decisionSchema = identitySchema.extend({
  sopId: z.string().trim().min(1),
  versionId: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().min(1),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().min(3).max(500),
});

const assignmentSchema = identitySchema.extend({
  sopId: z.string().trim().min(1),
  versionId: z.string().trim().min(1),
  labId: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().min(1),
  dueAt: z.string().trim().optional(),
  reason: z.string().trim().min(3).max(500),
});

const revokeSchema = identitySchema.extend({
  assignmentId: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().min(1),
  reason: z.string().trim().min(3).max(500),
});

const acknowledgementSchema = identitySchema.extend({
  assignmentId: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().min(1),
  sopVersionId: z.string().trim().min(1),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  attestationConfirmed: z.literal("on").transform(() => true),
});

function revalidateSops() {
  revalidatePath("/sops");
  revalidatePath("/procedures");
  revalidatePath("/notifications");
}

function formValues(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

function error(message: string): FormActionState {
  return { status: "error", message };
}

export async function createSopAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "sops:manage" });
  const parsed = createSchema.safeParse(formValues(formData));
  if (!parsed.success) return error("Enter a code, title, category, version content, and change summary.");
  const result = await executeCreateSopCommand({
    actor,
    command: {
      scope: parsed.data.scope,
      labId: parsed.data.labId,
      code: parsed.data.code,
      title: parsed.data.title,
      category: parsed.data.category,
      contentMarkdown: parsed.data.contentMarkdown,
      changeSummary: parsed.data.changeSummary,
    },
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });
  if (!result.ok) return error(result.message ?? "The SOP could not be created.");
  revalidateSops();
  return { status: "success", message: "Immutable SOP version created and awaiting approval." };
}

export async function createSopVersionAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "sops:manage" });
  const parsed = versionSchema.safeParse(formValues(formData));
  if (!parsed.success) return error("Enter the revised content and change summary.");
  const result = await executeCreateSopVersionCommand({
    actor,
    command: {
      sopId: parsed.data.sopId,
      title: parsed.data.title,
      category: parsed.data.category,
      contentMarkdown: parsed.data.contentMarkdown,
      changeSummary: parsed.data.changeSummary,
    },
    expectedVersion: parsed.data.expectedVersion,
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });
  if (!result.ok) return error(result.message ?? "The version could not be created.");
  revalidateSops();
  return { status: "success", message: "New immutable version created for approval." };
}

export async function decideSopVersionAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "sops:approve" });
  const parsed = decisionSchema.safeParse(formValues(formData));
  if (!parsed.success) return error("Choose a decision and enter a decision note.");
  const result = await executeDecideSopVersionCommand({
    actor,
    command: {
      sopId: parsed.data.sopId,
      versionId: parsed.data.versionId,
      decision: parsed.data.decision,
      note: parsed.data.note,
    },
    expectedVersion: parsed.data.expectedVersion,
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });
  if (!result.ok) return error(result.message ?? "The version decision could not be recorded.");
  revalidateSops();
  return { status: "success", message: `SOP version ${parsed.data.decision}.` };
}

export async function assignSopVersionAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "sops:manage" });
  const parsed = assignmentSchema.safeParse(formValues(formData));
  if (!parsed.success) return error("Choose an approved version and lab, then enter an assignment reason.");
  const result = await executeAssignSopVersionCommand({
    actor,
    command: {
      sopId: parsed.data.sopId,
      versionId: parsed.data.versionId,
      labId: parsed.data.labId,
      dueAt: parsed.data.dueAt,
      reason: parsed.data.reason,
    },
    expectedVersion: parsed.data.expectedVersion,
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });
  if (!result.ok) return error(result.message ?? "The SOP could not be assigned.");
  revalidateSops();
  return { status: "success", message: "Approved SOP version assigned to the lab." };
}

export async function revokeSopAssignmentAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "sops:manage" });
  const parsed = revokeSchema.safeParse(formValues(formData));
  if (!parsed.success) return error("Enter a reason before revoking the assignment.");
  const result = await executeRevokeSopAssignmentCommand({
    actor,
    command: {
      assignmentId: parsed.data.assignmentId,
      expectedVersion: parsed.data.expectedVersion,
      reason: parsed.data.reason,
    },
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });
  if (!result.ok) return error(result.message ?? "The assignment could not be revoked.");
  revalidateSops();
  return { status: "success", message: "SOP assignment revoked. Historical acknowledgements remain intact." };
}

export async function acknowledgeSopAction(
  previousState: FormActionState = initialFormActionState,
  formData: FormData,
): Promise<FormActionState> {
  void previousState;
  const actor = await requireUser({ capability: "sops:read" });
  const parsed = acknowledgementSchema.safeParse(formValues(formData));
  if (!parsed.success) return error("Review the exact assigned SOP version and confirm the acknowledgement.");
  const result = await executeAcknowledgeSopCommand({
    actor,
    command: {
      assignmentId: parsed.data.assignmentId,
      expectedVersion: parsed.data.expectedVersion,
      sopVersionId: parsed.data.sopVersionId,
      contentHash: parsed.data.contentHash,
      attestationConfirmed: parsed.data.attestationConfirmed,
    },
    idempotencyKey: parsed.data.idempotencyKey,
    requestId: parsed.data.requestId,
  });
  if (!result.ok) return error(result.message ?? "The acknowledgement could not be recorded.");
  revalidateSops();
  return { status: "success", message: "Acknowledgement recorded against the exact SOP version." };
}
