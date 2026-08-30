import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getActorCapabilities } from "@/lib/capabilities";
import { getCorrectionWorkspace, getEffectiveCorrectionProjection } from "@/lib/correction-read";
import { executeDecideCorrectionRequest, executeSubmitCorrectionRequest } from "@/lib/correction-write";
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
  return {
    id: user.id, email: user.email, name: user.name, databaseRole: user.role,
    role: canonicalRole === "facility_admin" ? "admin" : "animal_staff", canonicalRole,
    authzVersion: user.authzVersion, authMethod: "synthetic_mfa", assurance: "synthetic_mfa",
    authenticatedAt: new Date().toISOString(), identityLinkId: identityLink.id, activeDuties: duties,
    activeLabId, activeMembership, memberships: activeMembership ? [activeMembership] : [],
    capabilities: [...getActorCapabilities({ canonicalRole, activeMembership, activeDuties: duties })],
  };
}

function correctionId(result: Awaited<ReturnType<typeof executeSubmitCorrectionRequest>>) {
  if (!result.ok || !result.result || typeof result.result !== "object" || Array.isArray(result.result)) throw new Error("Correction request was not created.");
  return String((result.result as { correctionId: unknown }).correctionId);
}

describe.sequential("M15 correction command database contract", () => {
  it("applies one independent metadata supersession without mutating the biosample source", async () => {
    const requester = await actor("user-lab-manager-qa", "lab-microglia", []);
    const steward = await actor("user-facility-admin-approver-qa", null, ["training_administrator", "data_steward"]);
    const original = await prisma.sampleRecord.findUniqueOrThrow({ where: { id: "sample-002" } });
    const submitted = await executeSubmitCorrectionRequest({ actor: requester, ...identity("sample-submit"), command: {
      labId: "lab-microglia", domain: "biosample", targetEntityId: original.id, sourceEventAt: original.collectedAt,
      reason: "Correct the synthetic collection timestamp and explanatory note.",
      proposedCorrection: { collectedAt: "2026-04-02T13:50:00.000Z", notes: "Synthetic corrected collection note." },
    } });
    expect(submitted).toMatchObject({ ok: true });
    const id = correctionId(submitted);
    const decided = await executeDecideCorrectionRequest({ actor: steward, correctionId: id, expectedVersion: 1, decision: "approve", decisionReason: "Independent synthetic review confirmed metadata-only reconciliation.", ...identity("sample-apply") });
    expect(decided.ok).toBe(true);

    const [saved, sourceAfter, events, supersession, reconciliation, receipts, audits] = await Promise.all([
      prisma.correctionRequest.findUniqueOrThrow({ where: { id } }),
      prisma.sampleRecord.findUniqueOrThrow({ where: { id: original.id } }),
      prisma.correctionLifecycleEvent.findMany({ where: { requestId: id }, orderBy: { occurredAt: "asc" } }),
      prisma.correctionSupersession.findUniqueOrThrow({ where: { requestId: id } }),
      prisma.correctionReconciliation.findUniqueOrThrow({ where: { requestId: id } }),
      prisma.commandReceipt.findMany({ where: { aggregateType: "correction_request", aggregateId: id } }),
      prisma.auditLog.findMany({ where: { entityType: "CorrectionRequest", entityId: id } }),
    ]);
    expect(saved).toMatchObject({ status: "applied", version: 2, requestedById: requester.id, decidedById: steward.id });
    expect(sourceAfter).toEqual(original);
    expect(events.map((event) => event.eventType)).toEqual(["requested", "applied"]);
    expect(receipts).toHaveLength(2);
    expect(audits).toHaveLength(2);
    for (const event of events) {
      const receipt = receipts.find((candidate) => candidate.id === event.commandReceiptId);
      expect(receipt).toMatchObject({ status: "succeeded", actorId: event.actorId, actorAuthzVersion: event.actorAuthzVersion, labId: event.labId, aggregateType: "correction_request", aggregateId: id });
      expect(audits.filter((audit) => audit.commandReceiptId === event.commandReceiptId)).toHaveLength(1);
    }
    expect(supersession.effectiveProjection).toMatchObject({ collectedAt: "2026-04-02T13:50:00.000Z", notes: "Synthetic corrected collection note." });
    expect(reconciliation.physicalMutationRequired).toBe(false);
    expect(reconciliation.downstreamRecords).toEqual([{ entityType: "Animal", entityId: original.animalId }]);
    expect(reconciliation.result).toMatchObject({ outcome: "reconciled", physicalMutationRequired: false, sourceRecordMutated: false });
    const effective = await getEffectiveCorrectionProjection({ actor: steward, domain: "biosample", targetEntityId: original.id, labId: original.labId, baseProjection: { collectedAt: original.collectedAt.toISOString(), notes: original.notes } });
    expect(effective?.correctionRequestId).toBe(id);
    expect(effective?.projection).toMatchObject({ notes: "Synthetic corrected collection note." });
  }, 120_000);

  it("records structural birth and weaning changes as blocked and never allows them to appear applied", async () => {
    const requester = await actor("user-lab-manager-qa", "lab-microglia", []);
    const steward = await actor("user-facility-admin-approver-qa", null, ["training_administrator", "data_steward"]);
    const litter = await prisma.litter.findUniqueOrThrow({ where: { id: "litter-001" } });
    const submitted = await executeSubmitCorrectionRequest({ actor: requester, ...identity("weaning-submit"), command: {
      labId: "lab-microglia", domain: "litter_weaning", targetEntityId: litter.id, sourceEventAt: litter.birthDate,
      reason: "Request a structural weaning correction for synthetic QA.", proposedCorrection: { litterSizeWean: 6 },
    } });
    const id = correctionId(submitted);
    expect(await prisma.correctionRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "blocked", blockCode: "generated_weaning_state_requires_policy" });
    expect(await executeDecideCorrectionRequest({ actor: steward, correctionId: id, expectedVersion: 1, decision: "approve", decisionReason: "Attempted unsafe approval must fail closed.", ...identity("weaning-apply") })).toMatchObject({ ok: false, code: "invalid_state" });
    expect(await prisma.correctionRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "blocked", version: 1 });
    expect(await prisma.correctionSupersession.findUnique({ where: { requestId: id } })).toBeNull();
    expect(await prisma.correctionReconciliation.findUnique({ where: { requestId: id } })).toBeNull();
    expect((await executeDecideCorrectionRequest({ actor: steward, correctionId: id, expectedVersion: 1, decision: "reject", decisionReason: "Rejected because institutional structural reconciliation policy is unavailable.", ...identity("weaning-reject") })).ok).toBe(true);

    const birthSubmitted = await executeSubmitCorrectionRequest({ actor: requester, ...identity("birth-count-submit"), command: {
      labId: "lab-microglia", domain: "litter_birth", targetEntityId: litter.id, sourceEventAt: litter.birthDate,
      reason: "Request a structural birth-count correction for synthetic QA.",
      proposedCorrection: { litterSizeBirth: litter.litterSizeBirth === 6 ? 7 : 6 },
    } });
    const birthId = correctionId(birthSubmitted);
    expect(await prisma.correctionRequest.findUniqueOrThrow({ where: { id: birthId } })).toMatchObject({ status: "blocked", blockCode: "birth_count_change_requires_policy" });
    expect(await executeDecideCorrectionRequest({ actor: steward, correctionId: birthId, expectedVersion: 1, decision: "approve", decisionReason: "Structural birth-count approval must fail closed.", ...identity("birth-count-apply") })).toMatchObject({ ok: false, code: "invalid_state" });
    expect(await prisma.correctionSupersession.findUnique({ where: { requestId: birthId } })).toBeNull();
    expect(await prisma.correctionReconciliation.findUnique({ where: { requestId: birthId } })).toBeNull();
  }, 120_000);

  it("enforces maker-checker independence and privacy-minimized requester versus unit-wide steward views", async () => {
    const stewardRequester = await actor("user-facility-admin-approver-qa", null, ["training_administrator", "data_steward"]);
    const sample = await prisma.sampleRecord.findUniqueOrThrow({ where: { id: "sample-003" } });
    const submitted = await executeSubmitCorrectionRequest({ actor: stewardRequester, ...identity("self-submit"), command: {
      labId: sample.labId, domain: "biosample", targetEntityId: sample.id, sourceEventAt: sample.collectedAt,
      reason: "Synthetic self-review independence probe for metadata correction.", proposedCorrection: { notes: "Synthetic corrected note for independence probe." },
    } });
    const id = correctionId(submitted);
    expect(await executeDecideCorrectionRequest({ actor: stewardRequester, correctionId: id, expectedVersion: 1, decision: "approve", decisionReason: "Self approval must be rejected by policy.", ...identity("self-apply") })).toMatchObject({ ok: false, code: "independence_required" });
    const requester = await actor("user-lab-manager-qa", "lab-microglia", []);
    const [requesterView, stewardView] = await Promise.all([getCorrectionWorkspace(requester), getCorrectionWorkspace(stewardRequester)]);
    expect(requesterView.access).toBe("requester");
    expect(requesterView.requests.every((request) => request.requestedBy.id === requester.id && request.labId === requester.activeLabId)).toBe(true);
    expect(stewardView.access).toBe("data_steward");
    expect(stewardView.requests.some((request) => request.id === id)).toBe(true);
  }, 120_000);
});
