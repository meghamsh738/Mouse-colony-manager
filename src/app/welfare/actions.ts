"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";
import {
  executeAcknowledgeWelfareEscalationCommand,
  executeApproveWelfareTreatmentOrderCommand,
  executeCancelWelfareCaseCommand,
  executeCloseWelfareCaseCommand,
  executeOpenWelfareCaseCommand,
  executeOpenWelfareEscalationCommand,
  executeProposeWelfareTreatmentOrderCommand,
  executeRecordWelfareAdministrationCommand,
  executeRecordWelfareObservationCommand,
  executeResolveWelfareEscalationCommand,
  executeStopWelfareTreatmentOrderCommand,
  executeTriageWelfareCaseCommand,
} from "@/lib/welfare-write";

const identity = { idempotencyKey: z.string().min(16), requestId: z.string().min(16) };
const caseIdentity = { ...identity, caseId: z.string().min(1), expectedVersion: z.coerce.number().int().positive() };
const date = z.coerce.date();

function state(result: { ok: boolean; message?: string; result?: unknown }): FormActionState {
  if (!result.ok) return { status: "error", message: result.message ?? "The welfare action could not be saved." };
  const payload = result.result && typeof result.result === "object" && !Array.isArray(result.result) ? result.result as { message?: string } : null;
  return { status: "success", message: payload?.message ?? "Welfare action saved." };
}

function refresh() {
  revalidatePath("/welfare");
  revalidatePath("/notifications");
}

function values(formData: FormData) {
  return Object.fromEntries(formData);
}

export async function openWelfareCaseAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void _;
  const actor = await requireUser({ capability: "welfare:manage" });
  const parsed = z.object({ ...identity, subjectType: z.enum(["animal", "cage"]), subjectId: z.string().min(1), expectedSubjectVersion: z.coerce.number().int().positive(), severity: z.enum(["info", "warning", "critical"]), operationalSummary: z.string().trim().min(3).max(160), privateClinicalSummary: z.string().trim().min(3).max(2000), openedAt: date }).safeParse(values(formData));
  if (!parsed.success) return { status: "error", message: "Choose one subject and provide both operational and private clinical context." };
  const { idempotencyKey, requestId, ...command } = parsed.data;
  const result = await executeOpenWelfareCaseCommand({ actor, command, idempotencyKey, requestId });
  if (result.ok) refresh();
  return state(result);
}

export async function triageWelfareCaseAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void _;
  const actor = await requireUser({ capability: "welfare:manage" });
  const parsed = z.object({ ...caseIdentity, triagedAt: date }).safeParse(values(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the case and provide a triage time." };
  const result = await executeTriageWelfareCaseCommand({ actor, ...parsed.data }); if (result.ok) refresh(); return state(result);
}

export async function recordWelfareObservationAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void _;
  const actor = await requireUser({ capability: "welfare:manage" });
  const parsed = z.object({ ...caseIdentity, observedAt: date, severity: z.enum(["info", "warning", "critical"]), operationalCode: z.enum(["routine_review", "condition_change", "post_procedure", "environmental_concern", "other"]), privateNote: z.string().trim().min(3).max(2000) }).safeParse(values(formData));
  if (!parsed.success) return { status: "error", message: "Choose an observation code, severity, time, and private note." };
  const result = await executeRecordWelfareObservationCommand({ actor, ...parsed.data }); if (result.ok) refresh(); return state(result);
}

export async function proposeWelfareTreatmentAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void _;
  const actor = await requireUser({ capability: "welfare:manage" });
  const parsed = z.object({ ...caseIdentity, proposedAt: date, medication: z.string().min(2).max(200), dose: z.string().min(1).max(120), route: z.string().min(2).max(120), frequency: z.string().min(2).max(160), instructions: z.string().min(3).max(2000) }).safeParse(values(formData));
  if (!parsed.success) return { status: "error", message: "Complete every treatment order field." };
  const result = await executeProposeWelfareTreatmentOrderCommand({ actor, ...parsed.data }); if (result.ok) refresh(); return state(result);
}

export async function approveWelfareTreatmentAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void _;
  const actor = await requireUser({ capability: "welfare:manage" });
  const parsed = z.object({ ...caseIdentity, orderId: z.string().min(1), expectedOrderVersion: z.coerce.number().int().positive(), approvedAt: date }).safeParse(values(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the order before approval." };
  const result = await executeApproveWelfareTreatmentOrderCommand({ actor, ...parsed.data }); if (result.ok) refresh(); return state(result);
}

export async function recordWelfareAdministrationAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void _;
  const actor = await requireUser({ capability: "welfare:manage" });
  const parsed = z.object({ ...caseIdentity, orderId: z.string().min(1), expectedOrderVersion: z.coerce.number().int().positive(), administeredAt: date, outcome: z.enum(["administered", "not_administered", "error"]), actualDose: z.string().max(120).optional(), privateNote: z.string().max(1000).optional() }).safeParse(values(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the order and record the administration outcome." };
  const result = await executeRecordWelfareAdministrationCommand({ actor, ...parsed.data }); if (result.ok) refresh(); return state(result);
}

export async function stopWelfareTreatmentAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void _;
  const actor = await requireUser({ capability: "welfare:manage" });
  const parsed = z.object({ ...caseIdentity, orderId: z.string().min(1), expectedOrderVersion: z.coerce.number().int().positive(), stoppedAt: date, reason: z.string().min(3).max(1000) }).safeParse(values(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the order and provide a stop reason." };
  const result = await executeStopWelfareTreatmentOrderCommand({ actor, ...parsed.data }); if (result.ok) refresh(); return state(result);
}

export async function openWelfareEscalationAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void _;
  const actor = await requireUser({ capability: "welfare:manage" });
  const parsed = z.object({ ...caseIdentity, openedAt: date, severity: z.enum(["warning", "critical"]), operationalCode: z.enum(["urgent_review", "condition_worsened", "treatment_concern", "humane_endpoint_review", "other"]), privateReason: z.string().min(3).max(2000) }).safeParse(values(formData));
  if (!parsed.success) return { status: "error", message: "Choose an escalation code and provide a private reason." };
  const result = await executeOpenWelfareEscalationCommand({ actor, ...parsed.data }); if (result.ok) refresh(); return state(result);
}

export async function acknowledgeWelfareEscalationAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void _;
  const actor = await requireUser({ capability: "welfare:manage" });
  const parsed = z.object({ ...caseIdentity, escalationId: z.string().min(1), expectedEscalationVersion: z.coerce.number().int().positive(), acknowledgedAt: date }).safeParse(values(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the escalation before acknowledgement." };
  const result = await executeAcknowledgeWelfareEscalationCommand({ actor, ...parsed.data }); if (result.ok) refresh(); return state(result);
}

export async function resolveWelfareEscalationAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void _;
  const actor = await requireUser({ capability: "welfare:manage" });
  const parsed = z.object({ ...caseIdentity, escalationId: z.string().min(1), expectedEscalationVersion: z.coerce.number().int().positive(), resolvedAt: date, resolutionNote: z.string().min(3).max(2000) }).safeParse(values(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the acknowledged escalation and provide a resolution note." };
  const result = await executeResolveWelfareEscalationCommand({ actor, ...parsed.data }); if (result.ok) refresh(); return state(result);
}

export async function closeWelfareCaseAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void _;
  const actor = await requireUser({ capability: "welfare:close" });
  const parsed = z.object({ ...caseIdentity, closedAt: date, closureReason: z.string().min(3).max(2000) }).safeParse(values(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the case and provide a closure reason." };
  const result = await executeCloseWelfareCaseCommand({ actor, ...parsed.data }); if (result.ok) refresh(); return state(result);
}

export async function cancelWelfareCaseAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void _;
  const actor = await requireUser({ capability: "welfare:manage" });
  const parsed = z.object({ ...caseIdentity, cancelledAt: date, cancellationCode: z.enum(["duplicate", "not_a_case"]), cancellationReason: z.string().min(3).max(1000) }).safeParse(values(formData));
  if (!parsed.success) return { status: "error", message: "Cancellation is limited to a documented duplicate or not-a-case." };
  const result = await executeCancelWelfareCaseCommand({ actor, ...parsed.data }); if (result.ok) refresh(); return state(result);
}
