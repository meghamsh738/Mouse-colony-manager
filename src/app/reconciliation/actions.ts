"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormActionState } from "@/lib/form-state";
import {
  executeAdvanceCensusSessionCommand,
  executeCancelTransferDispatchCommand,
  executeConfirmShipmentReceiptCommand,
  executeCreateShipmentManifestCommand,
  executeDecideShipmentHealthCompatibilityCommand,
  executeDispatchTransferCustodyCommand,
  executeGrantCapacityExceptionCommand,
  executeRecordCensusObservationCommand,
  executeRecordShipmentHealthEvidenceCommand,
  executeRecordShipmentObservationCommand,
  executeReceiveTransferCustodyCommand,
  executeResolveCensusDiscrepancyCommand,
  executeResolveTransferCustodyReconciliationCommand,
  executeRevokeCapacityExceptionCommand,
  executeStartCensusSessionCommand,
  executeStartShipmentReceiptCommand,
} from "@/lib/reconciliation-write";
import { requireUser } from "@/lib/session";

const identity = { idempotencyKey: z.string().min(16), requestId: z.string().min(16) };
function feedback(result: { ok: boolean; message?: string; result?: unknown }, fallback: string): FormActionState {
  if (!result.ok) return { status: "error", message: result.message ?? fallback };
  redirect("/reconciliation?notice=evidence-saved");
}

export async function createShipmentManifestAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "reconciliation:manage" });
  const parsed = z.object({ labId: z.string().min(1), sourceName: z.string().min(2), externalReference: z.string().min(2), expectedAt: z.string(), protocolAuthorizationId: z.string().min(1), expectedIdentifier: z.string().min(1), strainId: z.string().min(1), expectedSex: z.enum(["male", "female"]), expectedDob: z.string(), ...identity }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Enter the expected source, reference, animal, strain, sex, date of birth, and protocol." };
  const { idempotencyKey, requestId, ...value } = parsed.data;
  return feedback(await executeCreateShipmentManifestCommand({ actor, idempotencyKey, requestId, command: { labId: value.labId, sourceType: "vendor", sourceName: value.sourceName, externalReference: value.externalReference, expectedAt: value.expectedAt, healthEvidenceStatus: "missing", protocolAuthorizationId: value.protocolAuthorizationId, items: [{ expectedIdentifier: value.expectedIdentifier, strainId: value.strainId, expectedSex: value.expectedSex, expectedDob: value.expectedDob }] } }), "Manifest could not be created.");
}

export async function recordShipmentHealthEvidenceAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "reconciliation:manage" });
  const parsed = z.object({ manifestId: z.string().min(1), expectedVersion: z.coerce.number().int().positive(), evidenceType: z.enum(["vendor_certificate", "sentinel_panel", "transfer_health_packet"]), testCode: z.string().min(2), result: z.enum(["negative", "positive", "inconclusive", "incompatible"]), collectedAt: z.string(), issuedAt: z.string(), issuer: z.string().min(2), operationalSummary: z.string().min(3), ...identity }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Complete the structured operational health evidence." };
  const { manifestId, expectedVersion, idempotencyKey, requestId, ...evidence } = parsed.data;
  return feedback(await executeRecordShipmentHealthEvidenceCommand({ actor, manifestId, expectedVersion, idempotencyKey, requestId, evidence }), "Health evidence could not be recorded.");
}

export async function decideShipmentHealthCompatibilityAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "quarantine:release" });
  const parsed = z.object({ manifestId: z.string().min(1), expectedVersion: z.coerce.number().int().positive(), decision: z.enum(["compatible", "blocked"]), reason: z.string().min(3).max(600), ...identity }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the manifest and enter a veterinary compatibility decision with a reason." };
  return feedback(await executeDecideShipmentHealthCompatibilityCommand({ actor, ...parsed.data }), "Veterinary health decision could not be recorded.");
}

export async function startShipmentReceiptAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "reconciliation:manage" });
  const parsed = z.object({ manifestId: z.string().min(1), expectedVersion: z.coerce.number().int().positive(), ...identity }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Refresh and choose an expected manifest." };
  return feedback(await executeStartShipmentReceiptCommand({ actor, ...parsed.data }), "Receiving could not start.");
}

export async function recordShipmentObservationAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "reconciliation:manage" });
  const parsed = z.object({ sessionId: z.string().min(1), expectedVersion: z.coerce.number().int().positive(), manifestItemId: z.string().optional(), observedIdentifier: z.string().min(1), outcome: z.enum(["matched", "duplicate", "unknown", "mismatched", "damaged", "dead_on_arrival", "rejected"]), observedSex: z.enum(["male", "female"]).optional(), observedDob: z.string().optional(), operationalCondition: z.string().optional(), ...identity }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a receipt outcome and source identifier." };
  const { sessionId, expectedVersion, idempotencyKey, requestId, ...observation } = parsed.data;
  return feedback(await executeRecordShipmentObservationCommand({ actor, sessionId, expectedVersion, idempotencyKey, requestId, observation: { ...observation, manifestItemId: observation.manifestItemId || undefined, observedSex: observation.observedSex || undefined, observedDob: observation.observedDob || undefined, operationalCondition: observation.operationalCondition || undefined, discrepancyCodes: observation.outcome === "matched" ? [] : [observation.outcome] } }), "Receipt observation could not be saved.");
}

export async function confirmShipmentReceiptAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "reconciliation:manage" });
  const parsed = z.object({ sessionId: z.string().min(1), expectedVersion: z.coerce.number().int().positive(), destinationCageId: z.string().optional(), receivedAt: z.string(), minimumHoldDays: z.coerce.number().int().min(1).max(180), ...identity }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a receipt date, quarantine hold, and pre-existing empty quarantine cage." };
  return feedback(await executeConfirmShipmentReceiptCommand({ actor, ...parsed.data, destinationCageId: parsed.data.destinationCageId || undefined }), "Shipment confirmation failed atomically.");
}

export async function startCensusSessionAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "reconciliation:manage" });
  const parsed = z.object({ labId: z.string().min(1), roomId: z.string().min(1), rackLabel: z.string().optional(), ownerId: z.string().min(1), ...identity }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a lab, room, and census owner." };
  const { idempotencyKey, requestId, ...command } = parsed.data;
  return feedback(await executeStartCensusSessionCommand({ actor, idempotencyKey, requestId, command }), "Census could not start.");
}

export async function recordCensusObservationAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "reconciliation:manage" });
  const parsed = z.object({ sessionId: z.string().min(1), expectedVersion: z.coerce.number().int().positive(), observedIdentifier: z.string().min(1), cageId: z.string().optional(), observedLiveCount: z.coerce.number().int().nonnegative().optional(), observedMaleCount: z.coerce.number().int().nonnegative().optional(), observedFemaleCount: z.coerce.number().int().nonnegative().optional(), outcome: z.enum(["matched", "count_mismatch", "unknown", "wrong_location", "damaged_label", "empty"]), operationalCondition: z.string().optional(), ...identity }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Enter the observed cage identifier, counts, and outcome." };
  const { sessionId, expectedVersion, idempotencyKey, requestId, ...observation } = parsed.data;
  return feedback(await executeRecordCensusObservationCommand({ actor, sessionId, expectedVersion, idempotencyKey, requestId, observation: { ...observation, cageId: observation.cageId || undefined, operationalCondition: observation.operationalCondition || undefined, discrepancyCodes: observation.outcome === "matched" ? [] : [observation.outcome] } }), "Census observation could not be saved.");
}

export async function advanceCensusSessionAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const raw = Object.fromEntries(formData);
  const parsed = z.object({ sessionId: z.string().min(1), expectedVersion: z.coerce.number().int().positive(), action: z.enum(["submit_review", "sign_off", "cancel"]), ...identity }).safeParse(raw);
  if (!parsed.success) return { status: "error", message: "Refresh the census before changing its state." };
  const actor = await requireUser({ capability: parsed.data.action === "sign_off" ? "reconciliation:approve" : "reconciliation:manage" });
  return feedback(await executeAdvanceCensusSessionCommand({ actor, ...parsed.data }), "Census state could not change.");
}

export async function grantCapacityExceptionAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "reconciliation:approve" });
  const parsed = z.object({ cageId: z.string().min(1), additionalCapacity: z.coerce.number().int().min(1).max(20), startsAt: z.string(), expiresAt: z.string(), reason: z.string().min(3), ...identity }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a cage, 1-20 temporary spaces, expiry, and reason." };
  const { idempotencyKey, requestId, ...command } = parsed.data;
  return feedback(await executeGrantCapacityExceptionCommand({ actor, idempotencyKey, requestId, command }), "Capacity exception could not be granted.");
}

export async function dispatchTransferCustodyAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "reconciliation:manage" });
  const parsed = z.object({ transferRequestId: z.string().min(1), expectedVersion: z.coerce.number().int().positive(), ...identity }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose a current accepted transfer packet." };
  return feedback(await executeDispatchTransferCustodyCommand({ actor, transferRequestId: parsed.data.transferRequestId, expectedVersion: parsed.data.expectedVersion, idempotencyKey: parsed.data.idempotencyKey, requestId: parsed.data.requestId }), "Dispatch custody could not be recorded.");
}

export async function resolveCensusDiscrepancyAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const parsed = z.object({ discrepancyId: z.string().min(1), expectedVersion: z.coerce.number().int().positive(), action: z.enum(["resolve", "sign_off", "reject"]), reason: z.string().min(3).max(600), ...identity }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the discrepancy and enter a reason." };
  const actor = await requireUser({ capability: parsed.data.action === "sign_off" ? "reconciliation:approve" : "reconciliation:manage" });
  return feedback(await executeResolveCensusDiscrepancyCommand({ actor, ...parsed.data }), "Discrepancy decision could not be recorded.");
}

export async function revokeCapacityExceptionAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "reconciliation:approve" });
  const parsed = z.object({ exceptionId: z.string().min(1), expectedVersion: z.coerce.number().int().positive(), reason: z.string().min(3).max(600), ...identity }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the capacity exception and enter a revocation reason." };
  return feedback(await executeRevokeCapacityExceptionCommand({ actor, ...parsed.data }), "Capacity exception could not be revoked.");
}

export async function cancelTransferDispatchAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "reconciliation:manage" });
  const parsed = z.object({ transferRequestId: z.string().min(1), expectedVersion: z.coerce.number().int().positive(), reason: z.string().min(3).max(600), ...identity }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the dispatched transfer and enter a cancellation reason." };
  return feedback(await executeCancelTransferDispatchCommand({ actor, ...parsed.data }), "Dispatch cancellation could not be recorded.");
}

export async function receiveTransferCustodyAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const actor = await requireUser({ capability: "reconciliation:manage" });
  const parsed = z.object({ transferRequestId: z.string().min(1), expectedVersion: z.coerce.number().int().positive(), healthStatus: z.string().min(2).max(160), quarantineStatus: z.string().min(2).max(160), licenceStatus: z.string().min(2).max(160), safetyStatus: z.string().min(2).max(160), ...identity }).safeParse(Object.fromEntries(formData));
  const animalIds = formData.getAll("animalId").map(String);
  const expectedIdentifiers = formData.getAll("expectedIdentifier").map(String);
  const observedIdentifiers = formData.getAll("observedIdentifier").map(String);
  const outcomes = formData.getAll("outcome").map(String);
  const conditions = formData.getAll("operationalCondition").map(String);
  if (!parsed.success || !expectedIdentifiers.length || [animalIds, observedIdentifiers, outcomes, conditions].some((values) => values.length !== expectedIdentifiers.length)) {
    return { status: "error", message: "Confirm one custody outcome for every dispatched animal." };
  }
  const itemSchema = z.object({ animalId: z.string().min(1), expectedIdentifier: z.string().min(1), observedIdentifier: z.string().optional(), outcome: z.enum(["received", "missing", "mismatched", "damaged", "dead_on_arrival"]), operationalCondition: z.string().optional() });
  const items = expectedIdentifiers.map((expectedIdentifier, index) => itemSchema.safeParse({ animalId: animalIds[index], expectedIdentifier, observedIdentifier: observedIdentifiers[index] || undefined, outcome: outcomes[index], operationalCondition: conditions[index] || undefined }));
  if (items.some((item) => !item.success)) return { status: "error", message: "Choose a valid outcome and describe every exception." };
  const { idempotencyKey, requestId, transferRequestId, expectedVersion, ...operationalFacts } = parsed.data;
  return feedback(await executeReceiveTransferCustodyCommand({ actor, idempotencyKey, requestId, transferRequestId, expectedVersion, operationalFacts, items: items.map((item) => item.data!) }), "Destination receipt could not be recorded.");
}

export async function resolveTransferCustodyReconciliationAction(_: FormActionState, formData: FormData): Promise<FormActionState> {
  const parsed = z.object({ reconciliationId: z.string().min(1), expectedVersion: z.coerce.number().int().positive(), action: z.enum(["resolve", "sign_off", "reject"]), reason: z.string().min(3).max(600), ...identity }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Refresh the custody discrepancy and enter a reason." };
  const actor = await requireUser({ capability: parsed.data.action === "sign_off" ? "reconciliation:approve" : "reconciliation:manage" });
  return feedback(await executeResolveTransferCustodyReconciliationCommand({ actor, ...parsed.data }), "Custody reconciliation decision could not be recorded.");
}
