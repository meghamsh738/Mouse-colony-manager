"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { executeDecideCorrectionRequest, executeSubmitCorrectionRequest } from "@/lib/correction-write";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { requireUser } from "@/lib/session";

const identity = { idempotencyKey: z.string().min(16), requestId: z.string().min(16) };
const domain = z.enum(["litter_birth", "litter_weaning", "animal_move", "animal_lifecycle", "cross_lab_transfer", "procedure_occurrence", "biosample"]);

function values(formData: FormData) {
  return Object.fromEntries(formData);
}

function resultState(result: { ok: boolean; message?: string; result?: unknown }): FormActionState {
  if (!result.ok) return { status: "error", message: result.message ?? "The correction command could not be saved." };
  const payload = result.result && typeof result.result === "object" && !Array.isArray(result.result) ? result.result as { message?: string } : null;
  return { status: "success", message: payload?.message ?? "Correction command saved." };
}

function resultStatus(result: { result?: unknown }) {
  return result.result && typeof result.result === "object" && !Array.isArray(result.result)
    ? String((result.result as { status?: unknown }).status ?? "")
    : "";
}

export async function submitCorrectionRequestAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void _;
  const actor = await requireUser({ capability: "corrections:request" });
  const parsed = z.object({ ...identity, labId: z.string().min(1), domain, targetEntityId: z.string().trim().min(1).max(200), sourceEventAt: z.coerce.date(), reason: z.string().trim().min(8).max(2000), proposedCorrection: z.string().min(2).max(8000) }).safeParse(values(formData));
  if (!parsed.success) return { status: "error", message: "Choose a lab and domain, then provide the target, exact source time, reason, and corrected values." };
  let proposedCorrection: unknown;
  try {
    proposedCorrection = JSON.parse(parsed.data.proposedCorrection);
  } catch {
    return { status: "error", message: "Corrected values must be a JSON object." };
  }
  if (!proposedCorrection || typeof proposedCorrection !== "object" || Array.isArray(proposedCorrection)) return { status: "error", message: "Corrected values must be a JSON object." };
  const { idempotencyKey, requestId, proposedCorrection: _raw, ...command } = parsed.data;
  void _raw;
  const result = await executeSubmitCorrectionRequest({ actor, idempotencyKey, requestId, command: { ...command, proposedCorrection } });
  if (result.ok) redirect(resultStatus(result) === "blocked" ? "/corrections?notice=request-blocked" : "/corrections?notice=request-submitted");
  return resultState(result);
}

export async function decideCorrectionRequestAction(_: FormActionState = initialFormActionState, formData: FormData): Promise<FormActionState> {
  void _;
  const actor = await requireUser({ capability: "corrections:approve" });
  const parsed = z.object({ ...identity, correctionId: z.string().min(1), expectedVersion: z.coerce.number().int().positive(), decision: z.enum(["approve", "reject"]), decisionReason: z.string().trim().min(8).max(2000) }).safeParse(values(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the request and provide a decision reason." };
  const result = await executeDecideCorrectionRequest({ actor, ...parsed.data });
  if (result.ok) redirect(resultStatus(result) === "applied" ? "/corrections?notice=supersession-applied" : "/corrections?notice=request-rejected");
  return resultState(result);
}
