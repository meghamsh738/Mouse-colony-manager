import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getActorCapabilities } from "@/lib/capabilities";
import { executeDecideCorrectionRequest, executeSubmitCorrectionRequest } from "@/lib/correction-write";
import { evaluateCorrectionProposal, loadCorrectionTarget } from "@/lib/correction-target";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";
import { installCorrectionDatabaseFixture } from "./correction-test-fixture";

let cleanupCorrectionFixture: (() => Promise<void>) | undefined;
beforeAll(async () => {
  cleanupCorrectionFixture = await installCorrectionDatabaseFixture();
}, 120_000);
afterAll(async () => {
  await cleanupCorrectionFixture?.();
  await prisma.$disconnect();
}, 120_000);

function identity(prefix: string) {
  return { idempotencyKey: `${prefix}-${randomUUID()}`, requestId: `request-${randomUUID()}` };
}

async function actor(userId: string, activeLabId: string | null, duties: ResolvedActor["activeDuties"]): Promise<ResolvedActor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const identityLink = await prisma.externalIdentityLink.findFirstOrThrow({ where: { userId, active: true } });
  const canonicalRole = user.role === "facility_admin" ? "facility_admin" as const : "lab_user" as const;
  const membership = activeLabId ? await prisma.labMembership.findFirstOrThrow({ where: { userId, labId: activeLabId, active: true }, include: { lab: true } }) : null;
  const activeMembership = membership ? { labId: membership.labId, labName: membership.lab.name, labCode: membership.lab.code, role: membership.role } : null;
  return { id: user.id, email: user.email, name: user.name, databaseRole: user.role, role: canonicalRole === "facility_admin" ? "admin" : "animal_staff", canonicalRole,
    authzVersion: user.authzVersion, authMethod: "synthetic_mfa", assurance: "synthetic_mfa", authenticatedAt: new Date().toISOString(), identityLinkId: identityLink.id,
    activeDuties: duties, activeLabId, activeMembership, memberships: activeMembership ? [activeMembership] : [], capabilities: [...getActorCapabilities({ canonicalRole, activeMembership, activeDuties: duties })] };
}

async function setReceiptContext(tx: Prisma.TransactionClient, receipt: { id: string; actorId: string; commandType: string; requestHash: string }) {
  await tx.$queryRaw(Prisma.sql`SELECT
    set_config('mcm.audit_receipt_id', ${receipt.id}, true),
    set_config('mcm.audit_actor_id', ${receipt.actorId}, true),
    set_config('mcm.audit_command_type', ${receipt.commandType}, true),
    set_config('mcm.audit_request_hash', ${receipt.requestHash}, true)`);
}

async function rawReceipt<T>(input: { actor: ResolvedActor; correctionId: string; labId: string; commandType: string; body: (tx: Prisma.TransactionClient, receiptId: string) => Promise<T> }) {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.commandReceipt.create({ data: {
      id: `correction-raw-${randomUUID()}`, actorId: input.actor.id, actorAuthzVersion: input.actor.authzVersion,
      labId: input.labId, commandType: input.commandType, idempotencyKey: `raw-${randomUUID()}`,
      requestHash: `raw-hash-${randomUUID()}`, requestId: `raw-request-${randomUUID()}`, status: "processing",
      aggregateType: "correction_request", aggregateId: input.correctionId, startedAt: new Date(),
    } });
    await setReceiptContext(tx, receipt);
    const result = await input.body(tx, receipt.id);
    await tx.commandReceipt.update({ where: { id: receipt.id }, data: { status: "succeeded", completedAt: new Date() } });
    return result;
  });
}

describe.sequential("M15 correction fail-closed database contract", () => {
  it("rolls back a late transactional failure without leaving correction objects behind", async () => {
    const probe = `m15_correction_rollback_${randomUUID().replaceAll("-", "")}`;
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE "${probe}" (id integer PRIMARY KEY)`);
      await tx.$executeRawUnsafe("SELECT 1 / 0");
    })).rejects.toThrow();
    const afterFailure = await prisma.$queryRaw<Array<{ present: boolean }>>(Prisma.sql`
      SELECT to_regclass(current_schema() || '.' || ${probe}) IS NOT NULL AS present
    `);
    expect(afterFailure[0]?.present).toBe(false);
  });

  it("authorizes the supplied lab before target lookup and returns no foreign record existence signal", async () => {
    const requester = await actor("user-lab-manager-qa", "lab-microglia", []);
    const [animal, project] = await Promise.all([
      prisma.animal.findFirstOrThrow({ where: { owningLabId: "lab-neuroimmune" }, select: { id: true } }),
      prisma.project.findFirstOrThrow({ where: { labId: "lab-neuroimmune" }, select: { id: true } }),
    ]);
    const sample = await prisma.sampleRecord.create({ data: { id: `foreign-sample-${randomUUID()}`, labId: "lab-neuroimmune", animalId: animal.id, projectId: project.id, sampleLabel: `FOREIGN-${randomUUID()}`, sampleType: "Synthetic", status: "stored", collectedAt: new Date(), notes: "Foreign lab authorization probe." } });
    const base = { actor: requester, labId: sample.labId, domain: "biosample" as const, sourceEventAt: sample.collectedAt, reason: "Foreign lab correction must be denied before lookup.", proposedCorrection: { notes: "Denied" } };
    const existing = await executeSubmitCorrectionRequest({ actor: requester, ...identity("foreign-existing"), command: { ...base, targetEntityId: sample.id } });
    const missing = await executeSubmitCorrectionRequest({ actor: requester, ...identity("foreign-missing"), command: { ...base, targetEntityId: "missing-sample" } });
    expect(existing).toMatchObject({ ok: false, code: "forbidden" });
    expect(missing).toMatchObject({ ok: false, code: "forbidden" });
    expect(existing.message).toBe(missing.message);
  });

  it("requires fresh steward identity before direct-ID lookup and discloses no request existence signal", async () => {
    const current = await actor("user-facility-admin-approver-qa", null, ["training_administrator", "data_steward"]);
    const stale = { ...current, authenticatedAt: new Date(Date.now() - 11 * 60_000).toISOString() };
    const existing = await prisma.correctionRequest.findFirstOrThrow({ select: { id: true } });
    const base = { actor: stale, expectedVersion: 1, decision: "reject" as const, decisionReason: "Synthetic stale identity probe must fail closed." };
    const existingResult = await executeDecideCorrectionRequest({ ...base, correctionId: existing.id, ...identity("stale-existing") });
    const missingResult = await executeDecideCorrectionRequest({ ...base, correctionId: "missing-correction-request", ...identity("stale-missing") });
    expect(existingResult).toMatchObject({ ok: false, code: "steward_identity_required" });
    expect(missingResult).toMatchObject({ ok: false, code: "steward_identity_required" });
    expect(existingResult.message).toBe(missingResult.message);
  });

  it("rejects approval if source evidence changed after the request", async () => {
    const requester = await actor("user-lab-manager-qa", "lab-microglia", []);
    const steward = await actor("user-facility-admin-approver-qa", null, ["training_administrator", "data_steward"]);
    const sample = await prisma.sampleRecord.findUniqueOrThrow({ where: { id: "sample-002" } });
    const submitted = await executeSubmitCorrectionRequest({
      actor: requester,
      ...identity("stale-source-submit"),
      command: {
        labId: sample.labId,
        domain: "biosample",
        targetEntityId: sample.id,
        sourceEventAt: sample.collectedAt,
        reason: "Synthetic stale source evidence probe.",
        proposedCorrection: { notes: "Proposed metadata correction." },
      },
    });
    if (!submitted.ok || !submitted.result || typeof submitted.result !== "object") throw new Error("Correction request was not recorded.");
    const correctionId = String((submitted.result as { correctionId: unknown }).correctionId);
    await prisma.sampleRecord.update({ where: { id: sample.id }, data: { notes: "Concurrent synthetic source edit.", version: { increment: 1 } } });
    const decided = await executeDecideCorrectionRequest({
      actor: steward,
      correctionId,
      expectedVersion: 1,
      decision: "approve",
      decisionReason: "Approval must reject stale source evidence.",
      ...identity("stale-source-approve"),
    });
    expect(decided).toMatchObject({ ok: false, code: "stale_conflict" });
    expect(await prisma.correctionSupersession.findUnique({ where: { requestId: correctionId } })).toBeNull();
    expect(await prisma.correctionReconciliation.findUnique({ where: { requestId: correctionId } })).toBeNull();
    expect(await prisma.correctionRequest.findUniqueOrThrow({ where: { id: correctionId } })).toMatchObject({ status: "pending", version: 1 });
  });

  it("rejects direct, wrong-command, and missing lifecycle/audit receipt writes atomically", async () => {
    const requester = await actor("user-lab-manager-qa", "lab-microglia", []);
    const target = await loadCorrectionTarget(prisma as unknown as Prisma.TransactionClient, "biosample", "sample-002", "lab-microglia");
    expect(target).not.toBeNull();
    const baseData = (id: string, receiptId: string) => ({
      id, labId: "lab-microglia", domain: "biosample" as const, targetEntityType: "biosample", targetEntityId: "sample-002", targetVersion: target!.targetVersion,
      sourceEventAt: target!.sourceEventAt, reason: "Synthetic direct-write safety probe.", originalSnapshot: target!.originalSnapshot,
      proposedCorrection: { notes: "Synthetic direct-write note." }, status: "pending" as const, policyMarker: "synthetic-controlled-metadata-supersession-v1",
      requestedById: requester.id, requesterAuthzVersion: requester.authzVersion, requesterAssurance: "synthetic_mfa" as const,
      requesterIdentityLinkId: requester.identityLinkId, requesterAuthenticatedAt: new Date(requester.authenticatedAt!), requestCommandReceiptId: receiptId,
    });
    await expect(prisma.correctionRequest.create({ data: baseData(`direct-${randomUUID()}`, randomUUID()) })).rejects.toThrow();

    const wrongId = `wrong-${randomUUID()}`;
    await expect(rawReceipt({ actor: requester, correctionId: wrongId, labId: "lab-microglia", commandType: "corrections.request.reject", body: (tx, receiptId) => tx.correctionRequest.create({ data: baseData(wrongId, receiptId) }) })).rejects.toThrow(/receipt or requester evidence is mismatched/i);

    const foreignId = `foreign-direct-${randomUUID()}`;
    await expect(rawReceipt({ actor: requester, correctionId: foreignId, labId: "lab-neuroimmune", commandType: "corrections.request.submit", body: (tx, receiptId) => tx.correctionRequest.create({ data: { ...baseData(foreignId, receiptId), labId: "lab-neuroimmune" } }) })).rejects.toThrow(/receipt or requester evidence is mismatched/i);
    expect(await prisma.correctionRequest.findUnique({ where: { id: foreignId } })).toBeNull();

    const missingPairId = `missing-pair-${randomUUID()}`;
    await expect(rawReceipt({ actor: requester, correctionId: missingPairId, labId: "lab-microglia", commandType: "corrections.request.submit", body: (tx, receiptId) => tx.correctionRequest.create({ data: baseData(missingPairId, receiptId) }) })).rejects.toThrow(/exact same-receipt lifecycle, audit/i);
    expect(await prisma.correctionRequest.findUnique({ where: { id: missingPairId } })).toBeNull();
  });

  it("keeps blocked requests unapplied at both application and database layers", async () => {
    const requester = await actor("user-lab-manager-qa", "lab-microglia", []);
    const steward = await actor("user-facility-admin-approver-qa", null, ["training_administrator", "data_steward"]);
    const litter = await prisma.litter.findUniqueOrThrow({ where: { id: "litter-001" } });
    const submitted = await executeSubmitCorrectionRequest({ actor: requester, ...identity("blocked-submit"), command: { labId: "lab-microglia", domain: "litter_weaning", targetEntityId: litter.id, sourceEventAt: litter.birthDate, reason: "Synthetic blocked structural correction probe.", proposedCorrection: { litterSizeWean: 7 } } });
    if (!submitted.ok || !submitted.result || typeof submitted.result !== "object") throw new Error("Blocked request was not recorded.");
    const correctionId = String((submitted.result as { correctionId: unknown }).correctionId);
    const blocked = await prisma.correctionRequest.findUniqueOrThrow({ where: { id: correctionId } });
    expect(await executeDecideCorrectionRequest({ actor: steward, correctionId, expectedVersion: 1, decision: "approve", decisionReason: "Unsafe apply probe must fail closed.", ...identity("blocked-apply") })).toMatchObject({ ok: false, code: "invalid_state" });
    const duty = await prisma.facilityDutyAssignment.findFirstOrThrow({ where: { userId: steward.id, duty: "data_steward", revokedAt: null } });
    await expect(rawReceipt({ actor: steward, correctionId, labId: blocked.labId, commandType: "corrections.request.apply", body: async (tx, receiptId) => {
      await tx.correctionRequest.update({ where: { id: correctionId }, data: { status: "applied", decidedById: steward.id, deciderAuthzVersion: steward.authzVersion, deciderAssurance: "synthetic_mfa", deciderDutyAssignmentId: duty.id, deciderDutyAssignmentVersion: duty.version, deciderIdentityLinkId: steward.identityLinkId, deciderAuthenticatedAt: new Date(steward.authenticatedAt!), decisionCommandReceiptId: receiptId, decisionReason: "Raw unsafe apply must fail.", decidedAt: new Date(), version: { increment: 1 } } });
      return true;
    } })).rejects.toThrow(/invalid correction request transition/i);
    expect(await prisma.correctionRequest.findUniqueOrThrow({ where: { id: correctionId } })).toMatchObject({ status: "blocked", version: 1 });
  });

  it("rejects mutation, deletion, and truncation of immutable correction evidence", async () => {
    const supersession = await prisma.correctionSupersession.findFirstOrThrow();
    const event = await prisma.correctionLifecycleEvent.findFirstOrThrow();
    const reconciliation = await prisma.correctionReconciliation.findFirstOrThrow();
    await expect(prisma.correctionSupersession.update({ where: { id: supersession.id }, data: { effectiveProjection: { forged: true } } })).rejects.toThrow(/immutable/i);
    await expect(prisma.correctionLifecycleEvent.delete({ where: { id: event.id } })).rejects.toThrow(/immutable/i);
    await expect(prisma.correctionReconciliation.delete({ where: { id: reconciliation.id } })).rejects.toThrow(/immutable/i);
    await expect(prisma.animalMovement.update({ where: { id: "move-001" }, data: { reason: "Attempted source evidence rewrite." } })).rejects.toThrow(/immutable operational history/i);
    for (const table of ["CorrectionRequest", "CorrectionLifecycleEvent", "CorrectionSupersession", "CorrectionReconciliation"]) {
      const failClosedPattern = table === "CorrectionRequest"
        ? /cannot truncate a table referenced in a foreign key constraint|cannot be truncated/i
        : /cannot be truncated/i;
      await expect(prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}"`)).rejects.toThrow(failClosedPattern);
    }
  });

  it("enforces reverse pairing, decision snapshots, audit actor equality, and full rollback", async () => {
    const requester = await actor("user-lab-manager-qa", "lab-microglia", []);
    const steward = await actor("user-facility-admin-approver-qa", null, ["training_administrator", "data_steward"]);
    const sample = await prisma.sampleRecord.findFirstOrThrow({ where: { labId: "lab-microglia", id: { not: "sample-002" } } });
    const submitted = await executeSubmitCorrectionRequest({ actor: requester, ...identity("reverse-pair-submit"), command: {
      labId: sample.labId, domain: "biosample", targetEntityId: sample.id, sourceEventAt: sample.collectedAt,
      reason: "Synthetic reverse-pairing and evidence-binding probe.", proposedCorrection: { notes: "Corrected reverse-pair probe note." },
    } });
    if (!submitted.ok || !submitted.result || typeof submitted.result !== "object" || Array.isArray(submitted.result)) throw new Error("Correction request was not recorded.");
    const correctionId = String((submitted.result as { correctionId: unknown }).correctionId);
    const correction = await prisma.correctionRequest.findUniqueOrThrow({ where: { id: correctionId } });

    await expect(rawReceipt({ actor: requester, correctionId, labId: correction.labId, commandType: "corrections.request.submit", body: (tx, receiptId) => tx.correctionLifecycleEvent.create({ data: {
      id: `standalone-event-${randomUUID()}`, requestId: correctionId, labId: correction.labId, eventType: "requested", fromStatus: null, toStatus: "pending",
      actorId: requester.id, actorAuthzVersion: requester.authzVersion, assurance: "synthetic_mfa", identityLinkId: requester.identityLinkId,
      authenticatedAt: new Date(requester.authenticatedAt!), commandReceiptId: receiptId, detail: { forged: true },
    } }) })).rejects.toThrow(/exact same-receipt request mutation/i);
    expect(await prisma.correctionLifecycleEvent.count({ where: { requestId: correctionId } })).toBe(1);

    await expect(rawReceipt({ actor: steward, correctionId, labId: correction.labId, commandType: "corrections.request.apply", body: (tx, receiptId) => tx.correctionSupersession.create({ data: {
      id: `standalone-supersession-${randomUUID()}`, requestId: correctionId, labId: correction.labId, domain: correction.domain,
      targetEntityType: correction.targetEntityType, targetEntityId: correction.targetEntityId, originalSnapshot: correction.originalSnapshot as Prisma.InputJsonValue,
      effectiveProjection: correction.originalSnapshot as Prisma.InputJsonValue, sourceEventAt: correction.sourceEventAt, appliedAt: new Date(), appliedById: steward.id, commandReceiptId: receiptId,
    } }) })).rejects.toThrow(/exact same-receipt pending-to-applied transition/i);
    expect(await prisma.correctionSupersession.findUnique({ where: { requestId: correctionId } })).toBeNull();

    await expect(rawReceipt({ actor: steward, correctionId, labId: correction.labId, commandType: "corrections.request.apply", body: (tx, receiptId) => tx.correctionReconciliation.create({ data: {
      id: `standalone-reconciliation-${randomUUID()}`, requestId: correctionId, labId: correction.labId, downstreamRecords: [],
      result: { outcome: "reconciled", physicalMutationRequired: false, sourceRecordMutated: false }, physicalMutationRequired: false,
      reconciledAt: new Date(), commandReceiptId: receiptId,
    } }) })).rejects.toThrow(/exact same-receipt pending-to-applied transition/i);
    expect(await prisma.correctionReconciliation.findUnique({ where: { requestId: correctionId } })).toBeNull();

    const duty = await prisma.facilityDutyAssignment.findFirstOrThrow({ where: { userId: steward.id, duty: "data_steward", revokedAt: null } });
    await expect(rawReceipt({ actor: steward, correctionId, labId: correction.labId, commandType: "corrections.request.apply", body: (tx, receiptId) => tx.correctionRequest.update({ where: { id: correctionId }, data: {
      status: "applied", decidedById: steward.id, deciderAuthzVersion: steward.authzVersion + 1, deciderAssurance: "synthetic_mfa",
      deciderDutyAssignmentId: duty.id, deciderDutyAssignmentVersion: duty.version, deciderIdentityLinkId: steward.identityLinkId,
      deciderAuthenticatedAt: new Date(steward.authenticatedAt!), decisionCommandReceiptId: receiptId, decisionReason: "Forged authorization version must fail.", decidedAt: new Date(), version: { increment: 1 },
    } }) })).rejects.toThrow(/independent current Data Steward/i);

    await expect(rawReceipt({ actor: steward, correctionId, labId: correction.labId, commandType: "corrections.request.apply", body: async (tx, receiptId) => {
      const [current, latest, receipt] = await Promise.all([
        tx.correctionRequest.findUniqueOrThrow({ where: { id: correctionId } }),
        loadCorrectionTarget(tx, correction.domain, correction.targetEntityId, correction.labId),
        tx.commandReceipt.findUniqueOrThrow({ where: { id: receiptId } }),
      ]);
      if (!latest) throw new Error("Correction target disappeared.");
      const evaluated = evaluateCorrectionProposal(current.domain, latest.originalSnapshot, current.proposedCorrection as Prisma.InputJsonObject, latest.downstreamRecords);
      await tx.correctionSupersession.create({ data: {
        id: `forged-supersession-${randomUUID()}`, requestId: correctionId, labId: current.labId, domain: current.domain,
        targetEntityType: current.targetEntityType, targetEntityId: current.targetEntityId, originalSnapshot: current.originalSnapshot as Prisma.InputJsonValue,
        effectiveProjection: evaluated.effectiveProjection, sourceEventAt: current.sourceEventAt, appliedAt: new Date(), appliedById: steward.id, commandReceiptId: receiptId,
      } });
      await tx.correctionReconciliation.create({ data: {
        id: `forged-reconciliation-${randomUUID()}`, requestId: correctionId, labId: current.labId, downstreamRecords: latest.downstreamRecords,
        result: { outcome: "reconciled", physicalMutationRequired: false, sourceRecordMutated: false }, physicalMutationRequired: false,
        reconciledAt: new Date(), commandReceiptId: receiptId,
      } });
      const decidedAt = new Date();
      await tx.correctionRequest.update({ where: { id: correctionId }, data: {
        status: "applied", decidedById: steward.id, deciderAuthzVersion: steward.authzVersion, deciderAssurance: "synthetic_mfa",
        deciderDutyAssignmentId: duty.id, deciderDutyAssignmentVersion: duty.version, deciderIdentityLinkId: steward.identityLinkId,
        deciderAuthenticatedAt: new Date(steward.authenticatedAt!), decisionCommandReceiptId: receiptId, decisionReason: "Forged audit actor parity probe.", decidedAt, version: { increment: 1 },
      } });
      await tx.correctionLifecycleEvent.create({ data: {
        id: `forged-event-${randomUUID()}`, requestId: correctionId, labId: current.labId, eventType: "applied", fromStatus: "pending", toStatus: "applied",
        actorId: steward.id, actorAuthzVersion: steward.authzVersion, assurance: "synthetic_mfa", dutyAssignmentId: duty.id, dutyAssignmentVersion: duty.version,
        identityLinkId: steward.identityLinkId, authenticatedAt: new Date(steward.authenticatedAt!), commandReceiptId: receiptId, detail: { forgedAuditActor: true },
      } });
      await tx.auditLog.create({ data: {
        id: `forged-audit-${randomUUID()}`, actorId: requester.id, actorRole: requester.canonicalRole, labId: current.labId,
        requestId: receipt.requestId, commandReceiptId: receiptId, commandType: receipt.commandType, commandAggregateType: "correction_request",
        commandAggregateId: correctionId, entityType: "CorrectionRequest", entityId: correctionId, action: "applied",
        previousValue: { status: "pending" }, newValue: { status: "applied" }, timestamp: decidedAt,
      } });
      return true;
    } })).rejects.toThrow();
    expect(await prisma.correctionRequest.findUniqueOrThrow({ where: { id: correctionId } })).toMatchObject({ status: "pending", version: 1 });
    expect(await prisma.correctionSupersession.findUnique({ where: { requestId: correctionId } })).toBeNull();
    expect(await prisma.correctionReconciliation.findUnique({ where: { requestId: correctionId } })).toBeNull();

    expect((await executeDecideCorrectionRequest({ actor: steward, correctionId, expectedVersion: 1, decision: "approve", decisionReason: "Valid application after rollback proves unique evidence slots were not poisoned.", ...identity("reverse-pair-valid-apply") })).ok).toBe(true);
  }, 120_000);
});
