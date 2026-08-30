import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getActorCapabilities } from "@/lib/capabilities";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";
import { getWelfareWorkspace } from "@/lib/welfare-read";
import {
  executeAcknowledgeWelfareEscalationCommand,
  executeApproveWelfareTreatmentOrderCommand,
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
import { installWelfareDatabaseFixture } from "./welfare-test-fixture";

let cleanupWelfareFixture: (() => Promise<void>) | undefined;

beforeAll(async () => {
  cleanupWelfareFixture = await installWelfareDatabaseFixture();
}, 120_000);

afterAll(async () => {
  await cleanupWelfareFixture?.();
}, 120_000);

async function dutyActor(userId: string, duty: "designated_veterinarian" | "welfare_officer"): Promise<ResolvedActor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true, role: true, authzVersion: true } });
  const identity = await prisma.externalIdentityLink.findFirstOrThrow({ where: { userId, active: true }, select: { id: true } });
  const capabilities = [...getActorCapabilities({ canonicalRole: user.role === "cmu_staff" ? "cmu_staff" : "lab_user", activeMembership: null, activeDuties: [duty] })];
  return {
    id: userId, email: user.email, name: user.name, databaseRole: user.role,
    role: user.role === "cmu_staff" ? "colony_manager" : "read_only",
    canonicalRole: user.role === "cmu_staff" ? "cmu_staff" : "lab_user",
    authzVersion: user.authzVersion, authMethod: "synthetic_mfa", assurance: "synthetic_mfa",
    authenticatedAt: new Date().toISOString(), identityLinkId: identity.id, activeDuties: [duty],
    activeLabId: userId === "user-veterinarian-qa" ? "lab-neuroimmune" : null, activeMembership: null, memberships: [], capabilities,
  };
}

function identity(prefix: string) {
  return { idempotencyKey: `${prefix}-${randomUUID()}`, requestId: `request-${randomUUID()}` };
}

describe.sequential("M14 welfare command database contract", () => {
  it("keeps clinical duties distinct and settles escalation and treatment before veterinarian closure", async () => {
    process.env.MCM_DEPLOYMENT_PROFILE = "synthetic";
    const [vet, officer, noDuty, animal] = await Promise.all([
      dutyActor("user-veterinarian-qa", "designated_veterinarian"),
      dutyActor("user-cmu-staff-qa", "welfare_officer"),
      dutyActor("user-lab-owner-qa", "welfare_officer"),
      prisma.animal.findUniqueOrThrow({ where: { id: "animal-001" }, select: { id: true, version: true } }),
    ]);

    const openIdentity = identity("welfare-open");
    expect(await executeOpenWelfareCaseCommand({ actor: noDuty, ...identity("no-duty"), command: { subjectType: "animal", subjectId: animal.id, expectedSubjectVersion: animal.version, severity: "warning", operationalSummary: "Denied without duty", privateClinicalSummary: "Denied synthetic context", openedAt: new Date() } })).toMatchObject({ ok: false, code: "forbidden" });
    const opened = await executeOpenWelfareCaseCommand({
      actor: officer, ...openIdentity,
      command: { subjectType: "animal", subjectId: animal.id, expectedSubjectVersion: animal.version, severity: "warning", operationalSummary: "Condition change requires review", privateClinicalSummary: "Synthetic clinical context for M14 validation only", openedAt: new Date() },
    });
    expect(opened.ok).toBe(true);
    expect(await executeOpenWelfareCaseCommand({ actor: officer, ...openIdentity, command: { subjectType: "animal", subjectId: animal.id, expectedSubjectVersion: animal.version, severity: "warning", operationalSummary: "Condition change requires review", privateClinicalSummary: "Synthetic clinical context for M14 validation only", openedAt: new Date(0) } })).toMatchObject({ ok: false, code: "idempotency_conflict" });
    if (!opened.ok || !opened.result || typeof opened.result !== "object" || Array.isArray(opened.result)) return;
    const caseId = String((opened.result as { caseId: unknown }).caseId);

    expect((await executeTriageWelfareCaseCommand({ actor: officer, caseId, expectedVersion: 1, triagedAt: new Date(), ...identity("triage") })).ok).toBe(true);
    const officerOrder = await executeProposeWelfareTreatmentOrderCommand({ actor: officer, caseId, expectedVersion: 2, medication: "Synthetic compound", dose: "1 unit", route: "documented route", frequency: "once", instructions: "Synthetic order", proposedAt: new Date(), ...identity("officer-order") });
    expect(officerOrder).toMatchObject({ ok: false, code: "clinical_duty_required" });
    expect((await executeRecordWelfareObservationCommand({ actor: officer, caseId, expectedVersion: 2, observedAt: new Date(), severity: "critical", operationalCode: "condition_change", privateNote: "Synthetic observation", ...identity("observe") })).ok).toBe(true);
    const escalated = await executeOpenWelfareEscalationCommand({ actor: officer, caseId, expectedVersion: 3, openedAt: new Date(), severity: "critical", operationalCode: "humane_endpoint_review", privateReason: "Synthetic critical review", ...identity("escalate") });
    expect(escalated.ok).toBe(true);
    const escalation = await prisma.welfareEscalation.findFirstOrThrow({ where: { caseId }, select: { id: true, version: true } });
    expect((await executeResolveWelfareEscalationCommand({ actor: vet, caseId, expectedVersion: 4, escalationId: escalation.id, expectedEscalationVersion: escalation.version, resolvedAt: new Date(), resolutionNote: "Premature resolution", ...identity("resolve-too-early") })).ok).toBe(false);
    expect(await executeCloseWelfareCaseCommand({ actor: vet, caseId, expectedVersion: 4, closedAt: new Date(), closureReason: "Premature closure", ...identity("close-too-early") })).toMatchObject({ ok: false, code: "unresolved_escalation" });
    expect((await executeAcknowledgeWelfareEscalationCommand({ actor: officer, caseId, expectedVersion: 4, escalationId: escalation.id, expectedEscalationVersion: 1, acknowledgedAt: new Date(), ...identity("ack") })).ok).toBe(true);
    expect((await executeResolveWelfareEscalationCommand({ actor: vet, caseId, expectedVersion: 5, escalationId: escalation.id, expectedEscalationVersion: 2, resolvedAt: new Date(), resolutionNote: "Synthetic escalation settled", ...identity("resolve") })).ok).toBe(true);

    expect((await executeProposeWelfareTreatmentOrderCommand({ actor: vet, caseId, expectedVersion: 6, medication: "Synthetic compound", dose: "1 unit", route: "documented route", frequency: "once daily", instructions: "Synthetic-only treatment instruction", proposedAt: new Date(), ...identity("order") })).ok).toBe(true);
    const order = await prisma.welfareTreatmentOrder.findFirstOrThrow({ where: { caseId }, select: { id: true, version: true } });
    expect((await executeRecordWelfareAdministrationCommand({ actor: vet, caseId, expectedVersion: 7, orderId: order.id, expectedOrderVersion: 1, administeredAt: new Date(), outcome: "administered", actualDose: "1 unit", ...identity("admin-too-early") })).ok).toBe(false);
    expect((await executeApproveWelfareTreatmentOrderCommand({ actor: vet, caseId, expectedVersion: 7, orderId: order.id, expectedOrderVersion: 1, approvedAt: new Date(), ...identity("approve") })).ok).toBe(true);
    expect((await executeRecordWelfareAdministrationCommand({ actor: vet, caseId, expectedVersion: 8, orderId: order.id, expectedOrderVersion: 2, administeredAt: new Date(), outcome: "administered", actualDose: "1 unit", privateNote: "Synthetic administration", ...identity("admin") })).ok).toBe(true);
    expect((await executeStopWelfareTreatmentOrderCommand({ actor: vet, caseId, expectedVersion: 9, orderId: order.id, expectedOrderVersion: 3, stoppedAt: new Date(), reason: "Synthetic course stopped", ...identity("stop") })).ok).toBe(true);
    expect((await executeCloseWelfareCaseCommand({ actor: officer, caseId, expectedVersion: 10, closedAt: new Date(), closureReason: "Officer cannot close", ...identity("officer-close") })).ok).toBe(false);
    expect((await executeCloseWelfareCaseCommand({ actor: vet, caseId, expectedVersion: 10, closedAt: new Date(), closureReason: "Synthetic case completed after all obligations settled", ...identity("close") })).ok).toBe(true);

    const [saved, events, administrations, officerView, vetView] = await Promise.all([
      prisma.welfareCase.findUniqueOrThrow({ where: { id: caseId } }),
      prisma.welfareCaseLifecycleEvent.findMany({ where: { caseId } }),
      prisma.welfareAdministrationAttempt.findMany({ where: { caseId } }),
      getWelfareWorkspace(officer),
      getWelfareWorkspace(vet),
    ]);
    expect(saved.status).toBe("closed");
    expect(saved.policyMarker).toBe("synthetic-fail-closed-v1");
    expect(events).toHaveLength(11);
    const receiptIds = events.map((event) => event.commandReceiptId);
    const [receipts, audits] = await Promise.all([
      prisma.commandReceipt.findMany({ where: { id: { in: receiptIds } } }),
      prisma.auditLog.findMany({ where: { commandReceiptId: { in: receiptIds }, entityType: "WelfareCase", entityId: caseId } }),
    ]);
    expect(receipts).toHaveLength(events.length);
    expect(audits).toHaveLength(events.length);
    for (const event of events) {
      const receipt = receipts.find((candidate) => candidate.id === event.commandReceiptId);
      const audit = audits.filter((candidate) => candidate.commandReceiptId === event.commandReceiptId);
      expect(receipt).toMatchObject({ status: "succeeded", actorId: event.actorId, actorAuthzVersion: event.actorAuthzVersion, labId: event.labId, aggregateType: "welfare_case", aggregateId: caseId });
      expect(event.assurance).toBe("synthetic_mfa");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorId: event.actorId,
        labId: event.labId,
        requestId: receipt?.requestId,
        commandType: receipt?.commandType,
        action: event.eventType,
        commandAggregateType: "welfare_case",
        commandAggregateId: caseId,
      });
    }
    expect(administrations).toHaveLength(1);
    expect(officerView.access).toBe("welfare_officer");
    expect(JSON.stringify(officerView)).not.toContain("Synthetic compound");
    expect(JSON.stringify(officerView)).not.toContain("Synthetic clinical context");
    expect(vetView.access).toBe("designated_veterinarian");
    expect(JSON.stringify(vetView)).toContain("Synthetic compound");
  }, 120_000);
});
