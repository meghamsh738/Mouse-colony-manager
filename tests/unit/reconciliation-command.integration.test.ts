import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getActorCapabilities } from "@/lib/capabilities";
import { prepareWorkflowReview } from "@/lib/command-foundation";
import { decideFacilityDutyRequest, requestFacilityDutyRevoke, type DutyGovernanceActor } from "@/lib/facility-duty-governance";
import { prisma } from "@/lib/prisma";
import { executeFinalizeQuarantineReleaseCommand, executeRecordQuarantineObservationCommand, executeRequestQuarantineReleaseCommand } from "@/lib/quarantine-write";
import {
  executeConfirmShipmentReceiptCommand,
  executeCreateShipmentManifestCommand,
  executeDecideShipmentHealthCompatibilityCommand,
  executeRecordShipmentHealthEvidenceCommand,
  executeRecordShipmentObservationCommand,
  executeStartShipmentReceiptCommand,
  appendLifecycleEvent,
  deriveManifestHealthStatus,
  setM16Context,
} from "@/lib/reconciliation-write";
import type { ResolvedActor } from "@/lib/session";
import { installReconciliationDatabaseFixture } from "./reconciliation-test-fixture";

let cleanup: (() => Promise<void>) | undefined;
beforeAll(async () => { cleanup = await installReconciliationDatabaseFixture(); }, 120_000);
afterAll(async () => { await cleanup?.(); await prisma.$disconnect(); }, 120_000);

function identity(prefix: string) {
  return { idempotencyKey: `${prefix}-${randomUUID()}`, requestId: `request-${randomUUID()}` };
}

async function actor(userId: string, labId: string): Promise<ResolvedActor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const membership = await prisma.labMembership.findFirstOrThrow({ where: { userId, labId, active: true }, include: { lab: true } });
  const identityLink = await prisma.externalIdentityLink.findFirstOrThrow({ where: { userId, active: true } });
  const activeMembership = { labId, labName: membership.lab.name, labCode: membership.lab.code, role: membership.role };
  return {
    id: user.id, email: user.email, name: user.name, databaseRole: user.role, role: "animal_staff", canonicalRole: "lab_user",
    authzVersion: user.authzVersion, authMethod: "synthetic_mfa", assurance: "synthetic_mfa", authenticatedAt: new Date().toISOString(), identityLinkId: identityLink.id,
    activeDuties: [], activeLabId: labId, activeMembership, memberships: [activeMembership],
    capabilities: [...getActorCapabilities({ canonicalRole: "lab_user", activeMembership, activeDuties: [] })],
  };
}

async function veterinarianActor(): Promise<ResolvedActor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: "user-veterinarian-qa" } });
  const identityLink = await prisma.externalIdentityLink.findFirstOrThrow({ where: { userId: user.id, active: true } });
  const membership = await prisma.labMembership.findFirstOrThrow({ where: { userId: user.id, labId: "lab-microglia", active: true }, include: { lab: true } });
  const activeMembership = { labId: membership.labId, labName: membership.lab.name, labCode: membership.lab.code, role: membership.role };
  const activeDuties = ["designated_veterinarian"] as const;
  return {
    id: user.id, email: user.email, name: user.name, databaseRole: user.role, role: "read_only", canonicalRole: "lab_user",
    authzVersion: user.authzVersion, authMethod: "synthetic_mfa", assurance: "synthetic_mfa", authenticatedAt: new Date().toISOString(), identityLinkId: identityLink.id,
    activeDuties: [...activeDuties], activeLabId: membership.labId, activeMembership, memberships: [activeMembership],
    capabilities: [...getActorCapabilities({ canonicalRole: "lab_user", activeMembership, activeDuties })],
  };
}

function resultValue<T>(result: { ok: boolean; result?: unknown }, key: string) {
  if (!result.ok || !result.result || typeof result.result !== "object" || Array.isArray(result.result)) throw new Error(`Missing ${key}`);
  return (result.result as Record<string, unknown>)[key] as T;
}

async function facilityAdminGovernanceActor(userId: "user-facility-admin-qa" | "user-facility-admin-approver-qa"): Promise<DutyGovernanceActor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const identity = await prisma.externalIdentityLink.findFirstOrThrow({ where: { userId, active: true } });
  return { id: user.id, email: user.email, canonicalRole: "facility_admin", authzVersion: user.authzVersion, authMethod: "synthetic_mfa", assurance: "synthetic_mfa", authenticatedAt: new Date().toISOString(), identityLinkId: identity.id };
}

describe.sequential("M16 shipment reconciliation command contract", () => {
  it("atomically turns a matched expected shipment into exact M13 intake and quarantine evidence", async () => {
    const owner = await actor("user-lab-owner-qa", "lab-microglia");
    const protocol = await prisma.protocolAuthorization.findFirstOrThrow({ where: { protocolCode: "QA-ACTIVE-6" } });
    const created = await executeCreateShipmentManifestCommand({ actor: owner, ...identity("manifest-create"), command: {
      labId: "lab-microglia", sourceType: "vendor", sourceName: "Synthetic Vendor", externalReference: `PO-${randomUUID()}`,
      expectedAt: new Date().toISOString().slice(0, 10), healthEvidenceStatus: "missing", protocolAuthorizationId: protocol.id,
      items: [{ expectedIdentifier: `SRC-${randomUUID()}`, strainId: "strain-creer", expectedSex: "male", expectedDob: "2026-08-01" }],
    } });
    expect(created.ok).toBe(true);
    const manifestId = resultValue<string>(created, "manifestId");
    const item = await prisma.shipmentManifestItem.findFirstOrThrow({ where: { manifestId } });
    expect((await executeRecordShipmentHealthEvidenceCommand({ actor: owner, manifestId, expectedVersion: 1, ...identity("health-evidence"), evidence: { evidenceType: "sentinel_panel", testCode: "SYNTHETIC-PANEL", result: "negative", collectedAt: new Date().toISOString().slice(0, 10), issuedAt: new Date().toISOString(), issuer: "Synthetic QA laboratory", operationalSummary: "Synthetic sentinel panel negative for controlled QA." } })).ok).toBe(true);
    expect(await prisma.shipmentManifest.findUniqueOrThrow({ where: { id: manifestId } })).toMatchObject({ healthEvidenceStatus: "pending", version: 2 });
    const veterinarian = await veterinarianActor();
    expect((await executeDecideShipmentHealthCompatibilityCommand({ actor: veterinarian, manifestId, expectedVersion: 2, decision: "compatible", reason: "Independent review of the complete negative synthetic evidence set.", ...identity("health-decision") })).ok).toBe(true);
    const started = await executeStartShipmentReceiptCommand({ actor: owner, manifestId, expectedVersion: 3, ...identity("receipt-start") });
    expect(started.ok).toBe(true);
    const sessionId = resultValue<string>(started, "sessionId");
    const observed = await executeRecordShipmentObservationCommand({ actor: owner, sessionId, expectedVersion: 1, ...identity("receipt-observe"), observation: {
      manifestItemId: item.id, observedIdentifier: item.expectedIdentifier, outcome: "matched", observedSex: item.expectedSex, observedDob: item.expectedDob.toISOString().slice(0, 10),
    } });
    expect(observed.ok).toBe(true);
    const confirmedIdentity = identity("receipt-confirm");
    const confirmed = await executeConfirmShipmentReceiptCommand({ actor: owner, sessionId, expectedVersion: 2, destinationCageId: "cage-m16-quarantine", receivedAt: new Date().toISOString().slice(0, 10), minimumHoldDays: 14, ...confirmedIdentity });
    expect(confirmed.ok).toBe(true);
    const batchId = resultValue<string>(confirmed, "intakeBatchId");
    const caseId = resultValue<string>(confirmed, "quarantineCaseId");
    const [manifest, savedItem, batch, animal, quarantineCase, summary, receipt, events, audits] = await Promise.all([
      prisma.shipmentManifest.findUniqueOrThrow({ where: { id: manifestId } }),
      prisma.shipmentManifestItem.findUniqueOrThrow({ where: { id: item.id } }),
      prisma.animalIntakeBatch.findUniqueOrThrow({ where: { id: batchId } }),
      prisma.animal.findFirstOrThrow({ where: { intakeBatchId: batchId } }),
      prisma.quarantineCase.findUniqueOrThrow({ where: { id: caseId } }),
      prisma.shipmentReconciliationSummary.findUniqueOrThrow({ where: { sessionId } }),
      prisma.commandReceipt.findFirstOrThrow({ where: { actorId: owner.id, commandType: "m16.shipment.confirm", idempotencyKey: confirmedIdentity.idempotencyKey } }),
      prisma.operationalReconciliationEvent.findMany({ where: { aggregateId: sessionId, eventType: "receipt_confirmed" } }),
      prisma.auditLog.findMany({ where: { commandType: "m16.shipment.confirm", commandAggregateId: sessionId } }),
    ]);
    expect(manifest).toMatchObject({ status: "received", intakeBatchId: batchId, quarantineCaseId: caseId });
    expect(savedItem.status).toBe("accepted");
    expect(batch.protocolCountAllocationId).toBeTruthy();
    expect(animal).toMatchObject({ sourceAnimalId: item.expectedIdentifier, currentCageId: "cage-m16-quarantine", owningLabId: "lab-microglia" });
    expect(quarantineCase).toMatchObject({ intakeBatchId: batchId, status: "admitted" });
    expect(summary).toMatchObject({ acceptedCount: 1, exceptionCount: 0, missingCount: 0, affectedIntakeBatchId: batchId, affectedQuarantineCaseId: caseId });
    expect(receipt.status).toBe("succeeded");
    expect(events).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(events[0]).toMatchObject({ commandReceiptId: receipt.id, actorId: receipt.actorId, actorAuthzVersion: receipt.actorAuthzVersion, labId: receipt.labId });
  }, 120_000);

  it("requires independent veterinary compatibility and never lets later negative evidence erase hazards", async () => {
    const owner = await actor("user-lab-owner-qa", "lab-microglia");
    const veterinarian = await veterinarianActor();
    const createManifest = async (prefix: string) => {
      const created = await executeCreateShipmentManifestCommand({ actor: owner, ...identity(`${prefix}-create`), command: {
        labId: "lab-microglia", sourceType: "vendor", sourceName: "Synthetic Veterinary QA", externalReference: `${prefix}-${randomUUID()}`,
        expectedAt: new Date().toISOString().slice(0, 10), healthEvidenceStatus: "missing",
        items: [{ expectedIdentifier: `${prefix}-SRC-${randomUUID()}`, strainId: "strain-creer", expectedSex: "female", expectedDob: "2026-08-01" }],
      } });
      return resultValue<string>(created, "manifestId");
    };
    const record = (recordingActor: ResolvedActor, manifestId: string, expectedVersion: number, result: "negative" | "positive" | "incompatible") => executeRecordShipmentHealthEvidenceCommand({
      actor: recordingActor, manifestId, expectedVersion, ...identity(`health-${result}`), evidence: { evidenceType: "sentinel_panel", testCode: `SYNTHETIC-${result}`, result, collectedAt: new Date().toISOString().slice(0, 10), issuedAt: new Date().toISOString(), issuer: "Synthetic QA laboratory", operationalSummary: `Synthetic ${result} health evidence.` },
    });

    const selfManifestId = await createManifest("SELF");
    expect((await record(veterinarian, selfManifestId, 1, "negative")).ok).toBe(true);
    expect(await executeDecideShipmentHealthCompatibilityCommand({ actor: veterinarian, manifestId: selfManifestId, expectedVersion: 2, decision: "compatible", reason: "Self certification must fail.", ...identity("self-cert") })).toMatchObject({ ok: false, code: "independence_required" });

    const positiveManifestId = await createManifest("POSITIVE");
    expect((await record(owner, positiveManifestId, 1, "positive")).ok).toBe(true);
    expect((await record(owner, positiveManifestId, 2, "negative")).ok).toBe(true);
    expect(await prisma.shipmentManifest.findUniqueOrThrow({ where: { id: positiveManifestId } })).toMatchObject({ healthEvidenceStatus: "positive", version: 3 });
    expect(await executeDecideShipmentHealthCompatibilityCommand({ actor: veterinarian, manifestId: positiveManifestId, expectedVersion: 3, decision: "compatible", reason: "Positive history cannot be erased.", ...identity("positive-cert") })).toMatchObject({ ok: false, code: "health_evidence_block" });

    const incompatibleManifestId = await createManifest("INCOMPATIBLE");
    expect((await record(owner, incompatibleManifestId, 1, "incompatible")).ok).toBe(true);
    expect((await record(owner, incompatibleManifestId, 2, "negative")).ok).toBe(true);
    expect(await prisma.shipmentManifest.findUniqueOrThrow({ where: { id: incompatibleManifestId } })).toMatchObject({ healthEvidenceStatus: "incompatible", version: 3 });
  }, 120_000);

  it("blocks matched intake without health evidence and rolls back all colony mutations", async () => {
    const owner = await actor("user-lab-owner-qa", "lab-microglia");
    const protocol = await prisma.protocolAuthorization.findFirstOrThrow({ where: { protocolCode: "QA-ACTIVE-6" } });
    const sourceIdentifier = `SRC-BLOCK-${randomUUID()}`;
    const created = await executeCreateShipmentManifestCommand({ actor: owner, ...identity("blocked-create"), command: {
      labId: "lab-microglia", sourceType: "vendor", sourceName: "Synthetic Vendor", externalReference: `PO-BLOCK-${randomUUID()}`,
      expectedAt: new Date().toISOString().slice(0, 10), healthEvidenceStatus: "missing", protocolAuthorizationId: protocol.id,
      items: [{ expectedIdentifier: sourceIdentifier, strainId: "strain-creer", expectedSex: "female", expectedDob: "2026-08-01" }],
    } });
    const manifestId = resultValue<string>(created, "manifestId");
    const item = await prisma.shipmentManifestItem.findFirstOrThrow({ where: { manifestId } });
    const started = await executeStartShipmentReceiptCommand({ actor: owner, manifestId, expectedVersion: 1, ...identity("blocked-start") });
    const sessionId = resultValue<string>(started, "sessionId");
    await executeRecordShipmentObservationCommand({ actor: owner, sessionId, expectedVersion: 1, ...identity("blocked-observe"), observation: { manifestItemId: item.id, observedIdentifier: sourceIdentifier, outcome: "matched", observedSex: "female", observedDob: "2026-08-01" } });
    const before = await prisma.animal.count();
    expect(await executeConfirmShipmentReceiptCommand({ actor: owner, sessionId, expectedVersion: 2, destinationCageId: "cage-m16-quarantine", receivedAt: new Date().toISOString().slice(0, 10), minimumHoldDays: 14, ...identity("blocked-confirm") })).toMatchObject({ ok: false, code: "health_evidence_block" });
    expect(await prisma.animal.count()).toBe(before);
    expect(await prisma.animal.findFirst({ where: { sourceAnimalId: sourceIdentifier } })).toBeNull();
    expect(await prisma.shipmentReconciliationSummary.findUnique({ where: { sessionId } })).toBeNull();
    expect(await prisma.shipmentReceiptSession.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({ status: "ready_for_confirmation", version: 2 });
  }, 120_000);

  it("rejects an occupied quarantine cage before allocation or colony mutation", async () => {
    const owner = await actor("user-lab-owner-qa", "lab-microglia");
    const veterinarian = await veterinarianActor();
    const protocol = await prisma.protocolAuthorization.findFirstOrThrow({ where: { protocolCode: "QA-ACTIVE-6" } });
    const sourceIdentifier = `SRC-OCCUPIED-${randomUUID()}`;
    const created = await executeCreateShipmentManifestCommand({ actor: owner, ...identity("occupied-create"), command: {
      labId: "lab-microglia", sourceType: "vendor", sourceName: "Synthetic Vendor", externalReference: `PO-OCCUPIED-${randomUUID()}`,
      expectedAt: new Date().toISOString().slice(0, 10), healthEvidenceStatus: "missing", protocolAuthorizationId: protocol.id,
      items: [{ expectedIdentifier: sourceIdentifier, strainId: "strain-creer", expectedSex: "male", expectedDob: "2026-08-01" }],
    } });
    const manifestId = resultValue<string>(created, "manifestId");
    const item = await prisma.shipmentManifestItem.findFirstOrThrow({ where: { manifestId } });
    expect((await executeRecordShipmentHealthEvidenceCommand({ actor: owner, manifestId, expectedVersion: 1, ...identity("occupied-health"), evidence: { evidenceType: "sentinel_panel", testCode: "SYNTHETIC-OCCUPIED", result: "negative", collectedAt: new Date().toISOString().slice(0, 10), issuedAt: new Date().toISOString(), issuer: "Synthetic QA laboratory", operationalSummary: "Synthetic negative evidence for occupied-cage rollback." } })).ok).toBe(true);
    expect((await executeDecideShipmentHealthCompatibilityCommand({ actor: veterinarian, manifestId, expectedVersion: 2, decision: "compatible", reason: "Independent all-negative evidence review.", ...identity("occupied-decision") })).ok).toBe(true);
    const started = await executeStartShipmentReceiptCommand({ actor: owner, manifestId, expectedVersion: 3, ...identity("occupied-start") });
    const sessionId = resultValue<string>(started, "sessionId");
    expect((await executeRecordShipmentObservationCommand({ actor: owner, sessionId, expectedVersion: 1, ...identity("occupied-observe"), observation: { manifestItemId: item.id, observedIdentifier: item.expectedIdentifier, outcome: "matched", observedSex: item.expectedSex, observedDob: item.expectedDob.toISOString().slice(0, 10) } })).ok).toBe(true);
    const commandIdentity = identity("occupied-confirm");
    const before = await Promise.all([
      prisma.protocolCountAllocation.count(), prisma.animal.count(), prisma.quarantineCase.count(),
      prisma.cage.findUniqueOrThrow({ where: { id: "cage-m16-quarantine" }, select: { lastUpdatedAt: true } }),
    ]);
    expect(await executeConfirmShipmentReceiptCommand({ actor: owner, sessionId, expectedVersion: 2, destinationCageId: "cage-m16-quarantine", receivedAt: new Date().toISOString().slice(0, 10), minimumHoldDays: 14, ...commandIdentity })).toMatchObject({ ok: false, code: "quarantine_capacity_block" });
    expect(await Promise.all([prisma.protocolCountAllocation.count(), prisma.animal.count(), prisma.quarantineCase.count(), prisma.cage.findUniqueOrThrow({ where: { id: "cage-m16-quarantine" }, select: { lastUpdatedAt: true } })])).toEqual(before);
    expect(await prisma.animal.findFirst({ where: { sourceAnimalId: sourceIdentifier } })).toBeNull();
    expect(await prisma.shipmentReconciliationSummary.findUnique({ where: { sessionId } })).toBeNull();
    expect(await prisma.shipmentManifest.findUniqueOrThrow({ where: { id: manifestId } })).toMatchObject({ status: "receiving", version: 4, intakeBatchId: null, quarantineCaseId: null });
    expect(await prisma.shipmentReceiptSession.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({ status: "ready_for_confirmation", version: 2 });
    const failedReceipt = await prisma.commandReceipt.findFirstOrThrow({ where: { commandType: "m16.shipment.confirm", idempotencyKey: commandIdentity.idempotencyKey } });
    expect(failedReceipt.status).toBe("failed");
    expect(await prisma.operationalReconciliationEvent.count({ where: { commandReceiptId: failedReceipt.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { commandReceiptId: failedReceipt.id } })).toBe(0);
  }, 120_000);

  it("requires exact immutable clinical evidence in health-decision and quarantine-release events", async () => {
    const owner = await actor("user-lab-owner-qa", "lab-microglia");
    const veterinarian = await veterinarianActor();
    const duty = await prisma.facilityDutyAssignment.findFirstOrThrow({
      where: { userId: veterinarian.id, duty: "designated_veterinarian", revokedAt: null, validFrom: { lte: new Date() }, validUntil: { gt: new Date() } },
      orderBy: { validUntil: "desc" },
    });
    const created = await executeCreateShipmentManifestCommand({ actor: owner, ...identity("clinical-parity-create"), command: {
      labId: "lab-microglia", sourceType: "vendor", sourceName: "Synthetic clinical parity vendor", externalReference: `CLINICAL-${randomUUID()}`,
      expectedAt: new Date().toISOString().slice(0, 10), healthEvidenceStatus: "missing",
      items: [{ expectedIdentifier: `CLINICAL-SRC-${randomUUID()}`, strainId: "strain-creer", expectedSex: "female", expectedDob: "2026-08-01" }],
    } });
    const manifestId = resultValue<string>(created, "manifestId");
    expect((await executeRecordShipmentHealthEvidenceCommand({ actor: owner, manifestId, expectedVersion: 1, ...identity("clinical-parity-evidence"), evidence: {
      evidenceType: "sentinel_panel", testCode: "SYNTHETIC-CLINICAL-PARITY", result: "negative", collectedAt: new Date().toISOString().slice(0, 10),
      issuedAt: new Date().toISOString(), issuer: "Synthetic independent QA laboratory", operationalSummary: "Synthetic negative evidence for clinical event parity testing.",
    } })).ok).toBe(true);
    const manifestBefore = await prisma.shipmentManifest.findUniqueOrThrow({ where: { id: manifestId } });
    const healthEvidence = await prisma.shipmentHealthEvidence.findMany({ where: { manifestId }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }] });
    const latestEvidenceAt = healthEvidence.reduce((latest, row) => row.recordedAt > latest ? row.recordedAt : latest, healthEvidence[0]!.recordedAt);

    const clinicalCageId = `cage-m16-clinical-${randomUUID()}`;
    const quarantineCaseId = `qcase-m16-clinical-${randomUUID()}`;
    const referenceCage = await prisma.cage.findFirstOrThrow({ where: { labId: "lab-microglia" } });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'");
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.cage.create({ data: {
        id: clinicalCageId, facilityCageId: "9996", labId: "lab-microglia", roomId: referenceCage.roomId,
        rackId: referenceCage.rackId, cageNumber: `M16-C-${randomUUID().slice(0, 6)}`, barcode: `M16-C-${randomUUID()}`, status: "quarantine", active: true,
      } });
      await tx.quarantineCase.create({ data: {
        id: quarantineCaseId, labId: "lab-microglia", cageId: clinicalCageId, status: "release_requested",
        admittedAt: new Date(Date.now() - 3 * 86_400_000), minimumReleaseAt: new Date(Date.now() - 2 * 86_400_000),
        admissionReason: "Synthetic clinical parity quarantine case.", admittedById: owner.id,
        releaseRequestedAt: new Date(Date.now() - 86_400_000), releaseRequestedById: owner.id,
        releaseRequestReason: "Synthetic request for exact event parity testing.", version: 2,
      } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });
    const quarantineBefore = await prisma.quarantineCase.findUniqueOrThrow({ where: { id: quarantineCaseId } });

    const createReceipt = async (tx: Prisma.TransactionClient, input: { id: string; commandType: string; aggregateType: string; aggregateId: string; expectedVersion: number }) => {
      const requestHash = `clinical-hash-${randomUUID()}`;
      await tx.commandReceipt.create({ data: {
        id: input.id, actorId: veterinarian.id, actorAuthzVersion: veterinarian.authzVersion, labId: "lab-microglia",
        commandType: input.commandType, idempotencyKey: `clinical-${randomUUID()}`, requestHash,
        requestId: `clinical-request-${randomUUID()}`, status: "processing", aggregateType: input.aggregateType,
        aggregateId: input.aggregateId, expectedVersion: input.expectedVersion,
      } });
      await setM16Context(tx, { receiptId: input.id, actorId: veterinarian.id, commandType: input.commandType });
      await tx.$queryRaw(Prisma.sql`
        SELECT set_config('mcm.audit_receipt_id', ${input.id}, true), set_config('mcm.audit_actor_id', ${veterinarian.id}, true),
          set_config('mcm.audit_command_type', ${input.commandType}, true), set_config('mcm.audit_request_hash', ${requestHash}, true)
      `);
    };

    const healthReceiptIds: string[] = [];
    for (const variant of ["omitted_reference", "mismatched_authenticated_at"] as const) {
      const receiptId = `clinical-health-${variant}-${randomUUID()}`;
      healthReceiptIds.push(receiptId);
      await expect(prisma.$transaction(async (tx) => {
        await createReceipt(tx, { id: receiptId, commandType: "m16.shipment.health_decision", aggregateType: "shipment_manifest", aggregateId: manifestId, expectedVersion: manifestBefore.version });
        const decision = await tx.shipmentHealthDecision.create({ data: {
          id: `clinical-decision-${randomUUID()}`, manifestId, labId: "lab-microglia", decision: "compatible",
          reason: "Synthetic exact clinical evidence parity decision.", evidenceCount: healthEvidence.length, evidenceLatestAt: latestEvidenceAt,
          assessedById: veterinarian.id, assessedByAuthzVersion: veterinarian.authzVersion,
          dutyAssignmentId: duty.id, dutyAssignmentVersion: duty.version, identityLinkId: veterinarian.identityLinkId!,
          authenticatedAt: new Date(veterinarian.authenticatedAt!), assuranceLevel: veterinarian.assurance!, commandReceiptId: receiptId,
        } });
        const healthStatus = await deriveManifestHealthStatus(tx, manifestId);
        const updated = await tx.shipmentManifest.update({ where: { id: manifestId }, data: {
          healthEvidenceStatus: healthStatus, healthEvidenceSummary: "Synthetic exact clinical evidence parity decision.", version: { increment: 1 },
        } });
        const eventActor = variant === "mismatched_authenticated_at"
          ? { ...veterinarian, authenticatedAt: new Date(Date.parse(veterinarian.authenticatedAt!) - 1_000).toISOString() }
          : veterinarian;
        await appendLifecycleEvent(tx, {
          actor: eventActor, receiptId, domain: "shipment", aggregateType: "shipment_manifest", aggregateId: manifestId, labId: "lab-microglia",
          eventType: "health_compatibility_decided", previousStatus: manifestBefore.status, resultingStatus: manifestBefore.status,
          evidence: variant === "omitted_reference" ? { policyMarker: "synthetic-fail-closed-m16" } : { healthDecisionId: decision.id, policyMarker: "synthetic-fail-closed-m16" },
          duty,
        });
        await tx.commandReceipt.update({ where: { id: receiptId }, data: { status: "succeeded", completedAt: new Date(), resultingVersion: updated.version, result: { forged: true } } });
        await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      })).rejects.toThrow(/Health decision event must exactly match immutable clinical decision evidence/i);
    }
    expect(await prisma.shipmentHealthDecision.count({ where: { manifestId } })).toBe(0);
    expect(await prisma.shipmentManifest.findUniqueOrThrow({ where: { id: manifestId } })).toMatchObject({ version: manifestBefore.version, healthEvidenceStatus: manifestBefore.healthEvidenceStatus });
    for (const receiptId of healthReceiptIds) {
      expect(await prisma.commandReceipt.findUnique({ where: { id: receiptId } })).toBeNull();
      expect(await prisma.operationalReconciliationEvent.count({ where: { commandReceiptId: receiptId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { commandReceiptId: receiptId } })).toBe(0);
    }

    const quarantineReceiptIds: string[] = [];
    for (const variant of ["omitted_reference", "mismatched_authenticated_at"] as const) {
      const receiptId = `clinical-quarantine-${variant}-${randomUUID()}`;
      quarantineReceiptIds.push(receiptId);
      await expect(prisma.$transaction(async (tx) => {
        await createReceipt(tx, { id: receiptId, commandType: "m16.quarantine.release", aggregateType: "quarantine_case", aggregateId: quarantineCaseId, expectedVersion: quarantineBefore.version });
        const updated = await tx.quarantineCase.update({ where: { id: quarantineCaseId }, data: {
          status: "released", releasedAt: new Date(), releasedById: veterinarian.id, releaseReason: "Synthetic exact clinical release parity.",
          releaseDutyAssignmentId: duty.id, releaseDutyVersion: duty.version, releaseIdentityLinkId: veterinarian.identityLinkId!,
          releaseAuthenticatedAt: new Date(veterinarian.authenticatedAt!), releaseAuthzVersion: veterinarian.authzVersion,
          releaseAssuranceLevel: veterinarian.assurance!, releaseCommandReceiptId: receiptId, version: { increment: 1 },
        } });
        const eventActor = variant === "mismatched_authenticated_at"
          ? { ...veterinarian, authenticatedAt: new Date(Date.parse(veterinarian.authenticatedAt!) - 1_000).toISOString() }
          : veterinarian;
        await appendLifecycleEvent(tx, {
          actor: eventActor, receiptId, domain: "quarantine", aggregateType: "quarantine_case", aggregateId: quarantineCaseId, labId: "lab-microglia",
          eventType: "veterinary_release", previousStatus: "release_requested", resultingStatus: "released",
          evidence: variant === "omitted_reference" ? { policyMarker: "synthetic-fail-closed-m16" } : { quarantineCaseId, policyMarker: "synthetic-fail-closed-m16" },
          duty,
        });
        await tx.commandReceipt.update({ where: { id: receiptId }, data: { status: "succeeded", completedAt: new Date(), resultingVersion: updated.version, result: { forged: true } } });
        await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      })).rejects.toThrow(/Quarantine release event must exactly match immutable clinical release evidence/i);
    }
    expect(await prisma.quarantineCase.findUniqueOrThrow({ where: { id: quarantineCaseId } })).toMatchObject({ status: "release_requested", version: quarantineBefore.version, releaseCommandReceiptId: null });
    for (const receiptId of quarantineReceiptIds) {
      expect(await prisma.commandReceipt.findUnique({ where: { id: receiptId } })).toBeNull();
      expect(await prisma.operationalReconciliationEvent.count({ where: { commandReceiptId: receiptId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { commandReceiptId: receiptId } })).toBe(0);
    }
  }, 120_000);

  it("requires a current independent Designated Veterinarian with fresh identity for release", async () => {
    const owner = await actor("user-lab-owner-qa", "lab-microglia");
    const veterinarian = await veterinarianActor();
    const quarantineCase = await prisma.quarantineCase.findFirstOrThrow({ where: { intakeBatchId: { not: null }, cageId: "cage-m16-quarantine", status: "admitted" } });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'");
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.quarantineCase.update({ where: { id: quarantineCase.id }, data: { admittedAt: new Date(Date.now() - 3 * 86_400_000), minimumReleaseAt: new Date(Date.now() - 2 * 86_400_000) } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });
    expect((await executeRecordQuarantineObservationCommand({ actor: owner, expectedVersion: 1, ...identity("quarantine-clear"), command: { caseId: quarantineCase.id, observedAt: new Date().toISOString().slice(0, 10), result: "clear", severity: "info", note: "Synthetic structured quarantine review clear.", followupRequired: false } })).ok).toBe(true);
    expect((await executeRequestQuarantineReleaseCommand({ actor: owner, expectedVersion: 2, ...identity("release-request"), command: { caseId: quarantineCase.id, requestedAt: new Date().toISOString().slice(0, 10), reason: "Synthetic quarantine evidence complete." } })).ok).toBe(true);
    const current = await prisma.quarantineCase.findUniqueOrThrow({ where: { id: quarantineCase.id } });
    const animal = await prisma.animal.findFirstOrThrow({ where: { intakeBatchId: quarantineCase.intakeBatchId! } });
    const command = { caseId: quarantineCase.id, releasedAt: new Date().toISOString().slice(0, 10), reason: "Synthetic veterinarian release after evidence review.", assignments: [{ animalId: animal.id, toCageId: "cage-m16-release" }] };
    const staleVeterinarian = { ...veterinarian, authenticatedAt: new Date(Date.now() - 20 * 60_000).toISOString() };
    const staleReal = await executeFinalizeQuarantineReleaseCommand({ actor: staleVeterinarian, command, expectedVersion: current.version, workflowDraftId: `stale-real-${randomUUID()}`, reviewSnapshotId: randomUUID(), ...identity("stale-vet-real") });
    const staleUnknown = await executeFinalizeQuarantineReleaseCommand({ actor: staleVeterinarian, command: { ...command, caseId: `unknown-${randomUUID()}` }, expectedVersion: current.version, workflowDraftId: `stale-unknown-${randomUUID()}`, reviewSnapshotId: randomUUID(), ...identity("stale-vet-unknown") });
    expect(staleReal).toMatchObject({ ok: false, code: "clinical_duty_required" });
    expect(staleUnknown).toMatchObject({ ok: false, code: "clinical_duty_required" });

    const manifest = await prisma.shipmentManifest.findUniqueOrThrow({ where: { intakeBatchId: quarantineCase.intakeBatchId! } });
    const setHealthStatus = async (healthEvidenceStatus: "missing" | "positive" | "incompatible" | "compatible") => prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'");
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.shipmentManifest.update({ where: { id: manifest.id }, data: { healthEvidenceStatus } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });
    const attemptRelease = async (prefix: string) => {
      const draftId = `${prefix}-${randomUUID()}`;
      const prepared = await prepareWorkflowReview({ actor: veterinarian, draftId, workflowType: "quarantine.release", requiredCapability: "quarantine:release", labId: current.labId, authorizationLabId: null, payload: { command, expectedVersion: current.version } });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error("Release review was not prepared");
      return executeFinalizeQuarantineReleaseCommand({ actor: veterinarian, command, expectedVersion: current.version, workflowDraftId: draftId, reviewSnapshotId: prepared.snapshot.id, ...identity(prefix) });
    };
    for (const status of ["missing", "positive", "incompatible"] as const) {
      await setHealthStatus(status);
      expect(await attemptRelease(`blocked-${status}`)).toMatchObject({ ok: false, code: "health_evidence_block" });
      expect(await prisma.quarantineCase.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({ status: "release_requested", version: current.version });
      expect(await prisma.animal.findUniqueOrThrow({ where: { id: animal.id } })).toMatchObject({ currentCageId: "cage-m16-quarantine" });
    }
    await setHealthStatus("compatible");

    const capacityOccupant = await prisma.animal.findFirstOrThrow({ where: { id: { not: animal.id }, outcomeStatus: "alive" }, select: { id: true, currentCageId: true } });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'");
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.animal.update({ where: { id: capacityOccupant.id }, data: { currentCageId: "cage-m16-release" } });
      await tx.cage.update({ where: { id: "cage-m16-release" }, data: { capacityOverride: 1 } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });
    expect(await attemptRelease("blocked-capacity")).toMatchObject({ ok: false, code: "capacity_exceeded" });
    expect(await prisma.quarantineCase.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({ status: "release_requested", version: current.version });
    expect(await prisma.animal.findUniqueOrThrow({ where: { id: animal.id } })).toMatchObject({ currentCageId: "cage-m16-quarantine" });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'");
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.animal.update({ where: { id: capacityOccupant.id }, data: { currentCageId: capacityOccupant.currentCageId } });
      await tx.cage.update({ where: { id: "cage-m16-release" }, data: { capacityOverride: null } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });

    const workflowDraftId = `release-review-${randomUUID()}`;
    const review = await prepareWorkflowReview({ actor: veterinarian, draftId: workflowDraftId, workflowType: "quarantine.release", requiredCapability: "quarantine:release", labId: current.labId, authorizationLabId: null, payload: { command, expectedVersion: current.version } });
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    const released = await executeFinalizeQuarantineReleaseCommand({ actor: veterinarian, command, expectedVersion: current.version, workflowDraftId, reviewSnapshotId: review.snapshot.id, ...identity("vet-release") });
    expect(released.ok).toBe(true);
    const saved = await prisma.quarantineCase.findUniqueOrThrow({ where: { id: current.id } });
    expect(saved).toMatchObject({ status: "released", releasedById: veterinarian.id, releaseAuthzVersion: veterinarian.authzVersion });
    expect(saved.releaseDutyAssignmentId).toBeTruthy();
    expect(saved.releaseIdentityLinkId).toBe(veterinarian.identityLinkId);
    const event = await prisma.operationalReconciliationEvent.findFirstOrThrow({ where: { aggregateId: current.id, eventType: "veterinary_release" } });
    expect(event.dutyAssignmentId).toBe(saved.releaseDutyAssignmentId);
    expect(await prisma.auditLog.count({ where: { commandReceiptId: event.commandReceiptId } })).toBe(1);
    const assignment = await prisma.facilityDutyAssignment.findUniqueOrThrow({ where: { id: saved.releaseDutyAssignmentId! } });
    const requester = await facilityAdminGovernanceActor("user-facility-admin-qa");
    const revoke = await requestFacilityDutyRevoke({ assignmentId: assignment.id, assignmentVersion: assignment.version, reason: "Approved revocation after retained synthetic veterinary evidence." }, requester);
    expect(revoke.ok).toBe(true);
    if (!revoke.ok) return;
    const decider = await facilityAdminGovernanceActor("user-facility-admin-approver-qa");
    expect((await decideFacilityDutyRequest({ requestId: revoke.entityId, expectedVersion: 1, decision: "approve" }, decider)).ok).toBe(true);
    const revoked = await prisma.facilityDutyAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(revoked).toMatchObject({ version: assignment.version + 1, revokedAt: expect.any(Date) });
    expect(await prisma.quarantineCase.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({ releaseDutyAssignmentId: assignment.id, releaseDutyVersion: assignment.version });
    expect(await prisma.operationalReconciliationEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ dutyAssignmentId: assignment.id, dutyAssignmentVersion: assignment.version });
  }, 120_000);

  it("rejects a same-receipt shipment summary associated to the wrong manifest", async () => {
    const owner = await actor("user-lab-owner-qa", "lab-microglia");
    const savedSummary = await prisma.shipmentReconciliationSummary.findFirstOrThrow();
    const wrongSession = await prisma.shipmentReceiptSession.findFirstOrThrow({ where: { id: { not: savedSummary.sessionId } } });
    const receiptId = `wrong-summary-parent-${randomUUID()}`;
    const beforeCount = await prisma.shipmentReconciliationSummary.count();
    await expect(prisma.$transaction(async (tx) => {
      await tx.commandReceipt.create({ data: {
        id: receiptId, actorId: owner.id, actorAuthzVersion: owner.authzVersion, labId: "lab-microglia",
        commandType: "m16.shipment.confirm", idempotencyKey: `wrong-summary-${randomUUID()}`,
        requestHash: `wrong-summary-hash-${randomUUID()}`, requestId: `wrong-summary-request-${randomUUID()}`,
        status: "processing", aggregateType: "shipment_receipt_session", aggregateId: wrongSession.id, expectedVersion: wrongSession.version,
      } });
      await setM16Context(tx, { receiptId, actorId: owner.id, commandType: "m16.shipment.confirm" });
      await tx.shipmentReconciliationSummary.create({ data: {
        id: `wrong-summary-${randomUUID()}`, sessionId: wrongSession.id, manifestId: savedSummary.manifestId, labId: "lab-microglia",
        expectedCount: 0, acceptedCount: 0, exceptionCount: 0, missingCount: 0, result: "exception_only",
        summary: { syntheticWrongParent: true }, finalizedById: owner.id, finalizedAt: new Date(), commandReceiptId: receiptId,
      } });
    })).rejects.toThrow(/summary session, manifest, and lab must be the exact same receipt/i);
    expect(await prisma.shipmentReconciliationSummary.count()).toBe(beforeCount);
    expect(await prisma.commandReceipt.findUnique({ where: { id: receiptId } })).toBeNull();
  }, 120_000);

  it("rejects the receipt observation association matrix: wrong session/manifest, item, and lab", async () => {
    const owner = await actor("user-lab-owner-qa", "lab-microglia");
    const sessions = await prisma.shipmentReceiptSession.findMany({ include: { manifest: { include: { items: true } } }, orderBy: { startedAt: "asc" } });
    const sessionA = sessions.find((session) => session.manifest.items.length > 0 && sessions.some((candidate) => candidate.manifestId !== session.manifestId));
    const sessionB = sessionA && sessions.find((session) => session.manifestId !== sessionA.manifestId && session.manifest.items.length > 0);
    expect(sessionA).toBeTruthy();
    expect(sessionB).toBeTruthy();
    const itemA = sessionA!.manifest.items[0]!;
    const itemB = sessionB!.manifest.items[0]!;
    const beforeCount = await prisma.shipmentReceiptObservation.count();
    const cases = [
      { name: "wrong session/manifest", manifestId: sessionB!.manifestId, itemId: itemB.id, labId: "lab-microglia", pattern: /session, manifest, and lab must be the exact same parent/i },
      { name: "wrong manifest item", manifestId: sessionA!.manifestId, itemId: itemB.id, labId: "lab-microglia", pattern: /item must belong to the exact manifest and lab/i },
      { name: "cross-lab observation", manifestId: sessionA!.manifestId, itemId: itemA.id, labId: "lab-neuroimmune", pattern: /session, manifest, and lab must be the exact same parent/i },
    ] as const;
    for (const associationCase of cases) {
      const receiptId = `wrong-observation-parent-${randomUUID()}`;
      await expect(prisma.$transaction(async (tx) => {
        await tx.commandReceipt.create({ data: {
          id: receiptId, actorId: owner.id, actorAuthzVersion: owner.authzVersion, labId: "lab-microglia", commandType: "m16.shipment.observe",
          idempotencyKey: `wrong-observation-${randomUUID()}`, requestHash: `wrong-observation-hash-${randomUUID()}`,
          requestId: `wrong-observation-request-${randomUUID()}`, status: "processing", aggregateType: "shipment_receipt_session", aggregateId: sessionA!.id,
        } });
        await setM16Context(tx, { receiptId, actorId: owner.id, commandType: "m16.shipment.observe" });
        await tx.shipmentReceiptObservation.create({ data: {
          id: `wrong-observation-${randomUUID()}`, sessionId: sessionA!.id, manifestId: associationCase.manifestId,
          manifestItemId: associationCase.itemId, labId: associationCase.labId, observedIdentifier: `WRONG-${randomUUID()}`,
          outcome: "matched", observedById: owner.id, commandReceiptId: receiptId,
        } });
      })).rejects.toThrow(associationCase.pattern);
      expect(await prisma.commandReceipt.findUnique({ where: { id: receiptId } })).toBeNull();
    }
    expect(await prisma.shipmentReceiptObservation.count()).toBe(beforeCount);
  }, 120_000);

  it("rolls back shipment lineage matrix failures: wrong intake, wrong quarantine, cross-lab, and null omission", async () => {
    const owner = await actor("user-lab-owner-qa", "lab-microglia");
    const [microCage, neuroCage] = await Promise.all([
      prisma.cage.findFirstOrThrow({ where: { labId: "lab-microglia" } }),
      prisma.cage.findFirstOrThrow({ where: { labId: "lab-neuroimmune" } }),
    ]);
    const variants = ["same_lab_wrong_intake", "same_lab_wrong_quarantine", "cross_lab_lineage", "null_omission"] as const;
    for (const variant of variants) {
      const receiptId = `shipment-lineage-${variant}-${randomUUID()}`;
      const manifestId = `shipment-lineage-manifest-${randomUUID()}`;
      const sessionId = `shipment-lineage-session-${randomUUID()}`;
      await expect(prisma.$transaction(async (tx) => {
        const requestHash = `shipment-lineage-hash-${randomUUID()}`;
        await tx.commandReceipt.create({ data: {
          id: receiptId, actorId: owner.id, actorAuthzVersion: owner.authzVersion, labId: "lab-microglia", commandType: "m16.shipment.confirm",
          idempotencyKey: `shipment-lineage-${randomUUID()}`, requestHash, requestId: `shipment-lineage-request-${randomUUID()}`,
          status: "processing", aggregateType: "shipment_receipt_session", aggregateId: sessionId, expectedVersion: 1,
        } });
        await setM16Context(tx, { receiptId, actorId: owner.id, commandType: "m16.shipment.confirm" });
        await tx.$queryRaw(Prisma.sql`
          SELECT set_config('mcm.audit_receipt_id', ${receiptId}, true), set_config('mcm.audit_actor_id', ${owner.id}, true),
            set_config('mcm.audit_command_type', 'm16.shipment.confirm', true), set_config('mcm.audit_request_hash', ${requestHash}, true)
        `);
        await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'");
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        const createPair = async (labId: "lab-microglia" | "lab-neuroimmune", referenceCage: typeof microCage, prefix: string) => {
          const batchId = `shipment-lineage-batch-${prefix}-${randomUUID()}`;
          const cageId = `shipment-lineage-cage-${prefix}-${randomUUID()}`;
          const quarantineCaseId = `shipment-lineage-case-${prefix}-${randomUUID()}`;
          await tx.animalIntakeBatch.create({ data: { id: batchId, labId, vendor: "Synthetic lineage vendor", orderReference: `LINEAGE-${randomUUID()}`, arrivalDate: new Date(), disposition: "quarantine", createdById: owner.id } });
          const facilityCageId = prefix === "a" ? "9981" : prefix === "b" ? "9982" : "9983";
          await tx.cage.create({ data: { id: cageId, facilityCageId, labId, roomId: referenceCage.roomId, rackId: referenceCage.rackId, cageNumber: `M16-L-${randomUUID().slice(0, 6)}`, barcode: `M16-LINEAGE-${randomUUID()}`, status: "quarantine", active: true } });
          await tx.quarantineCase.create({ data: { id: quarantineCaseId, labId, cageId, intakeBatchId: batchId, admittedAt: new Date(), minimumReleaseAt: new Date(Date.now() + 86_400_000), admissionReason: "Synthetic exact shipment lineage.", admittedById: owner.id } });
          return { batchId, quarantineCaseId };
        };
        const pairA = await createPair("lab-microglia", microCage, "a");
        const pairB = await createPair("lab-microglia", microCage, "b");
        const crossPair = await createPair("lab-neuroimmune", neuroCage, "cross");
        const manifestPair = variant === "cross_lab_lineage" ? crossPair : pairA;
        const summaryPair = variant === "same_lab_wrong_intake" ? pairB
          : variant === "same_lab_wrong_quarantine" ? { batchId: pairA.batchId, quarantineCaseId: pairB.quarantineCaseId }
            : variant === "cross_lab_lineage" ? crossPair
              : { batchId: null, quarantineCaseId: null };
        await tx.shipmentManifest.create({ data: {
          id: manifestId, labId: "lab-microglia", sourceType: "vendor", sourceName: "Synthetic lineage vendor", externalReference: `LINEAGE-${randomUUID()}`,
          expectedAt: new Date(), healthEvidenceStatus: "compatible", healthEvidenceSummary: "Synthetic compatible evidence.", status: "received",
          intakeBatchId: manifestPair.batchId, quarantineCaseId: manifestPair.quarantineCaseId, createdById: owner.id, version: 2,
        } });
        await tx.shipmentReceiptSession.create({ data: { id: sessionId, manifestId, labId: "lab-microglia", status: "finalized", startedById: owner.id, finalizedById: owner.id, finalizedAt: new Date(), version: 2 } });
        await tx.shipmentReconciliationSummary.create({ data: {
          id: `shipment-lineage-summary-${randomUUID()}`, sessionId, manifestId, labId: "lab-microglia", expectedCount: 1, acceptedCount: 1,
          exceptionCount: 0, missingCount: 0, affectedIntakeBatchId: summaryPair.batchId, affectedQuarantineCaseId: summaryPair.quarantineCaseId,
          result: "received", summary: { variant }, finalizedById: owner.id, finalizedAt: new Date(), commandReceiptId: receiptId,
        } });
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
        await appendLifecycleEvent(tx, { actor: owner, receiptId, domain: "shipment", aggregateType: "shipment_receipt_session", aggregateId: sessionId, labId: "lab-microglia", eventType: "receipt_confirmed", previousStatus: "ready_for_confirmation", resultingStatus: "finalized", evidence: { variant } });
        await tx.commandReceipt.update({ where: { id: receiptId }, data: { status: "succeeded", completedAt: new Date(), resultingVersion: 2, result: { forged: true } } });
        await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      })).rejects.toThrow(/exact manifest, receipt summary, intake batch, quarantine case, and lab lineage/i);
      expect(await prisma.commandReceipt.findUnique({ where: { id: receiptId } })).toBeNull();
      expect(await prisma.shipmentManifest.findUnique({ where: { id: manifestId } })).toBeNull();
      expect(await prisma.shipmentReceiptSession.findUnique({ where: { id: sessionId } })).toBeNull();
      expect(await prisma.operationalReconciliationEvent.count({ where: { commandReceiptId: receiptId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { commandReceiptId: receiptId } })).toBe(0);
    }
  }, 120_000);

  it("database-guards direct evidence writes and requires exact event/audit parity", async () => {
    await expect(prisma.shipmentManifest.create({ data: { id: `direct-${randomUUID()}`, labId: "lab-microglia", sourceType: "vendor", sourceName: "Direct", externalReference: randomUUID(), expectedAt: new Date(), createdById: "user-lab-owner-qa" } })).rejects.toThrow(/exact processing command receipt/i);
    const [manifest, health, healthDecision, observation, summary, releasedCase] = await Promise.all([
      prisma.shipmentManifest.findFirstOrThrow({ where: { status: "received" } }),
      prisma.shipmentHealthEvidence.findFirstOrThrow(),
      prisma.shipmentHealthDecision.findFirstOrThrow(),
      prisma.shipmentReceiptObservation.findFirstOrThrow(),
      prisma.shipmentReconciliationSummary.findFirstOrThrow(),
      prisma.quarantineCase.findFirstOrThrow({ where: { releaseCommandReceiptId: { not: null } } }),
    ]);
    await expect(prisma.shipmentManifest.update({ where: { id: manifest.id }, data: { version: { increment: 1 } } })).rejects.toThrow(/exact processing command receipt/i);
    await expect(prisma.shipmentHealthEvidence.update({ where: { id: health.id }, data: { operationalSummary: "Forbidden evidence rewrite." } })).rejects.toThrow(/append-only/i);
    await expect(prisma.shipmentHealthEvidence.delete({ where: { id: health.id } })).rejects.toThrow(/append-only/i);
    await expect(prisma.shipmentHealthDecision.update({ where: { id: healthDecision.id }, data: { reason: "Forbidden decision rewrite." } })).rejects.toThrow(/append-only/i);
    await expect(prisma.shipmentReceiptObservation.update({ where: { id: observation.id }, data: { operationalCondition: "Forbidden observation rewrite." } })).rejects.toThrow(/append-only/i);
    await expect(prisma.shipmentReconciliationSummary.delete({ where: { id: summary.id } })).rejects.toThrow(/append-only/i);
    await expect(prisma.$executeRawUnsafe("TRUNCATE TABLE \"ShipmentHealthEvidence\" CASCADE")).rejects.toThrow(/cannot truncate|cannot be truncated/i);
    await expect(prisma.quarantineCase.update({ where: { id: releasedCase.id }, data: { releaseReason: "Forbidden same-status release evidence rewrite." } })).rejects.toThrow(/sealed/i);
    await expect(prisma.quarantineCase.delete({ where: { id: releasedCase.id } })).rejects.toThrow(/retained/i);
    await expect(prisma.$executeRawUnsafe("TRUNCATE TABLE \"QuarantineCase\" CASCADE")).rejects.toThrow(/cannot truncate|cannot be truncated/i);
    const successful = await prisma.commandReceipt.findFirstOrThrow({ where: { commandType: "m16.shipment.create", status: "succeeded" } });
    expect(await prisma.operationalReconciliationEvent.count({ where: { commandReceiptId: successful.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { commandReceiptId: successful.id } })).toBe(1);
  });
});
