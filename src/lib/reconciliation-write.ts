import { randomUUID } from "node:crypto";

import { Prisma, type FacilityDuty, type Sex } from "@prisma/client";
import { addDays } from "date-fns";

import { receivePurchasedAnimals } from "@/lib/cage-intake-write";
import type { Capability } from "@/lib/capabilities";
import { executeIdempotentCommand, reauthorizeActorForCommand } from "@/lib/command-foundation";
import { isElevatedIdentityContextCurrent } from "@/lib/identity-assurance";
import { prisma } from "@/lib/prisma";
import {
  assertOperationalPacket,
  canTransitionCensus,
  canTransitionShipmentStatus,
  discrepancyTypeForCensus,
  M16_POLICY_MARKER,
  receiptFinalizationResult,
  SHIPMENT_OBSERVATION_OUTCOMES,
  TRANSFER_CUSTODY_OUTCOMES,
  transferReceiptEventType,
  type CensusOutcome,
  type ShipmentObservationOutcome,
  type TransferCustodyOutcome,
} from "@/lib/reconciliation-state-machine";
import { evaluateAndWriteComplianceEvidence, withM13MutationSavepoint } from "@/lib/protocol-compliance";
import type { ResolvedActor } from "@/lib/session";

type CommandIdentity = { idempotencyKey: string; requestId: string };

function hasUnitOperationalScope(actor: ResolvedActor) {
  return actor.canonicalRole === "facility_admin" || actor.canonicalRole === "cmu_staff";
}

async function preauthorizeTargetLookup(actor: ResolvedActor, capability: Capability) {
  const authorized = await reauthorizeActorForCommand(
    prisma as unknown as Prisma.TransactionClient,
    actor,
    capability,
    hasUnitOperationalScope(actor) ? null : actor.activeLabId,
  );
  return authorized
    ? { ok: true as const, labWhere: hasUnitOperationalScope(actor) ? {} : { labId: actor.activeLabId ?? "__no_lab__" } }
    : { ok: false as const, labWhere: { labId: "__no_lab__" } };
}

function dateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : parsed;
}

function boundedText(value: string, min: number, max: number) {
  const normalized = value.trim();
  return normalized.length >= min && normalized.length <= max ? normalized : null;
}

function requestJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

async function setM16Context(tx: Prisma.TransactionClient, input: { receiptId: string; actorId: string; commandType: string }) {
  await tx.$queryRaw(Prisma.sql`
    SELECT
      set_config('mcm.reconciliation_receipt_id', ${input.receiptId}, true),
      set_config('mcm.reconciliation_actor_id', ${input.actorId}, true),
      set_config('mcm.reconciliation_command_type', ${input.commandType}, true)
  `);
}

export async function deriveManifestHealthStatus(tx: Prisma.TransactionClient, manifestId: string) {
  const rows = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT "mcm_m16_derive_manifest_health_status"(${manifestId}) AS status
  `);
  const status = rows[0]?.status;
  if (!status || !["missing", "pending", "compatible", "incompatible", "positive"].includes(status)) {
    throw new Error("The append-only shipment health evidence could not be derived safely.");
  }
  return status;
}

async function appendLifecycleEvent(tx: Prisma.TransactionClient, input: {
  actor: ResolvedActor;
  receiptId: string;
  domain: "shipment" | "census" | "capacity" | "quarantine" | "transfer_custody";
  aggregateType: string;
  aggregateId: string;
  labId: string;
  eventType: string;
  previousStatus?: string | null;
  resultingStatus: string;
  evidence: Prisma.InputJsonValue;
  createAudit?: boolean;
  duty?: { id: string; version: number } | null;
}) {
  const receipt = await tx.commandReceipt.findUniqueOrThrow({ where: { id: input.receiptId } });
  await tx.operationalReconciliationEvent.create({
    data: {
      id: `m16-event-${randomUUID()}`,
      domain: input.domain,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      labId: input.labId,
      eventType: input.eventType,
      previousStatus: input.previousStatus ?? null,
      resultingStatus: input.resultingStatus,
      actorId: input.actor.id,
      actorAuthzVersion: input.actor.authzVersion,
      actorRoleSnapshot: input.actor.canonicalRole,
      dutyAssignmentId: input.duty?.id ?? null,
      dutyAssignmentVersion: input.duty?.version ?? null,
      identityLinkId: input.actor.identityLinkId ?? null,
      authenticatedAt: input.actor.authenticatedAt ? new Date(input.actor.authenticatedAt) : null,
      assuranceLevel: input.actor.assurance ?? null,
      evidence: input.evidence,
      commandReceiptId: input.receiptId,
    },
  });
  if (input.createAudit !== false) {
    await tx.auditLog.create({
      data: {
        id: `audit-m16-${randomUUID()}`,
        actorId: input.actor.id,
        actorRole: input.actor.canonicalRole,
        labId: input.labId,
        requestId: receipt.requestId,
        commandReceiptId: input.receiptId,
        commandType: receipt.commandType,
        commandAggregateType: receipt.aggregateType,
        commandAggregateId: receipt.aggregateId,
        entityType: input.aggregateType,
        entityId: input.aggregateId,
        action: input.eventType,
        previousValue: input.previousStatus ? { status: input.previousStatus } : Prisma.JsonNull,
        newValue: { status: input.resultingStatus, policyMarker: M16_POLICY_MARKER, evidence: input.evidence },
        timestamp: new Date(),
      },
    });
  }
}

export type CreateShipmentManifestCommand = {
  labId: string;
  sourceType: "vendor" | "internal_transfer" | "other_controlled";
  sourceName: string;
  externalReference: string;
  expectedAt: string;
  healthEvidenceStatus: "missing" | "pending" | "compatible" | "incompatible" | "positive";
  healthEvidenceSummary?: string;
  protocolAuthorizationId?: string;
  items: Array<{ expectedIdentifier: string; strainId: string; expectedSex: Sex; expectedDob: string }>;
};

export async function executeCreateShipmentManifestCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  command: CreateShipmentManifestCommand;
}) {
  const manifestId = `shipment-${randomUUID()}`;
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "m16.shipment.create",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson(input.command),
    requiredCapability: "reconciliation:manage",
    labId: input.command.labId,
    aggregateType: "shipment_manifest",
    aggregateId: manifestId,
    handler: async (tx, context) => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType: "m16.shipment.create" });
      const sourceName = boundedText(input.command.sourceName, 2, 160);
      const externalReference = boundedText(input.command.externalReference, 2, 160);
      const expectedAt = dateOnly(input.command.expectedAt);
      const healthSummary = input.command.healthEvidenceSummary?.trim() || null;
      if (!sourceName || !externalReference || !expectedAt || input.command.items.length < 1 || input.command.items.length > 200) {
        return { ok: false as const, code: "validation_error", message: "Enter a source, reference, expected date, and 1-200 expected animals." };
      }
      if (!["missing", "pending"].includes(input.command.healthEvidenceStatus)) {
        return { ok: false as const, code: "health_evidence_required", message: "Create the manifest as missing or pending, then append structured health-test evidence." };
      }
      if (!(["missing", "pending"] as string[]).includes(input.command.healthEvidenceStatus) && (!healthSummary || healthSummary.length < 3)) {
        return { ok: false as const, code: "validation_error", message: "Summarize the operational health evidence status." };
      }
      const identifiers = input.command.items.map((item) => item.expectedIdentifier.trim());
      if (identifiers.some((id) => !id) || new Set(identifiers).size !== identifiers.length) {
        return { ok: false as const, code: "validation_error", message: "Expected source identifiers must be present and unique." };
      }
      const parsedItems = input.command.items.map((item) => ({ ...item, expectedIdentifier: item.expectedIdentifier.trim(), expectedDob: dateOnly(item.expectedDob) }));
      if (parsedItems.some((item) => !item.expectedDob)) {
        return { ok: false as const, code: "validation_error", message: "Every expected animal needs a valid date of birth." };
      }
      const strains = await tx.strain.count({ where: { id: { in: [...new Set(parsedItems.map((item) => item.strainId))] } } });
      if (strains !== new Set(parsedItems.map((item) => item.strainId)).size) {
        return { ok: false as const, code: "validation_error", message: "One or more expected strains are unavailable." };
      }
      if (input.command.protocolAuthorizationId) {
        const protocol = await tx.protocolAuthorization.findFirst({ where: { id: input.command.protocolAuthorizationId, labId: input.command.labId }, select: { id: true } });
        if (!protocol) return { ok: false as const, code: "validation_error", message: "The protocol authorization does not belong to this lab." };
      }
      await tx.shipmentManifest.create({
        data: {
          id: manifestId,
          labId: input.command.labId,
          sourceType: input.command.sourceType,
          sourceName,
          externalReference,
          expectedAt,
          healthEvidenceStatus: input.command.healthEvidenceStatus,
          healthEvidenceSummary: healthSummary,
          protocolAuthorizationId: input.command.protocolAuthorizationId ?? null,
          createdById: input.actor.id,
        },
      });
      await tx.shipmentManifestItem.createMany({
        data: parsedItems.map((item) => ({
          id: `shipment-item-${randomUUID()}`,
          manifestId,
          labId: input.command.labId,
          expectedIdentifier: item.expectedIdentifier,
          strainId: item.strainId,
          expectedSex: item.expectedSex,
          expectedDob: item.expectedDob!,
        })),
      });
      await appendLifecycleEvent(tx, {
        actor: input.actor,
        receiptId: context.receiptId,
        domain: "shipment",
        aggregateType: "shipment_manifest",
        aggregateId: manifestId,
        labId: input.command.labId,
        eventType: "created",
        resultingStatus: "expected",
        evidence: requestJson({ expectedCount: input.command.items.length, healthEvidenceStatus: input.command.healthEvidenceStatus, policyMarker: M16_POLICY_MARKER }),
      });
      return { ok: true as const, result: requestJson({ manifestId, version: 1, message: "Expected shipment manifest created." }), aggregateType: "shipment_manifest", aggregateId: manifestId, resultingVersion: 1 };
    },
  });
}

export async function executeRecordShipmentHealthEvidenceCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  manifestId: string;
  expectedVersion: number;
  evidence: {
    evidenceType: "vendor_certificate" | "sentinel_panel" | "transfer_health_packet";
    testCode: string;
    result: "negative" | "positive" | "inconclusive" | "incompatible";
    collectedAt: string;
    issuedAt: string;
    issuer: string;
    operationalSummary: string;
  };
}) {
  const preflight = await preauthorizeTargetLookup(input.actor, "reconciliation:manage");
  if (!preflight.ok) return { ok: false as const, code: "forbidden", message: "Current operational reconciliation authority is required." };
  const target = await prisma.shipmentManifest.findFirst({ where: { id: input.manifestId, ...preflight.labWhere }, select: { labId: true } });
  if (!target) return { ok: false as const, code: "not_found", message: "Shipment manifest not found." };
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "m16.shipment.health_evidence",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson(input),
    requiredCapability: "reconciliation:manage",
    labId: target.labId,
    aggregateType: "shipment_manifest",
    aggregateId: input.manifestId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType: "m16.shipment.health_evidence" });
      const manifest = await tx.shipmentManifest.findUnique({ where: { id: input.manifestId } });
      const testCode = boundedText(input.evidence.testCode, 2, 120);
      const collectedAt = dateOnly(input.evidence.collectedAt);
      const issuedAt = new Date(input.evidence.issuedAt);
      const issuer = boundedText(input.evidence.issuer, 2, 160);
      const summary = boundedText(input.evidence.operationalSummary, 3, 600);
      if (!manifest || ["received", "cancelled"].includes(manifest.status) || !testCode || !collectedAt || Number.isNaN(issuedAt.getTime()) || !issuer || !summary || issuedAt < collectedAt) {
        return { ok: false as const, code: "validation_error", message: "Enter a valid structured health test and operational summary before receipt confirmation." };
      }
      const evidence = await tx.shipmentHealthEvidence.create({ data: { id: `shipment-health-${randomUUID()}`, manifestId: manifest.id, labId: manifest.labId, evidenceType: input.evidence.evidenceType, testCode, result: input.evidence.result, collectedAt, issuedAt, issuer, operationalSummary: summary, recordedById: input.actor.id, commandReceiptId: context.receiptId } });
      const status = await deriveManifestHealthStatus(tx, manifest.id);
      const updated = await tx.shipmentManifest.update({ where: { id: manifest.id }, data: { healthEvidenceStatus: status, healthEvidenceSummary: `${input.evidence.evidenceType}: ${testCode} ${input.evidence.result}; independent veterinary decision required for compatibility`, version: { increment: 1 } } });
      await appendLifecycleEvent(tx, { actor: input.actor, receiptId: context.receiptId, domain: "shipment", aggregateType: "shipment_manifest", aggregateId: manifest.id, labId: manifest.labId, eventType: "health_evidence_recorded", previousStatus: manifest.status, resultingStatus: manifest.status, evidence: requestJson({ healthEvidenceId: evidence.id, result: evidence.result, derivedStatus: status, policyMarker: M16_POLICY_MARKER }) });
      return { ok: true as const, result: requestJson({ manifestId: manifest.id, version: updated.version, healthEvidenceStatus: status, message: "Health evidence recorded append-only; intake remains blocked until an independent veterinarian covers the exact evidence set." }), aggregateType: "shipment_manifest", aggregateId: manifest.id, resultingVersion: updated.version };
    },
  });
}

export async function executeDecideShipmentHealthCompatibilityCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  manifestId: string;
  expectedVersion: number;
  decision: "compatible" | "blocked";
  reason: string;
}) {
  if (!input.actor.capabilities.includes("quarantine:release")
      || !await reauthorizeActorForCommand(prisma as unknown as Prisma.TransactionClient, input.actor, "quarantine:release", null)
      || !await currentDesignatedVeterinarianEvidence(prisma as unknown as Prisma.TransactionClient, input.actor)) {
    return { ok: false as const, code: "clinical_duty_required", message: "A current Designated Veterinarian duty and fresh identity assurance are required." };
  }
  const target = await prisma.shipmentManifest.findUnique({ where: { id: input.manifestId }, select: { labId: true } });
  if (!target) return { ok: false as const, code: "not_found", message: "Shipment manifest not found." };
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "m16.shipment.health_decision",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson({ manifestId: input.manifestId, expectedVersion: input.expectedVersion, decision: input.decision, reason: input.reason }),
    requiredCapability: "quarantine:release",
    labId: target.labId,
    authorizationLabId: null,
    aggregateType: "shipment_manifest",
    aggregateId: input.manifestId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType: "m16.shipment.health_decision" });
      const clinicalEvidence = await currentDesignatedVeterinarianEvidence(tx, input.actor);
      if (!clinicalEvidence) return { ok: false as const, code: "clinical_duty_required", message: "Current veterinary duty and fresh identity are required." };
      const manifest = await tx.shipmentManifest.findUnique({ where: { id: input.manifestId } });
      const reason = boundedText(input.reason, 3, 600);
      if (!manifest || ["received", "cancelled"].includes(manifest.status) || !reason) return { ok: false as const, code: "validation_error", message: "Choose an open shipment and enter a veterinary decision reason." };
      const evidence = await tx.shipmentHealthEvidence.findMany({ where: { manifestId: manifest.id }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }], select: { id: true, result: true, recordedById: true, recordedAt: true } });
      if (!evidence.length) return { ok: false as const, code: "health_evidence_required", message: "Append structured health evidence before veterinary review." };
      if (evidence.some((row) => row.recordedById === input.actor.id)) return { ok: false as const, code: "independence_required", message: "The evidence recorder cannot independently certify the same shipment." };
      if (input.decision === "compatible" && evidence.some((row) => row.result !== "negative")) return { ok: false as const, code: "health_evidence_block", message: "Positive, incompatible, or inconclusive evidence cannot be certified compatible." };
      const latestAt = evidence.reduce((latest, row) => row.recordedAt > latest ? row.recordedAt : latest, evidence[0]!.recordedAt);
      const decision = await tx.shipmentHealthDecision.create({ data: {
        id: `shipment-health-decision-${randomUUID()}`,
        manifestId: manifest.id,
        labId: manifest.labId,
        decision: input.decision,
        reason,
        evidenceCount: evidence.length,
        evidenceLatestAt: latestAt,
        assessedById: input.actor.id,
        assessedByAuthzVersion: input.actor.authzVersion,
        dutyAssignmentId: clinicalEvidence.assignment.id,
        dutyAssignmentVersion: clinicalEvidence.assignment.version,
        identityLinkId: clinicalEvidence.identityLinkId,
        authenticatedAt: clinicalEvidence.authenticatedAt,
        assuranceLevel: clinicalEvidence.assurance,
        commandReceiptId: context.receiptId,
      } });
      const status = await deriveManifestHealthStatus(tx, manifest.id);
      const updated = await tx.shipmentManifest.update({ where: { id: manifest.id }, data: { healthEvidenceStatus: status, healthEvidenceSummary: `Independent veterinary decision: ${input.decision}; ${evidence.length} append-only evidence record(s) covered`, version: { increment: 1 } } });
      await appendLifecycleEvent(tx, { actor: input.actor, receiptId: context.receiptId, domain: "shipment", aggregateType: "shipment_manifest", aggregateId: manifest.id, labId: manifest.labId, eventType: "health_compatibility_decided", previousStatus: manifest.status, resultingStatus: manifest.status, evidence: requestJson({ healthDecisionId: decision.id, evidenceCount: evidence.length, decision: input.decision, derivedStatus: status, policyMarker: M16_POLICY_MARKER }), duty: clinicalEvidence.assignment });
      return { ok: true as const, result: requestJson({ manifestId: manifest.id, version: updated.version, healthEvidenceStatus: status, message: status === "compatible" ? "Independent veterinary compatibility decision recorded." : "Veterinary block recorded; intake remains fail-closed." }), aggregateType: "shipment_manifest", aggregateId: manifest.id, resultingVersion: updated.version };
    },
  });
}

export async function executeStartShipmentReceiptCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  manifestId: string;
  expectedVersion: number;
}) {
  const preflight = await preauthorizeTargetLookup(input.actor, "reconciliation:manage");
  if (!preflight.ok) return { ok: false as const, code: "forbidden", message: "Current operational reconciliation authority is required." };
  const target = await prisma.shipmentManifest.findFirst({ where: { id: input.manifestId, ...preflight.labWhere }, select: { labId: true } });
  if (!target) return { ok: false as const, code: "not_found", message: "Shipment manifest not found." };
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "m16.shipment.start_receipt",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson({ manifestId: input.manifestId, expectedVersion: input.expectedVersion }),
    requiredCapability: "reconciliation:manage",
    labId: target.labId,
    aggregateType: "shipment_manifest",
    aggregateId: input.manifestId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType: "m16.shipment.start_receipt" });
      const manifest = await tx.shipmentManifest.findUnique({ where: { id: input.manifestId } });
      if (!manifest || !canTransitionShipmentStatus(manifest.status, "receiving")) {
        return { ok: false as const, code: "invalid_transition", message: "This shipment cannot start or resume receiving." };
      }
      const open = await tx.shipmentReceiptSession.findFirst({ where: { manifestId: manifest.id, status: { in: ["in_progress", "ready_for_confirmation"] } } });
      if (open) return { ok: false as const, code: "existing_session", message: "An open receiving session already exists. Resume that session." };
      const session = await tx.shipmentReceiptSession.create({ data: { id: `receipt-session-${randomUUID()}`, manifestId: manifest.id, labId: manifest.labId, startedById: input.actor.id } });
      const updated = await tx.shipmentManifest.update({ where: { id: manifest.id }, data: { status: "receiving", version: { increment: 1 } } });
      await appendLifecycleEvent(tx, { actor: input.actor, receiptId: context.receiptId, domain: "shipment", aggregateType: "shipment_manifest", aggregateId: manifest.id, labId: manifest.labId, eventType: "receiving_started", previousStatus: manifest.status, resultingStatus: updated.status, evidence: requestJson({ sessionId: session.id, policyMarker: M16_POLICY_MARKER }) });
      return { ok: true as const, result: requestJson({ manifestId: manifest.id, sessionId: session.id, version: session.version, manifestVersion: updated.version, message: "Receiving session started." }), aggregateType: "shipment_manifest", aggregateId: manifest.id, resultingVersion: updated.version };
    },
  });
}

export async function executeRecordShipmentObservationCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  sessionId: string;
  expectedVersion: number;
  observation: {
    observedIdentifier: string;
    manifestItemId?: string;
    outcome: ShipmentObservationOutcome;
    observedSex?: Sex;
    observedDob?: string;
    discrepancyCodes?: string[];
    operationalCondition?: string;
  };
}) {
  const preflight = await preauthorizeTargetLookup(input.actor, "reconciliation:manage");
  if (!preflight.ok) return { ok: false as const, code: "forbidden", message: "Current operational reconciliation authority is required." };
  const target = await prisma.shipmentReceiptSession.findFirst({ where: { id: input.sessionId, ...preflight.labWhere }, select: { labId: true } });
  if (!target) return { ok: false as const, code: "not_found", message: "Receiving session not found." };
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "m16.shipment.observe",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson({ sessionId: input.sessionId, expectedVersion: input.expectedVersion, observation: input.observation }),
    requiredCapability: "reconciliation:manage",
    labId: target.labId,
    aggregateType: "shipment_receipt_session",
    aggregateId: input.sessionId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType: "m16.shipment.observe" });
      const session = await tx.shipmentReceiptSession.findUnique({ where: { id: input.sessionId } });
      if (!session || !["in_progress", "ready_for_confirmation"].includes(session.status)) return { ok: false as const, code: "invalid_transition", message: "This receiving session is no longer open." };
      const identifier = boundedText(input.observation.observedIdentifier, 1, 160);
      if (!identifier || !SHIPMENT_OBSERVATION_OUTCOMES.includes(input.observation.outcome)) return { ok: false as const, code: "validation_error", message: "Choose a valid receiving outcome and identifier." };
      const item = input.observation.manifestItemId ? await tx.shipmentManifestItem.findFirst({ where: { id: input.observation.manifestItemId, manifestId: session.manifestId } }) : null;
      if (["matched", "mismatched", "damaged", "dead_on_arrival"].includes(input.observation.outcome) !== Boolean(item)) {
        return { ok: false as const, code: "validation_error", message: "This outcome requires the exact expected manifest item." };
      }
      const observedDob = input.observation.observedDob ? dateOnly(input.observation.observedDob) : null;
      if (input.observation.observedDob && !observedDob) return { ok: false as const, code: "validation_error", message: "Observed date of birth is invalid." };
      if (input.observation.outcome === "matched" && item && (identifier !== item.expectedIdentifier || input.observation.observedSex !== item.expectedSex || observedDob?.getTime() !== item.expectedDob.getTime())) {
        return { ok: false as const, code: "mismatch_requires_exception", message: "Identifier, sex, or age differs from the manifest. Record a mismatched exception." };
      }
      const priorIdentifier = await tx.shipmentReceiptObservation.findFirst({ where: { manifestId: session.manifestId, observedIdentifier: identifier } });
      if (priorIdentifier && input.observation.outcome !== "duplicate") return { ok: false as const, code: "duplicate_delivery", message: "This identifier was already observed. Record it explicitly as a duplicate." };
      if (input.observation.outcome !== "matched" && !boundedText(input.observation.operationalCondition ?? "", 3, 600)) {
        return { ok: false as const, code: "validation_error", message: "Describe the operational exception without private research notes." };
      }
      await tx.shipmentReceiptObservation.create({ data: {
        id: `receipt-observation-${randomUUID()}`,
        sessionId: session.id,
        manifestId: session.manifestId,
        manifestItemId: item?.id ?? null,
        labId: session.labId,
        observedIdentifier: identifier,
        outcome: input.observation.outcome,
        observedSex: input.observation.observedSex ?? null,
        observedDob,
        discrepancyCodes: input.observation.discrepancyCodes ?? [],
        operationalCondition: input.observation.operationalCondition?.trim() || null,
        observedById: input.actor.id,
        commandReceiptId: context.receiptId,
      } });
      const updated = await tx.shipmentReceiptSession.update({ where: { id: session.id }, data: { status: "ready_for_confirmation", version: { increment: 1 } } });
      await appendLifecycleEvent(tx, { actor: input.actor, receiptId: context.receiptId, domain: "shipment", aggregateType: "shipment_receipt_session", aggregateId: session.id, labId: session.labId, eventType: "observation_recorded", previousStatus: session.status, resultingStatus: updated.status, evidence: requestJson({ outcome: input.observation.outcome, manifestItemId: item?.id ?? null, policyMarker: M16_POLICY_MARKER }) });
      return { ok: true as const, result: requestJson({ sessionId: session.id, version: updated.version, message: input.observation.outcome === "matched" ? "Expected item matched." : "Receiving exception recorded without changing colony records." }), aggregateType: "shipment_receipt_session", aggregateId: session.id, resultingVersion: updated.version };
    },
  });
}

export async function executeConfirmShipmentReceiptCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  sessionId: string;
  expectedVersion: number;
  destinationCageId?: string;
  receivedAt: string;
  minimumHoldDays: number;
}) {
  const preflight = await preauthorizeTargetLookup(input.actor, "reconciliation:manage");
  if (!preflight.ok) return { ok: false as const, code: "forbidden", message: "Current operational reconciliation authority is required." };
  const target = await prisma.shipmentReceiptSession.findFirst({ where: { id: input.sessionId, ...preflight.labWhere }, select: { labId: true } });
  if (!target) return { ok: false as const, code: "not_found", message: "Receiving session not found." };
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "m16.shipment.confirm",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson({ sessionId: input.sessionId, expectedVersion: input.expectedVersion, destinationCageId: input.destinationCageId ?? null, receivedAt: input.receivedAt, minimumHoldDays: input.minimumHoldDays }),
    requiredCapability: "reconciliation:manage",
    labId: target.labId,
    aggregateType: "shipment_receipt_session",
    aggregateId: input.sessionId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => withM13MutationSavepoint(tx, async () => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType: "m16.shipment.confirm" });
      const receivedAt = dateOnly(input.receivedAt);
      if (!receivedAt || receivedAt > new Date() || !Number.isInteger(input.minimumHoldDays) || input.minimumHoldDays < 1 || input.minimumHoldDays > 180) {
        return { ok: false as const, code: "validation_error", message: "Choose a valid receipt date and 1-180 day quarantine hold." };
      }
      const session = await tx.shipmentReceiptSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!session || !["in_progress", "ready_for_confirmation"].includes(session.status)) return { ok: false as const, code: "invalid_transition", message: "This receipt is already terminal." };
      const manifest = await tx.shipmentManifest.findUnique({ where: { id: session.manifestId } });
      if (!manifest || manifest.status !== "receiving") return { ok: false as const, code: "invalid_transition", message: "The expected manifest is not in receiving state." };
      if (manifest.sourceType !== "vendor") return { ok: false as const, code: "unsupported_source", message: "Only vendor purchase manifests use animal intake confirmation. Internal transfers use custody receipt." };
      const items = await tx.shipmentManifestItem.findMany({ where: { manifestId: manifest.id }, orderBy: { expectedIdentifier: "asc" } });
      const observations = await tx.shipmentReceiptObservation.findMany({ where: { sessionId: session.id }, orderBy: { observedAt: "asc" } });
      const matchedItemIds = [...new Set(observations.filter((row) => row.outcome === "matched" && row.manifestItemId).map((row) => row.manifestItemId!))];
      const matchedItems = items.filter((item) => matchedItemIds.includes(item.id));
      const exceptionCount = observations.filter((row) => row.outcome !== "matched").length;
      const finalization = receiptFinalizationResult({ expectedCount: items.length, matchedCount: matchedItems.length, exceptionCount });
      if (matchedItems.length > 0 && manifest.healthEvidenceStatus !== "compatible") {
        return { ok: false as const, code: "health_evidence_block", message: "Compatible operational health evidence is required before accepted intake." };
      }

      let intakeBatchId: string | null = null;
      let quarantineCaseId: string | null = null;
      if (matchedItems.length > 0) {
        if (!input.destinationCageId || !manifest.protocolAuthorizationId) return { ok: false as const, code: "validation_error", message: "Choose a quarantine cage and active protocol authorization before confirmation." };
        const cage = await tx.cage.findFirst({
          where: { id: input.destinationCageId, labId: manifest.labId, active: true, status: "quarantine" },
          select: {
            id: true,
            barcode: true,
            animals: { where: { outcomeStatus: "alive" }, select: { id: true } },
            quarantineCases: { where: { status: { in: ["admitted", "under_observation", "exception_open", "release_requested"] } }, select: { id: true } },
          },
        });
        if (!cage || cage.quarantineCases.length || cage.animals.length) return { ok: false as const, code: "quarantine_capacity_block", message: "Choose a pre-existing quarantine cage with zero live occupants and no open case." };
        intakeBatchId = `intake-m16-${randomUUID()}`;
        const reserved = await evaluateAndWriteComplianceEvidence(tx, {
          actor: input.actor,
          receiptId: context.receiptId,
          commandType: "m16.shipment.confirm",
          labId: manifest.labId,
          aggregateType: "intake_batch",
          aggregateId: intakeBatchId,
          commandAggregateType: "shipment_receipt_session",
          commandAggregateId: session.id,
          protocolAuthorizationId: manifest.protocolAuthorizationId,
          strainIds: matchedItems.map((item) => item.strainId),
          procedureCode: "intake",
          requiredPersonnelRoles: ["intake_operator"],
          countOperation: "reserve",
          quantity: matchedItems.length,
          allocationKey: `intake_batch:${intakeBatchId}:reserve`,
          evidenceKey: "m16-shipment-reserve",
        });
        if (!reserved.ok) return { ok: false as const, code: reserved.code, message: reserved.message };
        if (!reserved.allocationId) return { ok: false as const, code: "allocation_missing", message: "The exact intake count reservation could not be frozen." };
        const consumed = await evaluateAndWriteComplianceEvidence(tx, {
          actor: input.actor,
          receiptId: context.receiptId,
          commandType: "m16.shipment.confirm",
          labId: manifest.labId,
          aggregateType: "intake_batch",
          aggregateId: intakeBatchId,
          commandAggregateType: "shipment_receipt_session",
          commandAggregateId: session.id,
          protocolAuthorizationId: reserved.protocolAuthorizationId,
          strainIds: matchedItems.map((item) => item.strainId),
          procedureCode: "intake",
          requiredPersonnelRoles: ["intake_operator"],
          countOperation: "consume",
          quantity: matchedItems.length,
          sourceAllocationId: reserved.allocationId,
          allocationKey: `intake_batch:${intakeBatchId}:consume`,
          evidenceKey: "m16-shipment-consume",
        });
        if (!consumed.ok) return { ok: false as const, code: consumed.code, message: consumed.message };
        const mutation = await receivePurchasedAnimals({
          batchId: intakeBatchId,
          protocolAuthorizationId: manifest.protocolAuthorizationId,
          frozenCompliance: {
            protocolAuthorizationId: consumed.protocolAuthorizationId,
            complianceEvidenceSnapshotId: consumed.evidenceSnapshotId,
            protocolCountAllocationId: reserved.allocationId,
          },
          labId: manifest.labId,
          vendor: manifest.sourceName,
          orderReference: manifest.externalReference,
          arrivalDate: input.receivedAt,
          disposition: "quarantine",
          notes: `Controlled receipt from manifest ${manifest.id}.`,
          cages: [],
          animals: matchedItems.map((item) => ({
            rowId: item.id,
            sourceAnimalId: item.expectedIdentifier,
            sex: item.expectedSex,
            dob: item.expectedDob.toISOString().slice(0, 10),
            strainId: item.strainId,
            healthNotes: "Operational quarantine intake; see manifest health evidence.",
            destination: { kind: "existing" as const, cageId: cage.id },
          })),
        }, { id: input.actor.id, role: input.actor.role, activeLabId: input.actor.activeLabId }, tx);
        if (!mutation.ok) return { ok: false as const, code: "intake_rejected", message: mutation.message };
        quarantineCaseId = `quarantine-m16-${randomUUID()}`;
        await tx.quarantineCase.create({ data: {
          id: quarantineCaseId,
          labId: manifest.labId,
          cageId: cage.id,
          intakeBatchId,
          admittedAt: receivedAt,
          minimumReleaseAt: addDays(receivedAt, input.minimumHoldDays),
          admissionReason: `Shipment ${manifest.externalReference} controlled intake`,
          admittedById: input.actor.id,
        } });
      }

      if (matchedItemIds.length) await tx.shipmentManifestItem.updateMany({ where: { id: { in: matchedItemIds }, manifestId: manifest.id, status: "expected" }, data: { status: "accepted", version: { increment: 1 } } });
      const exceptionItemIds = [...new Set(observations.filter((row) => row.outcome !== "matched" && row.manifestItemId).map((row) => row.manifestItemId!))];
      if (exceptionItemIds.length) await tx.shipmentManifestItem.updateMany({ where: { id: { in: exceptionItemIds }, manifestId: manifest.id, status: "expected" }, data: { status: "exception", version: { increment: 1 } } });
      await tx.shipmentManifestItem.updateMany({ where: { manifestId: manifest.id, status: "expected" }, data: { status: "missing", version: { increment: 1 } } });
      await tx.shipmentReconciliationSummary.create({ data: {
        id: `shipment-summary-${randomUUID()}`,
        sessionId: session.id,
        manifestId: manifest.id,
        labId: manifest.labId,
        expectedCount: items.length,
        acceptedCount: matchedItems.length,
        exceptionCount,
        missingCount: finalization.missingCount,
        affectedIntakeBatchId: intakeBatchId,
        affectedQuarantineCaseId: quarantineCaseId,
        result: finalization.result,
        summary: { policyMarker: M16_POLICY_MARKER, duplicateCount: observations.filter((row) => row.outcome === "duplicate").length, unknownCount: observations.filter((row) => row.outcome === "unknown").length, damagedCount: observations.filter((row) => row.outcome === "damaged").length, deadOnArrivalCount: observations.filter((row) => row.outcome === "dead_on_arrival").length },
        finalizedById: input.actor.id,
        finalizedAt: new Date(),
        commandReceiptId: context.receiptId,
      } });
      const finalizedSession = await tx.shipmentReceiptSession.update({ where: { id: session.id }, data: { status: "finalized", finalizedById: input.actor.id, finalizedAt: new Date(), version: { increment: 1 } } });
      await tx.shipmentManifest.update({ where: { id: manifest.id }, data: { status: finalization.status, intakeBatchId, quarantineCaseId, version: { increment: 1 } } });
      await appendLifecycleEvent(tx, {
        actor: input.actor,
        receiptId: context.receiptId,
        domain: "shipment",
        aggregateType: "shipment_receipt_session",
        aggregateId: session.id,
        labId: session.labId,
        eventType: "receipt_confirmed",
        previousStatus: session.status,
        resultingStatus: "finalized",
        evidence: requestJson({ result: finalization.result, acceptedCount: matchedItems.length, exceptionCount, missingCount: finalization.missingCount, intakeBatchId, quarantineCaseId, policyMarker: M16_POLICY_MARKER }),
        createAudit: matchedItems.length === 0,
      });
      return { ok: true as const, result: requestJson({ sessionId: session.id, version: finalizedSession.version, result: finalization.result, acceptedCount: matchedItems.length, exceptionCount, missingCount: finalization.missingCount, intakeBatchId, quarantineCaseId, message: matchedItems.length ? "Shipment confirmed into guarded quarantine intake." : "Exception-only shipment reconciliation recorded; no animals or cages changed." }), aggregateType: "shipment_receipt_session", aggregateId: session.id, resultingVersion: finalizedSession.version };
    }),
  });
}

export async function executeStartCensusSessionCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  command: { labId: string; roomId: string; rackLabel?: string; ownerId: string };
}) {
  const censusId = `census-${randomUUID()}`;
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "m16.census.start",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson(input.command),
    requiredCapability: "reconciliation:manage",
    labId: input.command.labId,
    aggregateType: "census_session",
    aggregateId: censusId,
    handler: async (tx, context) => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType: "m16.census.start" });
      const room = await tx.room.findUnique({ where: { id: input.command.roomId }, select: { id: true, facilityId: true } });
      const owner = await tx.user.findFirst({ where: { id: input.command.ownerId, active: true, OR: [{ role: { in: ["admin", "colony_manager"] } }, { labMemberships: { some: { labId: input.command.labId, active: true, role: { in: ["owner", "manager", "staff"] } } } }] }, select: { id: true } });
      if (!room || !owner) return { ok: false as const, code: "validation_error", message: "Choose an active room and authorized census owner." };
      const census = await tx.censusSession.create({ data: { id: censusId, labId: input.command.labId, facilityId: room.facilityId, roomId: room.id, rackLabel: input.command.rackLabel?.trim() || null, ownerId: owner.id, startedById: input.actor.id } });
      await appendLifecycleEvent(tx, { actor: input.actor, receiptId: context.receiptId, domain: "census", aggregateType: "census_session", aggregateId: census.id, labId: census.labId, eventType: "started", resultingStatus: census.status, evidence: requestJson({ roomId: room.id, rackLabel: census.rackLabel, ownerId: owner.id, policyMarker: M16_POLICY_MARKER }) });
      return { ok: true as const, result: requestJson({ censusId: census.id, version: census.version, message: "Census session started." }), aggregateType: "census_session", aggregateId: census.id, resultingVersion: census.version };
    },
  });
}

export async function executeRecordCensusObservationCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  sessionId: string;
  expectedVersion: number;
  observation: {
    observedIdentifier: string;
    cageId?: string;
    observedLiveCount?: number;
    observedMaleCount?: number;
    observedFemaleCount?: number;
    outcome: CensusOutcome;
    discrepancyCodes?: string[];
    operationalCondition?: string;
  };
}) {
  const preflight = await preauthorizeTargetLookup(input.actor, "reconciliation:manage");
  if (!preflight.ok) return { ok: false as const, code: "forbidden", message: "Current operational reconciliation authority is required." };
  const target = await prisma.censusSession.findFirst({ where: { id: input.sessionId, ...preflight.labWhere }, select: { labId: true } });
  if (!target) return { ok: false as const, code: "not_found", message: "Census session not found." };
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "m16.census.observe",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson(input),
    requiredCapability: "reconciliation:manage",
    labId: target.labId,
    aggregateType: "census_session",
    aggregateId: input.sessionId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType: "m16.census.observe" });
      const session = await tx.censusSession.findUnique({ where: { id: input.sessionId } });
      if (!session || session.status !== "in_progress") return { ok: false as const, code: "invalid_transition", message: "Census observations require an open session." };
      const identifier = boundedText(input.observation.observedIdentifier, 1, 160);
      const discrepancyType = discrepancyTypeForCensus(input.observation.outcome);
      const cage = input.observation.cageId ? await tx.cage.findFirst({ where: { id: input.observation.cageId, labId: session.labId }, select: { id: true, barcode: true, roomId: true, animals: { where: { outcomeStatus: "alive" }, select: { sex: true } } } }) : null;
      if (!identifier || (input.observation.outcome !== "unknown" && !cage)) return { ok: false as const, code: "validation_error", message: "Choose an authorized cage or record an unknown identifier discrepancy." };
      if (input.observation.outcome === "unknown" && cage) return { ok: false as const, code: "validation_error", message: "An unknown identifier cannot be associated with a known cage." };
      if (cage && input.observation.outcome === "wrong_location" && cage.roomId === session.roomId) return { ok: false as const, code: "location_outcome_mismatch", message: "Wrong location requires an authorized cage outside the census session room." };
      if (cage && ["matched", "count_mismatch", "damaged_label", "empty"].includes(input.observation.outcome) && cage.roomId !== session.roomId) return { ok: false as const, code: "location_outcome_mismatch", message: "This outcome requires a cage in the census session room; use wrong location for another room." };
      if (input.observation.outcome === "matched" && cage) {
        const male = cage.animals.filter((animal) => animal.sex === "male").length;
        const female = cage.animals.filter((animal) => animal.sex === "female").length;
        if (cage.roomId !== session.roomId || identifier !== cage.barcode || input.observation.observedLiveCount !== cage.animals.length || input.observation.observedMaleCount !== male || input.observation.observedFemaleCount !== female) {
          return { ok: false as const, code: "mismatch_requires_exception", message: "Observed location or counts differ from current records. Record a discrepancy instead." };
        }
      }
      const observation = await tx.censusObservation.create({ data: {
        id: `census-observation-${randomUUID()}`,
        sessionId: session.id,
        labId: session.labId,
        cageId: cage?.id ?? null,
        observedIdentifier: identifier,
        observedLiveCount: input.observation.observedLiveCount ?? null,
        observedMaleCount: input.observation.observedMaleCount ?? null,
        observedFemaleCount: input.observation.observedFemaleCount ?? null,
        outcome: input.observation.outcome,
        discrepancyCodes: input.observation.discrepancyCodes ?? [],
        operationalCondition: input.observation.operationalCondition?.trim() || null,
        observedById: input.actor.id,
        commandReceiptId: context.receiptId,
      } });
      if (discrepancyType) await tx.censusDiscrepancy.create({ data: { id: `census-discrepancy-${randomUUID()}`, sessionId: session.id, observationId: observation.id, labId: session.labId, discrepancyType, ownerId: session.ownerId } });
      const updated = await tx.censusSession.update({ where: { id: session.id }, data: { version: { increment: 1 } } });
      await appendLifecycleEvent(tx, { actor: input.actor, receiptId: context.receiptId, domain: "census", aggregateType: "census_session", aggregateId: session.id, labId: session.labId, eventType: "observation_recorded", previousStatus: session.status, resultingStatus: updated.status, evidence: requestJson({ outcome: input.observation.outcome, discrepancyQueued: Boolean(discrepancyType), cageId: cage?.id ?? null, policyMarker: M16_POLICY_MARKER }) });
      return { ok: true as const, result: requestJson({ censusId: session.id, version: updated.version, discrepancyQueued: Boolean(discrepancyType), message: discrepancyType ? "Census discrepancy queued; colony records were not changed." : "Census observation matched current records." }), aggregateType: "census_session", aggregateId: session.id, resultingVersion: updated.version };
    },
  });
}

export async function executeAdvanceCensusSessionCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  sessionId: string;
  expectedVersion: number;
  action: "submit_review" | "sign_off" | "cancel";
}) {
  const capability: Capability = input.action === "sign_off" ? "reconciliation:approve" : "reconciliation:manage";
  const preflight = await preauthorizeTargetLookup(input.actor, capability);
  if (!preflight.ok) return { ok: false as const, code: "forbidden", message: "Current operational reconciliation authority is required." };
  const target = await prisma.censusSession.findFirst({ where: { id: input.sessionId, ...preflight.labWhere }, select: { labId: true } });
  if (!target) return { ok: false as const, code: "not_found", message: "Census session not found." };
  const commandType = `m16.census.${input.action}`;
  return executeIdempotentCommand({
    actor: input.actor,
    commandType,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson({ sessionId: input.sessionId, expectedVersion: input.expectedVersion, action: input.action }),
    requiredCapability: input.action === "sign_off" ? "reconciliation:approve" : "reconciliation:manage",
    labId: target.labId,
    aggregateType: "census_session",
    aggregateId: input.sessionId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType });
      const session = await tx.censusSession.findUnique({ where: { id: input.sessionId } });
      if (!session) return { ok: false as const, code: "not_found", message: "Census session not found." };
      const nextStatus = input.action === "submit_review" ? "review" : input.action === "sign_off" ? "signed_off" : "cancelled";
      if (!canTransitionCensus(session.status, nextStatus)) return { ok: false as const, code: "invalid_transition", message: "This census transition is not allowed." };
      if (input.action === "sign_off") {
        const open = await tx.censusDiscrepancy.count({ where: { sessionId: session.id, status: { in: ["open", "assigned", "resolved"] } } });
        if (open) return { ok: false as const, code: "open_discrepancies", message: "Every discrepancy needs independent sign-off before the census can close." };
        const participation = await Promise.all([
          tx.censusObservation.count({ where: { sessionId: session.id, observedById: input.actor.id } }),
          tx.censusDiscrepancy.count({ where: { sessionId: session.id, resolvedById: input.actor.id } }),
        ]);
        if (session.startedById === input.actor.id || session.ownerId === input.actor.id || participation.some((count) => count > 0)) {
          return { ok: false as const, code: "independence_required", message: "Census sign-off requires a person who did not start, own, observe, or resolve this census." };
        }
      }
      const updated = await tx.censusSession.update({ where: { id: session.id }, data: { status: nextStatus, signedOffById: input.action === "sign_off" ? input.actor.id : undefined, signedOffAt: input.action === "sign_off" ? new Date() : undefined, version: { increment: 1 } } });
      await appendLifecycleEvent(tx, { actor: input.actor, receiptId: context.receiptId, domain: "census", aggregateType: "census_session", aggregateId: session.id, labId: session.labId, eventType: input.action, previousStatus: session.status, resultingStatus: updated.status, evidence: requestJson({ policyMarker: M16_POLICY_MARKER, automaticCorrection: false }) });
      return { ok: true as const, result: requestJson({ censusId: session.id, version: updated.version, status: updated.status, message: `Census ${updated.status.replaceAll("_", " ")}.` }), aggregateType: "census_session", aggregateId: session.id, resultingVersion: updated.version };
    },
  });
}

export async function executeResolveCensusDiscrepancyCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  discrepancyId: string;
  expectedVersion: number;
  action: "resolve" | "sign_off" | "reject";
  reason: string;
}) {
  const capability: Capability = input.action === "sign_off" ? "reconciliation:approve" : "reconciliation:manage";
  const preflight = await preauthorizeTargetLookup(input.actor, capability);
  if (!preflight.ok) return { ok: false as const, code: "forbidden", message: "Current operational reconciliation authority is required." };
  const target = await prisma.censusDiscrepancy.findFirst({ where: { id: input.discrepancyId, ...preflight.labWhere }, select: { labId: true } });
  if (!target) return { ok: false as const, code: "not_found", message: "Census discrepancy not found." };
  const commandType = `m16.census.discrepancy_${input.action}`;
  return executeIdempotentCommand({
    actor: input.actor,
    commandType,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson(input),
    requiredCapability: input.action === "sign_off" ? "reconciliation:approve" : "reconciliation:manage",
    labId: target.labId,
    aggregateType: "census_discrepancy",
    aggregateId: input.discrepancyId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType });
      const discrepancy = await tx.censusDiscrepancy.findUnique({ where: { id: input.discrepancyId } });
      const reason = boundedText(input.reason, 3, 600);
      if (!discrepancy || !reason) return { ok: false as const, code: "validation_error", message: "Enter a reason for the discrepancy decision." };
      if (input.action === "resolve" && !["open", "assigned"].includes(discrepancy.status)) return { ok: false as const, code: "invalid_transition", message: "Only an open discrepancy can be resolved." };
      if (input.action === "resolve" && discrepancy.ownerId !== input.actor.id) return { ok: false as const, code: "owner_required", message: "The assigned discrepancy owner must record the resolution." };
      if (input.action === "sign_off" && discrepancy.status !== "resolved") return { ok: false as const, code: "invalid_transition", message: "Resolve the discrepancy before independent sign-off." };
      if (input.action === "sign_off" && discrepancy.resolvedById === input.actor.id) return { ok: false as const, code: "independence_required", message: "A different authorized person must sign off the resolution." };
      const status = input.action === "resolve" ? "resolved" : input.action === "sign_off" ? "signed_off" : "rejected";
      const updated = await tx.censusDiscrepancy.update({ where: { id: discrepancy.id }, data: { status, resolutionReason: reason, resolvedById: input.action === "resolve" ? input.actor.id : discrepancy.resolvedById, resolvedAt: input.action === "resolve" ? new Date() : discrepancy.resolvedAt, signedOffById: input.action === "sign_off" ? input.actor.id : null, signedOffAt: input.action === "sign_off" ? new Date() : null, version: { increment: 1 } } });
      await appendLifecycleEvent(tx, { actor: input.actor, receiptId: context.receiptId, domain: "census", aggregateType: "census_discrepancy", aggregateId: discrepancy.id, labId: discrepancy.labId, eventType: `discrepancy_${input.action}`, previousStatus: discrepancy.status, resultingStatus: updated.status, evidence: requestJson({ reason, policyMarker: M16_POLICY_MARKER, automaticCorrection: false }) });
      return { ok: true as const, result: requestJson({ discrepancyId: discrepancy.id, version: updated.version, status: updated.status, message: "Discrepancy decision saved without rewriting census or colony evidence." }), aggregateType: "census_discrepancy", aggregateId: discrepancy.id, resultingVersion: updated.version };
    },
  });
}

export async function executeGrantCapacityExceptionCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  command: { cageId: string; additionalCapacity: number; startsAt: string; expiresAt: string; reason: string };
}) {
  const preflight = await preauthorizeTargetLookup(input.actor, "reconciliation:approve");
  if (!preflight.ok) return { ok: false as const, code: "forbidden", message: "Current reconciliation approval authority is required." };
  const target = await prisma.cage.findFirst({ where: { id: input.command.cageId, ...preflight.labWhere }, select: { labId: true } });
  if (!target) return { ok: false as const, code: "not_found", message: "Cage not found." };
  const exceptionId = `capacity-exception-${randomUUID()}`;
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "m16.capacity.grant",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson(input.command),
    requiredCapability: "reconciliation:approve",
    labId: target.labId,
    aggregateType: "capacity_exception",
    aggregateId: exceptionId,
    handler: async (tx, context) => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType: "m16.capacity.grant" });
      const startsAt = new Date(input.command.startsAt);
      const expiresAt = new Date(input.command.expiresAt);
      const reason = boundedText(input.command.reason, 3, 600);
      if (!reason || !Number.isInteger(input.command.additionalCapacity) || input.command.additionalCapacity < 1 || input.command.additionalCapacity > 20 || Number.isNaN(startsAt.getTime()) || Number.isNaN(expiresAt.getTime()) || expiresAt <= startsAt || expiresAt.getTime() - startsAt.getTime() > 30 * 86_400_000) {
        return { ok: false as const, code: "validation_error", message: "Capacity exceptions require 1-20 spaces, a reason, and a window no longer than 30 days." };
      }
      const existing = await tx.cageCapacityException.findFirst({ where: { cageId: input.command.cageId, status: "active" } });
      if (existing) return { ok: false as const, code: "existing_exception", message: "This cage already has an active capacity exception." };
      const created = await tx.cageCapacityException.create({ data: { id: exceptionId, cageId: input.command.cageId, labId: target.labId, additionalCapacity: input.command.additionalCapacity, reason, startsAt, expiresAt, approvedById: input.actor.id } });
      await appendLifecycleEvent(tx, { actor: input.actor, receiptId: context.receiptId, domain: "capacity", aggregateType: "capacity_exception", aggregateId: created.id, labId: created.labId, eventType: "granted", resultingStatus: created.status, evidence: requestJson({ cageId: created.cageId, additionalCapacity: created.additionalCapacity, startsAt: created.startsAt.toISOString(), expiresAt: created.expiresAt.toISOString(), reason, policyMarker: M16_POLICY_MARKER }) });
      return { ok: true as const, result: requestJson({ exceptionId: created.id, version: created.version, message: "Temporary capacity exception granted; it will expire automatically in operational reads." }), aggregateType: "capacity_exception", aggregateId: created.id, resultingVersion: created.version };
    },
  });
}

export async function executeRevokeCapacityExceptionCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  exceptionId: string;
  expectedVersion: number;
  reason: string;
}) {
  const preflight = await preauthorizeTargetLookup(input.actor, "reconciliation:approve");
  if (!preflight.ok) return { ok: false as const, code: "forbidden", message: "Current reconciliation approval authority is required." };
  const target = await prisma.cageCapacityException.findFirst({ where: { id: input.exceptionId, ...preflight.labWhere }, select: { labId: true } });
  if (!target) return { ok: false as const, code: "not_found", message: "Capacity exception not found." };
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "m16.capacity.revoke",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson(input),
    requiredCapability: "reconciliation:approve",
    labId: target.labId,
    aggregateType: "capacity_exception",
    aggregateId: input.exceptionId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType: "m16.capacity.revoke" });
      const current = await tx.cageCapacityException.findUnique({ where: { id: input.exceptionId } });
      const reason = boundedText(input.reason, 3, 600);
      if (!current || current.status !== "active" || !reason) return { ok: false as const, code: "invalid_transition", message: "Only an active exception can be revoked with a reason." };
      const updated = await tx.cageCapacityException.update({ where: { id: current.id }, data: { status: "revoked", revokedById: input.actor.id, revokedAt: new Date(), revokeReason: reason, version: { increment: 1 } } });
      await appendLifecycleEvent(tx, { actor: input.actor, receiptId: context.receiptId, domain: "capacity", aggregateType: "capacity_exception", aggregateId: current.id, labId: current.labId, eventType: "revoked", previousStatus: current.status, resultingStatus: updated.status, evidence: requestJson({ reason, policyMarker: M16_POLICY_MARKER }) });
      return { ok: true as const, result: requestJson({ exceptionId: current.id, version: updated.version, message: "Capacity exception revoked." }), aggregateType: "capacity_exception", aggregateId: current.id, resultingVersion: updated.version };
    },
  });
}

async function transferTarget(actor: ResolvedActor, requestId: string, side: "source" | "destination") {
  const preflight = await preauthorizeTargetLookup(actor, "reconciliation:manage");
  if (!preflight.ok) return null;
  const participantWhere = hasUnitOperationalScope(actor)
    ? {}
    : side === "source"
      ? { sourceLabId: actor.activeLabId ?? "__no_lab__" }
      : { destinationLabId: actor.activeLabId ?? "__no_lab__" };
  return prisma.labTransferRequest.findFirst({ where: { id: requestId, ...participantWhere }, select: { sourceLabId: true, destinationLabId: true, status: true, version: true } });
}

export async function executeDispatchTransferCustodyCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  transferRequestId: string;
  expectedVersion: number;
}) {
  const target = await transferTarget(input.actor, input.transferRequestId, "source");
  if (!target) return { ok: false as const, code: "not_found", message: "Transfer request not found." };
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "m16.transfer.dispatch",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson({ transferRequestId: input.transferRequestId, expectedVersion: input.expectedVersion }),
    requiredCapability: "reconciliation:manage",
    labId: target.sourceLabId,
    aggregateType: "lab_transfer_request",
    aggregateId: input.transferRequestId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType: "m16.transfer.dispatch" });
      const request = await tx.labTransferRequest.findUnique({ where: { id: input.transferRequestId }, include: { items: { where: { active: true }, include: { animal: { select: { id: true, facilityAnimalId: true, owningLabId: true, currentCageId: true, outcomeStatus: true } } } }, packets: { orderBy: { version: "desc" }, take: 1 } } });
      if (!request || request.status !== "destination_accepted" || !request.acceptedPacketVersion || !request.acceptedPacketHash) return { ok: false as const, code: "invalid_transition", message: "Only an accepted, frozen transfer packet can be dispatched." };
      if (request.items.length === 0) return { ok: false as const, code: "invalid_transition", message: "Dispatch requires at least one active transfer animal; inactive or cancelled items are excluded." };
      const packet = request.packets[0];
      if (!packet || packet.version !== request.acceptedPacketVersion || packet.payloadHash !== request.acceptedPacketHash || packet.version !== request.packetVersion) return { ok: false as const, code: "stale_packet", message: "The accepted packet is stale. Destination approval must be repeated." };
      if (request.items.some((item) => item.animal.owningLabId !== request.sourceLabId || item.animal.outcomeStatus !== "alive" || (item.sourceCageId && item.animal.currentCageId !== item.sourceCageId))) return { ok: false as const, code: "stale_animal_state", message: "Animal ownership, lifecycle, or cage state changed before dispatch." };
      const event = await tx.transferCustodyEvent.create({ data: { id: `custody-${randomUUID()}`, requestId: request.id, sourceLabId: request.sourceLabId, destinationLabId: request.destinationLabId, packetVersion: packet.version, packetHash: packet.payloadHash, eventType: "dispatched", expectedItemCount: request.items.length, observedItemCount: request.items.length, operationalFacts: { policyMarker: M16_POLICY_MARKER, quarantineRequired: true, packetFields: ["health", "quarantine", "treatment", "licence", "safety"] }, actorId: input.actor.id, actorLabId: request.sourceLabId, commandReceiptId: context.receiptId } });
      await tx.transferCustodyExpectedItem.createMany({ data: request.items.map((item) => ({
        id: `custody-expected-${randomUUID()}`, custodyEventId: event.id, requestId: request.id,
        transferItemId: item.id, animalId: item.animalId, frozenIdentifier: item.animal.facilityAnimalId,
      })) });
      await appendLifecycleEvent(tx, { actor: input.actor, receiptId: context.receiptId, domain: "transfer_custody", aggregateType: "lab_transfer_request", aggregateId: request.id, labId: request.sourceLabId, eventType: "dispatched", previousStatus: request.status, resultingStatus: request.status, evidence: requestJson({ custodyEventId: event.id, packetVersion: packet.version, packetHash: packet.payloadHash, expectedItemCount: request.items.length, policyMarker: M16_POLICY_MARKER }) });
      return { ok: true as const, result: requestJson({ requestId: request.id, custodyEventId: event.id, version: request.version, message: "Dispatch custody recorded. This did not change ownership or location." }), aggregateType: "lab_transfer_request", aggregateId: request.id, resultingVersion: request.version };
    },
  });
}

export async function executeCancelTransferDispatchCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  transferRequestId: string;
  expectedVersion: number;
  reason: string;
}) {
  const target = await transferTarget(input.actor, input.transferRequestId, "source");
  if (!target) return { ok: false as const, code: "not_found", message: "Transfer request not found." };
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "m16.transfer.cancel_dispatch",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson(input),
    requiredCapability: "reconciliation:manage",
    labId: target.sourceLabId,
    aggregateType: "lab_transfer_request",
    aggregateId: input.transferRequestId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType: "m16.transfer.cancel_dispatch" });
      const request = await tx.labTransferRequest.findUnique({ where: { id: input.transferRequestId }, include: { packets: { orderBy: { version: "desc" }, take: 1 } } });
      const dispatch = await tx.transferCustodyEvent.findFirst({ where: { requestId: input.transferRequestId, eventType: "dispatched" } });
      const terminal = await tx.transferCustodyEvent.findFirst({ where: { requestId: input.transferRequestId, eventType: { in: ["destination_received", "partial_failure", "dispatch_cancelled"] } } });
      const reason = boundedText(input.reason, 3, 600);
      if (!request || !dispatch || terminal || request.status === "finalized" || !reason) return { ok: false as const, code: "invalid_transition", message: "Only a dispatched, not-yet-finalized packet can be cancelled with a reason." };
      const event = await tx.transferCustodyEvent.create({ data: { id: `custody-${randomUUID()}`, requestId: request.id, sourceLabId: request.sourceLabId, destinationLabId: request.destinationLabId, packetVersion: dispatch.packetVersion, packetHash: dispatch.packetHash, eventType: "dispatch_cancelled", expectedItemCount: dispatch.expectedItemCount, observedItemCount: 0, operationalFacts: { policyMarker: M16_POLICY_MARKER, reason }, actorId: input.actor.id, actorLabId: request.sourceLabId, commandReceiptId: context.receiptId } });
      await appendLifecycleEvent(tx, { actor: input.actor, receiptId: context.receiptId, domain: "transfer_custody", aggregateType: "lab_transfer_request", aggregateId: request.id, labId: request.sourceLabId, eventType: "dispatch_cancelled", previousStatus: request.status, resultingStatus: request.status, evidence: requestJson({ custodyEventId: event.id, reason, policyMarker: M16_POLICY_MARKER }) });
      return { ok: true as const, result: requestJson({ requestId: request.id, version: request.version, message: "Dispatch cancellation recorded; transfer state remains governed by the existing transfer workflow." }), aggregateType: "lab_transfer_request", aggregateId: request.id, resultingVersion: request.version };
    },
  });
}

export async function executeReceiveTransferCustodyCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  transferRequestId: string;
  expectedVersion: number;
  operationalFacts: Record<string, unknown>;
  items: Array<{ animalId: string; expectedIdentifier: string; observedIdentifier?: string; outcome: TransferCustodyOutcome; operationalCondition?: string }>;
}) {
  const target = await transferTarget(input.actor, input.transferRequestId, "destination");
  if (!target) return { ok: false as const, code: "not_found", message: "Transfer request not found." };
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "m16.transfer.receive",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson({ transferRequestId: input.transferRequestId, expectedVersion: input.expectedVersion, operationalFacts: input.operationalFacts, items: input.items }),
    requiredCapability: "reconciliation:manage",
    labId: target.destinationLabId,
    aggregateType: "lab_transfer_request",
    aggregateId: input.transferRequestId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType: "m16.transfer.receive" });
      if (!assertOperationalPacket(input.operationalFacts)) return { ok: false as const, code: "private_data_block", message: "Custody packets may contain operational health, quarantine, treatment, licence, and safety facts only." };
      const request = await tx.labTransferRequest.findUnique({ where: { id: input.transferRequestId }, include: { items: { where: { active: true }, include: { animal: { select: { id: true, facilityAnimalId: true, owningLabId: true } } } } } });
      const dispatch = await tx.transferCustodyEvent.findFirst({ where: { requestId: input.transferRequestId, eventType: "dispatched" }, include: { expectedItems: true } });
      const terminal = await tx.transferCustodyEvent.findFirst({ where: { requestId: input.transferRequestId, eventType: { in: ["destination_received", "partial_failure", "dispatch_cancelled"] } } });
      if (!request || request.status !== "finalized" || !dispatch || terminal) return { ok: false as const, code: "invalid_transition", message: "Destination receipt requires one dispatched packet and the existing atomic transfer finalization." };
      if (dispatch.packetVersion !== request.acceptedPacketVersion || dispatch.packetHash !== request.acceptedPacketHash) return { ok: false as const, code: "stale_packet", message: "The dispatched packet no longer matches the accepted transfer packet." };
      if (dispatch.expectedItems.length !== request.items.length) return { ok: false as const, code: "stale_packet", message: "The frozen dispatched animal set no longer matches the active transfer items." };
      if (input.items.length !== request.items.length || new Set(input.items.map((item) => item.expectedIdentifier.trim())).size !== request.items.length) return { ok: false as const, code: "partial_packet_shape", message: "Confirm an outcome for every dispatched item; missing items are recorded explicitly." };
      const activeItems = new Map(request.items.map((item) => [item.id, item]));
      const byIdentifier = new Map(dispatch.expectedItems.map((item) => [item.frozenIdentifier, item]));
      for (const item of input.items) {
        const expected = byIdentifier.get(item.expectedIdentifier.trim());
        if (!expected || !TRANSFER_CUSTODY_OUTCOMES.includes(item.outcome) || item.animalId !== expected.animalId || !activeItems.has(expected.transferItemId)) return { ok: false as const, code: "identifier_mismatch", message: "Receipt identifiers must match the exact frozen dispatched animal set." };
        if (item.outcome === "received" && item.observedIdentifier?.trim() !== item.expectedIdentifier.trim()) return { ok: false as const, code: "mismatch_requires_exception", message: "A changed identifier must be recorded as mismatched." };
        if (item.outcome !== "received" && !boundedText(item.operationalCondition ?? "", 3, 600)) return { ok: false as const, code: "validation_error", message: "Describe each custody exception in operational terms." };
      }
      const eventType = transferReceiptEventType(input.items.map((item) => item.outcome));
      const event = await tx.transferCustodyEvent.create({ data: {
        id: `custody-${randomUUID()}`,
        requestId: request.id,
        sourceLabId: request.sourceLabId,
        destinationLabId: request.destinationLabId,
        packetVersion: dispatch.packetVersion,
        packetHash: dispatch.packetHash,
        eventType,
        expectedItemCount: request.items.length,
        observedItemCount: input.items.filter((item) => item.observedIdentifier).length,
        operationalFacts: { ...input.operationalFacts, policyMarker: M16_POLICY_MARKER },
        actorId: input.actor.id,
        actorLabId: request.destinationLabId,
        commandReceiptId: context.receiptId,
      } });
      await tx.transferCustodyItemEvidence.createMany({ data: input.items.map((item) => {
        const expected = byIdentifier.get(item.expectedIdentifier.trim())!;
        return { id: `custody-item-${randomUUID()}`, custodyEventId: event.id, requestId: request.id, expectedItemId: expected.id, animalId: expected.animalId, expectedIdentifier: expected.frozenIdentifier, observedIdentifier: item.observedIdentifier?.trim() || null, outcome: item.outcome, operationalCondition: item.operationalCondition?.trim() || null };
      }) });
      let reconciliationId: string | null = null;
      if (eventType === "partial_failure") {
        reconciliationId = `custody-reconciliation-${randomUUID()}`;
        await tx.transferCustodyReconciliation.create({ data: { id: reconciliationId, requestId: request.id, custodyEventId: event.id, labId: request.destinationLabId, ownerId: input.actor.id } });
      }
      await appendLifecycleEvent(tx, { actor: input.actor, receiptId: context.receiptId, domain: "transfer_custody", aggregateType: "lab_transfer_request", aggregateId: request.id, labId: request.destinationLabId, eventType, previousStatus: request.status, resultingStatus: request.status, evidence: requestJson({ custodyEventId: event.id, reconciliationId, outcomes: input.items.map((item) => item.outcome), policyMarker: M16_POLICY_MARKER, automaticOwnershipRewrite: false }) });
      return { ok: true as const, result: requestJson({ requestId: request.id, version: request.version, eventType, reconciliationId, message: eventType === "destination_received" ? "Destination receipt confirmed against the dispatched packet." : "Partial custody failure queued; ownership and history were not silently changed." }), aggregateType: "lab_transfer_request", aggregateId: request.id, resultingVersion: request.version };
    },
  });
}

export async function executeResolveTransferCustodyReconciliationCommand(input: CommandIdentity & {
  actor: ResolvedActor;
  reconciliationId: string;
  expectedVersion: number;
  action: "resolve" | "sign_off" | "reject";
  reason: string;
}) {
  const capability: Capability = input.action === "sign_off" ? "reconciliation:approve" : "reconciliation:manage";
  const preflight = await preauthorizeTargetLookup(input.actor, capability);
  if (!preflight.ok) return { ok: false as const, code: "forbidden", message: "Current operational reconciliation authority is required." };
  const target = await prisma.transferCustodyReconciliation.findFirst({ where: { id: input.reconciliationId, ...preflight.labWhere }, select: { labId: true } });
  if (!target) return { ok: false as const, code: "not_found", message: "Custody reconciliation not found." };
  const commandType = `m16.transfer.reconciliation_${input.action}`;
  return executeIdempotentCommand({
    actor: input.actor,
    commandType,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: requestJson(input),
    requiredCapability: input.action === "sign_off" ? "reconciliation:approve" : "reconciliation:manage",
    labId: target.labId,
    aggregateType: "transfer_custody_reconciliation",
    aggregateId: input.reconciliationId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      await setM16Context(tx, { receiptId: context.receiptId, actorId: input.actor.id, commandType });
      const current = await tx.transferCustodyReconciliation.findUnique({ where: { id: input.reconciliationId } });
      const reason = boundedText(input.reason, 3, 600);
      if (!current || !reason) return { ok: false as const, code: "validation_error", message: "Enter a reconciliation reason." };
      if (input.action === "resolve" && current.status !== "open") return { ok: false as const, code: "invalid_transition", message: "Only an open custody reconciliation can be resolved." };
      if (input.action === "resolve" && current.ownerId !== input.actor.id) return { ok: false as const, code: "owner_required", message: "The assigned custody owner must record the resolution." };
      if (input.action === "sign_off" && (current.status !== "resolved" || current.resolvedById === input.actor.id)) return { ok: false as const, code: "independence_required", message: "A different authorized person must sign off a resolved custody reconciliation." };
      const status = input.action === "resolve" ? "resolved" : input.action === "sign_off" ? "signed_off" : "rejected";
      const updated = await tx.transferCustodyReconciliation.update({ where: { id: current.id }, data: { status, resolutionReason: reason, resolvedById: input.action === "resolve" ? input.actor.id : current.resolvedById, resolvedAt: input.action === "resolve" ? new Date() : current.resolvedAt, signedOffById: input.action === "sign_off" ? input.actor.id : null, signedOffAt: input.action === "sign_off" ? new Date() : null, version: { increment: 1 } } });
      await appendLifecycleEvent(tx, { actor: input.actor, receiptId: context.receiptId, domain: "transfer_custody", aggregateType: "transfer_custody_reconciliation", aggregateId: current.id, labId: current.labId, eventType: `reconciliation_${input.action}`, previousStatus: current.status, resultingStatus: updated.status, evidence: requestJson({ requestId: current.requestId, reason, policyMarker: M16_POLICY_MARKER, automaticOwnershipRewrite: false }) });
      return { ok: true as const, result: requestJson({ reconciliationId: current.id, version: updated.version, status: updated.status, message: "Custody reconciliation decision recorded without rewriting source evidence." }), aggregateType: "transfer_custody_reconciliation", aggregateId: current.id, resultingVersion: updated.version };
    },
  });
}

export async function currentDesignatedVeterinarianEvidence(tx: Prisma.TransactionClient, actor: ResolvedActor) {
  const duty: FacilityDuty = "designated_veterinarian";
  if (!actor.identityLinkId || !actor.authenticatedAt || !await isElevatedIdentityContextCurrent(tx, { userId: actor.id, identity: actor.email, identityLinkId: actor.identityLinkId, authenticationMethod: actor.authMethod, assurance: actor.assurance, authenticatedAt: actor.authenticatedAt }, { maxAgeMinutes: 15 })) return null;
  const assignment = await tx.facilityDutyAssignment.findFirst({ where: { userId: actor.id, duty, revokedAt: null, validFrom: { lte: new Date() }, validUntil: { gt: new Date() }, user: { active: true, authzVersion: actor.authzVersion } }, select: { id: true, version: true } });
  return assignment ? { assignment, identityLinkId: actor.identityLinkId, authenticatedAt: new Date(actor.authenticatedAt), assurance: actor.assurance! } : null;
}

export { appendLifecycleEvent, setM16Context };
