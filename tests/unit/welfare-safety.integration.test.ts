import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getActorCapabilities } from "@/lib/capabilities";
import {
  decideFacilityDutyRequest,
  requestFacilityDutyGrant,
  requestFacilityDutyRevoke,
  type DutyGovernanceActor,
} from "@/lib/facility-duty-governance";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";
import {
  executeApproveWelfareTreatmentOrderCommand,
  executeAcknowledgeWelfareEscalationCommand,
  executeCancelWelfareCaseCommand,
  executeOpenWelfareCaseCommand,
  executeOpenWelfareEscalationCommand,
  executeProposeWelfareTreatmentOrderCommand,
  executeRecordWelfareObservationCommand,
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

type Duty = "designated_veterinarian" | "welfare_officer";

async function dutyActor(userId: string, duty: Duty): Promise<ResolvedActor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true, role: true, authzVersion: true } });
  const identity = await prisma.externalIdentityLink.findFirstOrThrow({ where: { userId, active: true }, select: { id: true } });
  const canonicalRole = user.role === "cmu_staff" ? "cmu_staff" : "lab_user";
  return {
    id: userId, email: user.email, name: user.name, databaseRole: user.role,
    role: user.role === "cmu_staff" ? "colony_manager" : "read_only", canonicalRole,
    authzVersion: user.authzVersion, authMethod: "synthetic_mfa", assurance: "synthetic_mfa",
    authenticatedAt: new Date().toISOString(), identityLinkId: identity.id, activeDuties: [duty],
    activeLabId: null, activeMembership: null, memberships: [],
    capabilities: [...getActorCapabilities({ canonicalRole, activeMembership: null, activeDuties: [duty] })],
  };
}

async function adminActor(userId: "user-facility-admin-qa" | "user-facility-admin-approver-qa"): Promise<DutyGovernanceActor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, authzVersion: true } });
  const identity = await prisma.externalIdentityLink.findFirstOrThrow({ where: { userId, active: true }, select: { id: true } });
  return {
    id: userId, email: user.email, canonicalRole: "facility_admin", authzVersion: user.authzVersion,
    authMethod: "synthetic_mfa", assurance: "synthetic_mfa", authenticatedAt: new Date().toISOString(), identityLinkId: identity.id,
  };
}

function identity(prefix: string) {
  return { idempotencyKey: `${prefix}-${randomUUID()}`, requestId: `request-${randomUUID()}` };
}

async function openAnimalCase(actor: ResolvedActor, animalId: string) {
  const animal = await prisma.animal.findUniqueOrThrow({ where: { id: animalId }, select: { version: true } });
  const opened = await executeOpenWelfareCaseCommand({
    actor, ...identity(`open-${animalId}`),
    command: {
      subjectType: "animal", subjectId: animalId, expectedSubjectVersion: animal.version, severity: "warning",
      operationalSummary: `Synthetic safety review for ${animalId}`,
      privateClinicalSummary: "Synthetic M14 safety-test context only.", openedAt: new Date(),
    },
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok || !opened.result || typeof opened.result !== "object") throw new Error("Could not open safety-test case.");
  return String((opened.result as { caseId: unknown }).caseId);
}

async function setReceiptContext(tx: Prisma.TransactionClient, receipt: { id: string; actorId: string; commandType: string; requestHash: string }) {
  await tx.$queryRaw(Prisma.sql`SELECT
    set_config('mcm.audit_receipt_id', ${receipt.id}, true),
    set_config('mcm.audit_actor_id', ${receipt.actorId}, true),
    set_config('mcm.audit_command_type', ${receipt.commandType}, true),
    set_config('mcm.audit_request_hash', ${receipt.requestHash}, true)`);
}

async function rawReceipt<T>(input: {
  actor: ResolvedActor;
  caseId: string;
  labId: string;
  commandType: string;
  body: (tx: Prisma.TransactionClient, receiptId: string) => Promise<T>;
}) {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.commandReceipt.create({
      data: {
        id: `welfare-raw-${randomUUID()}`, actorId: input.actor.id, actorAuthzVersion: input.actor.authzVersion,
        labId: input.labId, commandType: input.commandType, idempotencyKey: `raw-${randomUUID()}`,
        requestHash: `raw-hash-${randomUUID()}`, requestId: `raw-request-${randomUUID()}`, status: "processing",
        aggregateType: "welfare_case", aggregateId: input.caseId, startedAt: new Date(),
      },
    });
    await setReceiptContext(tx, receipt);
    const result = await input.body(tx, receipt.id);
    await tx.commandReceipt.update({ where: { id: receipt.id }, data: { status: "succeeded", completedAt: new Date() } });
    return result;
  });
}

describe.sequential("M14 welfare fail-closed safety contract", () => {
  it("rolls back a late transactional failure and permits a clean replay", async () => {
    const probe = `m14_rollback_probe_${randomUUID().replaceAll("-", "")}`;
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE "${probe}" (id integer PRIMARY KEY)`);
      await tx.$executeRawUnsafe("SELECT 1 / 0");
    })).rejects.toThrow();
    const afterFailure = await prisma.$queryRaw<Array<{ present: boolean }>>(Prisma.sql`
      SELECT to_regclass(current_schema() || '.' || ${probe}) IS NOT NULL AS present
    `);
    expect(afterFailure[0]?.present).toBe(false);
    await prisma.$executeRawUnsafe(`CREATE TABLE "${probe}" (id integer PRIMARY KEY)`);
    const afterReplay = await prisma.$queryRaw<Array<{ present: boolean }>>(Prisma.sql`
      SELECT to_regclass(current_schema() || '.' || ${probe}) IS NOT NULL AS present
    `);
    expect(afterReplay[0]?.present).toBe(true);
    await prisma.$executeRawUnsafe(`DROP TABLE "${probe}"`);
  });

  it("rejects stale, wrong-command, wrong-case, wrong-lab, forged-assurance, missing-pair, and truncate writes", async () => {
    process.env.MCM_DEPLOYMENT_PROFILE = "synthetic";
    const officer = await dutyActor("user-cmu-staff-qa", "welfare_officer");
    const caseId = await openAnimalCase(officer, "animal-002");
    const otherCaseId = await openAnimalCase(officer, "animal-003");
    const welfareCase = await prisma.welfareCase.findUniqueOrThrow({ where: { id: caseId } });
    const otherCase = await prisma.welfareCase.findUniqueOrThrow({ where: { id: otherCaseId } });
    const assignment = await prisma.facilityDutyAssignment.findFirstOrThrow({ where: { userId: officer.id, duty: "welfare_officer", revokedAt: null } });
    const identityLinkId = officer.identityLinkId!;
    const vet = await dutyActor("user-veterinarian-qa", "designated_veterinarian");

    await expect(rawReceipt({ actor: officer, caseId, labId: welfareCase.labId, commandType: "welfare.observation.record", body: (tx, receiptId) => tx.welfareObservation.create({ data: {
      id: `wrong-actor-${randomUUID()}`, caseId, labId: welfareCase.labId, observedAt: new Date(), severity: "warning",
      operationalCode: "other", privateNote: "Wrong actor must fail", observedById: vet.id, commandReceiptId: receiptId,
    } }) })).rejects.toThrow(/receipt, actor, command, aggregate, or lab mismatch/i);

    await expect(rawReceipt({ actor: officer, caseId, labId: welfareCase.labId, commandType: "welfare.case.triage", body: (tx, receiptId) => tx.welfareObservation.create({ data: {
      id: `wrong-command-${randomUUID()}`, caseId, labId: welfareCase.labId, observedAt: new Date(), severity: "warning",
      operationalCode: "other", privateNote: "Wrong command must fail", observedById: officer.id, commandReceiptId: receiptId,
    } }) })).rejects.toThrow(/receipt, actor, command, aggregate, or lab mismatch/i);

    await expect(rawReceipt({ actor: officer, caseId, labId: welfareCase.labId, commandType: "welfare.observation.record", body: (tx, receiptId) => tx.welfareObservation.create({ data: {
      id: `wrong-case-${randomUUID()}`, caseId: otherCaseId, labId: otherCase.labId, observedAt: new Date(), severity: "warning",
      operationalCode: "other", privateNote: "Wrong aggregate must fail", observedById: officer.id, commandReceiptId: receiptId,
    } }) })).rejects.toThrow(/receipt, actor, command, aggregate, or lab mismatch/i);

    await expect(rawReceipt({ actor: officer, caseId, labId: "lab-neuroimmune", commandType: "welfare.observation.record", body: (tx, receiptId) => tx.welfareObservation.create({ data: {
      id: `wrong-lab-${randomUUID()}`, caseId, labId: welfareCase.labId, observedAt: new Date(), severity: "warning",
      operationalCode: "other", privateNote: "Wrong lab must fail", observedById: officer.id, commandReceiptId: receiptId,
    } }) })).rejects.toThrow(/receipt, actor, command, aggregate, or lab mismatch/i);

    const completedReceipt = await prisma.commandReceipt.findUniqueOrThrow({ where: { id: welfareCase.openedCommandReceiptId } });
    await expect(prisma.$transaction(async (tx) => {
      await setReceiptContext(tx, completedReceipt);
      await tx.welfareObservation.create({ data: {
        id: `stale-receipt-${randomUUID()}`, caseId, labId: welfareCase.labId, observedAt: new Date(), severity: "warning",
        operationalCode: "other", privateNote: "Stale receipt must fail", observedById: officer.id, commandReceiptId: completedReceipt.id,
      } });
    })).rejects.toThrow(/receipt, actor, command, aggregate, or lab mismatch/i);

    await expect(rawReceipt({ actor: officer, caseId, labId: welfareCase.labId, commandType: "welfare.observation.record", body: (tx, receiptId) => tx.welfareCaseLifecycleEvent.create({ data: {
      id: `forged-assurance-${randomUUID()}`, caseId, labId: welfareCase.labId, eventType: "observation_recorded",
      fromStatus: "open", toStatus: "under_observation", actorId: officer.id, actorAuthzVersion: officer.authzVersion,
      assurance: "mfa", dutyAssignmentId: assignment.id, dutyAssignmentVersion: assignment.version,
      identityLinkId, authenticatedAt: new Date(), commandReceiptId: receiptId, detail: { forged: true },
    } }) })).rejects.toThrow(/evidence is stale or mismatched/i);

    await expect(rawReceipt({ actor: officer, caseId, labId: welfareCase.labId, commandType: "welfare.case.triage", body: (tx, receiptId) => tx.welfareCase.update({
      where: { id: caseId }, data: { status: "triaged", triagedAt: new Date(), triagedById: officer.id, lastCommandReceiptId: receiptId, version: { increment: 1 } },
    }) })).rejects.toThrow(/one exact same-receipt lifecycle event/i);
    expect(await prisma.welfareCase.findUniqueOrThrow({ where: { id: caseId }, select: { status: true, version: true } })).toEqual({ status: "open", version: 1 });

    await expect(rawReceipt({ actor: officer, caseId, labId: welfareCase.labId, commandType: "welfare.observation.record", body: (tx, receiptId) => tx.welfareCase.update({
      where: { id: caseId }, data: { severity: "critical", status: "under_observation", lastCommandReceiptId: receiptId, version: { increment: 1 } },
    }) })).rejects.toThrow(/immutable fields or version changed/i);

    for (const attempt of [
      { actor: vet, commandType: "welfare.observation.record", status: "closed" as const },
      { actor: vet, commandType: "welfare.treatment.propose", status: "cancelled" as const },
      { actor: vet, commandType: "welfare.escalation.open", status: "closed" as const },
    ]) {
      let unrelatedReceiptId = "";
      await expect(rawReceipt({
        actor: attempt.actor, caseId, labId: welfareCase.labId, commandType: attempt.commandType,
        body: (tx, receiptId) => {
          unrelatedReceiptId = receiptId;
          return tx.welfareCase.update({
            where: { id: caseId },
            data: attempt.status === "closed"
              ? { status: "closed", closedAt: new Date(), closedById: vet.id, closureReason: "Unrelated command must fail", version: { increment: 1 } }
              : { status: "cancelled", cancelledAt: new Date(), cancelledById: vet.id, cancellationCode: "not_a_case", cancellationReason: "Unrelated command must fail", version: { increment: 1 } },
          });
        },
      })).rejects.toThrow(/case update receipt context is mismatched/i);
      expect(await prisma.commandReceipt.findUnique({ where: { id: unrelatedReceiptId } })).toBeNull();
      expect(await prisma.welfareCase.findUniqueOrThrow({ where: { id: caseId }, select: { status: true, version: true } })).toEqual({ status: "open", version: 1 });
    }

    await expect(rawReceipt({ actor: vet, caseId, labId: welfareCase.labId, commandType: "welfare.treatment.propose", body: (tx, receiptId) => tx.welfareTreatmentOrder.create({ data: {
      id: `missing-order-event-${randomUUID()}`, caseId, labId: welfareCase.labId, medication: "Synthetic", dose: "1 unit",
      route: "synthetic route", frequency: "once", instructions: "Missing event must fail", proposedAt: new Date(),
      proposedById: vet.id, proposedCommandReceiptId: receiptId, lastCommandReceiptId: receiptId,
    } }) })).rejects.toThrow(/treatment mutation requires one exact same-receipt lifecycle event/i);
    expect(await prisma.welfareTreatmentOrder.count({ where: { caseId } })).toBe(0);

    await expect(rawReceipt({ actor: officer, caseId, labId: welfareCase.labId, commandType: "welfare.escalation.open", body: (tx, receiptId) => tx.welfareEscalation.create({ data: {
      id: `missing-escalation-event-${randomUUID()}`, caseId, labId: welfareCase.labId, severity: "critical",
      operationalCode: "urgent_review", privateReason: "Missing event must fail", openedAt: new Date(),
      openedById: officer.id, openedCommandReceiptId: receiptId, lastCommandReceiptId: receiptId,
    } }) })).rejects.toThrow(/escalation mutation requires one exact same-receipt lifecycle event/i);
    expect(await prisma.welfareEscalation.count({ where: { caseId } })).toBe(0);

    const vetAssignment = await prisma.facilityDutyAssignment.findFirstOrThrow({
      where: { userId: vet.id, duty: "designated_veterinarian", revokedAt: null },
    });
    expect((await executeTriageWelfareCaseCommand({
      actor: vet, caseId, expectedVersion: 1, triagedAt: new Date(), ...identity("standalone-domain-triage"),
    })).ok).toBe(true);
    for (const standalone of [
      { commandType: "welfare.treatment.propose", eventType: "treatment_ordered" as const, toStatus: "treatment_ordered" as const, detail: { orderId: `missing-order-${randomUUID()}` } },
      { commandType: "welfare.escalation.open", eventType: "escalated" as const, toStatus: "escalated" as const, detail: { escalationId: `missing-escalation-${randomUUID()}` } },
    ]) {
      let standaloneReceiptId = "";
      await expect(rawReceipt({
        actor: vet, caseId, labId: welfareCase.labId, commandType: standalone.commandType,
        body: async (tx, receiptId) => {
          standaloneReceiptId = receiptId;
          const receipt = await tx.commandReceipt.findUniqueOrThrow({ where: { id: receiptId } });
          await tx.welfareCase.update({
            where: { id: caseId },
            data: { status: standalone.toStatus, lastCommandReceiptId: receiptId, version: { increment: 1 } },
          });
          await tx.welfareCaseLifecycleEvent.create({ data: {
            id: `standalone-event-${randomUUID()}`, caseId, labId: welfareCase.labId,
            eventType: standalone.eventType, fromStatus: "triaged", toStatus: standalone.toStatus,
            actorId: vet.id, actorAuthzVersion: vet.authzVersion, assurance: "synthetic_mfa",
            dutyAssignmentId: vetAssignment.id, dutyAssignmentVersion: vetAssignment.version,
            identityLinkId: vet.identityLinkId!, authenticatedAt: new Date(),
            commandReceiptId: receiptId, detail: standalone.detail,
          } });
          return tx.auditLog.create({ data: {
            id: `standalone-audit-${randomUUID()}`, actorId: vet.id, actorRole: vet.canonicalRole,
            labId: welfareCase.labId, requestId: receipt.requestId, commandReceiptId: receiptId,
            commandType: receipt.commandType, commandAggregateType: "welfare_case", commandAggregateId: caseId,
            entityType: "WelfareCase", entityId: caseId, action: standalone.eventType,
            newValue: { status: standalone.toStatus }, timestamp: new Date(),
          } });
        },
      })).rejects.toThrow(/requires one exact same-receipt domain mutation/i);
      expect(await prisma.commandReceipt.findUnique({ where: { id: standaloneReceiptId } })).toBeNull();
      expect(await prisma.welfareCaseLifecycleEvent.count({ where: { commandReceiptId: standaloneReceiptId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { commandReceiptId: standaloneReceiptId } })).toBe(0);
      expect(await prisma.welfareCase.findUniqueOrThrow({ where: { id: caseId }, select: { status: true, version: true } })).toEqual({ status: "triaged", version: 2 });
    }

    await expect(rawReceipt({ actor: officer, caseId, labId: welfareCase.labId, commandType: "welfare.observation.record", body: async (tx, receiptId) => {
      await tx.welfareObservation.create({ data: {
        id: `missing-audit-observation-${randomUUID()}`, caseId, labId: welfareCase.labId,
        observedAt: new Date(), severity: "warning", operationalCode: "other",
        privateNote: "Synthetic missing audit validation", observedById: officer.id, commandReceiptId: receiptId,
      } });
      await tx.welfareCase.update({ where: { id: caseId }, data: {
        status: "under_observation", lastCommandReceiptId: receiptId, version: { increment: 1 },
      } });
      return tx.welfareCaseLifecycleEvent.create({ data: {
        id: `missing-audit-${randomUUID()}`, caseId, labId: welfareCase.labId, eventType: "observation_recorded",
        fromStatus: "triaged", toStatus: "under_observation", actorId: officer.id, actorAuthzVersion: officer.authzVersion,
        assurance: "synthetic_mfa", dutyAssignmentId: assignment.id, dutyAssignmentVersion: assignment.version,
        identityLinkId, authenticatedAt: new Date(), commandReceiptId: receiptId, detail: { auditMissing: true },
      } });
    } })).rejects.toThrow(/one exact receipt-event-audit record/i);

    for (const table of ["WelfareCaseLifecycleEvent", "WelfareAdministrationAttempt", "WelfareEscalation", "WelfareTreatmentOrder", "WelfareObservation", "WelfareCase"]) {
      await expect(prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`)).rejects.toThrow(/cannot be truncated/i);
    }
  }, 120_000);

  it("rolls back observation and administration receipts when their lifecycle event is omitted", async () => {
    const [vet, officer] = await Promise.all([
      dutyActor("user-veterinarian-qa", "designated_veterinarian"),
      dutyActor("user-cmu-staff-qa", "welfare_officer"),
    ]);

    const observationCaseId = await openAnimalCase(officer, "animal-009");
    const observationCase = await prisma.welfareCase.findUniqueOrThrow({
      where: { id: observationCaseId }, select: { labId: true },
    });
    const observationId = `missing-observation-event-${randomUUID()}`;
    let observationReceiptId = "";
    await expect(rawReceipt({
      actor: officer,
      caseId: observationCaseId,
      labId: observationCase.labId,
      commandType: "welfare.observation.record",
      body: (tx, receiptId) => {
        observationReceiptId = receiptId;
        return tx.welfareObservation.create({ data: {
          id: observationId, caseId: observationCaseId, labId: observationCase.labId,
          observedAt: new Date(), severity: "warning", operationalCode: "other",
          privateNote: "Synthetic omission rollback observation", observedById: officer.id,
          commandReceiptId: receiptId,
        } });
      },
    })).rejects.toThrow(/observation requires one exact same-receipt lifecycle event/i);
    expect(await prisma.welfareObservation.findUnique({ where: { id: observationId } })).toBeNull();
    expect(await prisma.commandReceipt.findUnique({ where: { id: observationReceiptId } })).toBeNull();

    const administrationCaseId = await openAnimalCase(vet, "animal-010");
    expect((await executeTriageWelfareCaseCommand({
      actor: vet, caseId: administrationCaseId, expectedVersion: 1,
      triagedAt: new Date(), ...identity("omitted-admin-triage"),
    })).ok).toBe(true);
    expect((await executeProposeWelfareTreatmentOrderCommand({
      actor: vet, caseId: administrationCaseId, expectedVersion: 2,
      medication: "Synthetic omission compound", dose: "1 unit", route: "synthetic route",
      frequency: "once", instructions: "Synthetic only", proposedAt: new Date(),
      ...identity("omitted-admin-order"),
    })).ok).toBe(true);
    const order = await prisma.welfareTreatmentOrder.findFirstOrThrow({ where: { caseId: administrationCaseId } });
    expect((await executeApproveWelfareTreatmentOrderCommand({
      actor: vet, caseId: administrationCaseId, expectedVersion: 3,
      orderId: order.id, expectedOrderVersion: 1, approvedAt: new Date(),
      ...identity("omitted-admin-approve"),
    })).ok).toBe(true);
    const administrationCase = await prisma.welfareCase.findUniqueOrThrow({
      where: { id: administrationCaseId }, select: { labId: true },
    });
    const administrationId = `missing-administration-event-${randomUUID()}`;
    let administrationReceiptId = "";
    await expect(rawReceipt({
      actor: vet,
      caseId: administrationCaseId,
      labId: administrationCase.labId,
      commandType: "welfare.treatment.administer",
      body: (tx, receiptId) => {
        administrationReceiptId = receiptId;
        return tx.welfareAdministrationAttempt.create({ data: {
          id: administrationId, caseId: administrationCaseId, orderId: order.id,
          labId: administrationCase.labId, administeredAt: new Date(), outcome: "administered",
          actualDose: "1 unit", privateNote: "Synthetic omission rollback administration",
          administeredById: vet.id, commandReceiptId: receiptId,
        } });
      },
    })).rejects.toThrow(/administration requires one exact same-receipt lifecycle event/i);
    expect(await prisma.welfareAdministrationAttempt.findUnique({ where: { id: administrationId } })).toBeNull();
    expect(await prisma.commandReceipt.findUnique({ where: { id: administrationReceiptId } })).toBeNull();
    expect(await prisma.welfareTreatmentOrder.findUniqueOrThrow({
      where: { id: order.id }, select: { status: true, version: true },
    })).toEqual({ status: "approved", version: 2 });
  }, 120_000);

  it("rolls back standalone triage and closure lifecycle events without their case mutation", async () => {
    const [vet, officer] = await Promise.all([
      dutyActor("user-veterinarian-qa", "designated_veterinarian"),
      dutyActor("user-cmu-staff-qa", "welfare_officer"),
    ]);
    const [vetAssignment, officerAssignment] = await Promise.all([
      prisma.facilityDutyAssignment.findFirstOrThrow({ where: { userId: vet.id, duty: "designated_veterinarian", revokedAt: null } }),
      prisma.facilityDutyAssignment.findFirstOrThrow({ where: { userId: officer.id, duty: "welfare_officer", revokedAt: null } }),
    ]);
    const triageCaseId = await openAnimalCase(officer, "animal-011");
    const closureCaseId = await openAnimalCase(officer, "animal-012");
    expect((await executeRecordWelfareObservationCommand({
      actor: officer, caseId: closureCaseId, expectedVersion: 1, observedAt: new Date(),
      severity: "warning", operationalCode: "other", privateNote: "Synthetic closure precondition",
      ...identity("standalone-close-observation"),
    })).ok).toBe(true);
    const cases = await prisma.welfareCase.findMany({
      where: { id: { in: [triageCaseId, closureCaseId] } }, select: { id: true, labId: true },
    });
    for (const standalone of [
      {
        actor: officer, assignment: officerAssignment, caseId: triageCaseId,
        labId: cases.find((item) => item.id === triageCaseId)!.labId,
        commandType: "welfare.case.triage", eventType: "triaged" as const,
        fromStatus: "open" as const, toStatus: "triaged" as const,
      },
      {
        actor: vet, assignment: vetAssignment, caseId: closureCaseId,
        labId: cases.find((item) => item.id === closureCaseId)!.labId,
        commandType: "welfare.case.close", eventType: "closed" as const,
        fromStatus: "under_observation" as const, toStatus: "closed" as const,
      },
    ]) {
      let receiptIdAfterRollback = "";
      await expect(rawReceipt({
        actor: standalone.actor, caseId: standalone.caseId, labId: standalone.labId,
        commandType: standalone.commandType,
        body: async (tx, receiptId) => {
          receiptIdAfterRollback = receiptId;
          const receipt = await tx.commandReceipt.findUniqueOrThrow({ where: { id: receiptId } });
          await tx.welfareCaseLifecycleEvent.create({ data: {
            id: `standalone-case-event-${randomUUID()}`, caseId: standalone.caseId, labId: standalone.labId,
            eventType: standalone.eventType, fromStatus: standalone.fromStatus, toStatus: standalone.toStatus,
            actorId: standalone.actor.id, actorAuthzVersion: standalone.actor.authzVersion,
            assurance: "synthetic_mfa", dutyAssignmentId: standalone.assignment.id,
            dutyAssignmentVersion: standalone.assignment.version, identityLinkId: standalone.actor.identityLinkId!,
            authenticatedAt: new Date(), commandReceiptId: receiptId, detail: { standalone: true },
          } });
          return tx.auditLog.create({ data: {
            id: `standalone-case-audit-${randomUUID()}`, actorId: standalone.actor.id,
            actorRole: standalone.actor.canonicalRole, labId: standalone.labId,
            requestId: receipt.requestId, commandReceiptId: receiptId, commandType: receipt.commandType,
            commandAggregateType: "welfare_case", commandAggregateId: standalone.caseId,
            entityType: "WelfareCase", entityId: standalone.caseId, action: standalone.eventType,
            newValue: { status: standalone.toStatus }, timestamp: new Date(),
          } });
        },
      })).rejects.toThrow(/exact same-receipt case mutation/i);
      expect(await prisma.commandReceipt.findUnique({ where: { id: receiptIdAfterRollback } })).toBeNull();
      expect(await prisma.welfareCaseLifecycleEvent.count({ where: { commandReceiptId: receiptIdAfterRollback } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { commandReceiptId: receiptIdAfterRollback } })).toBe(0);
    }
    expect(await prisma.welfareCase.findUniqueOrThrow({ where: { id: triageCaseId }, select: { status: true, version: true } })).toEqual({ status: "open", version: 1 });
    expect(await prisma.welfareCase.findUniqueOrThrow({ where: { id: closureCaseId }, select: { status: true, version: true } })).toEqual({ status: "under_observation", version: 2 });
  }, 120_000);

  it("permits cancellation only for pristine cases and preserves activity atomically", async () => {
    const [vet, officer] = await Promise.all([
      dutyActor("user-veterinarian-qa", "designated_veterinarian"),
      dutyActor("user-cmu-staff-qa", "welfare_officer"),
    ]);
    const observedCaseId = await openAnimalCase(officer, "animal-004");
    expect((await executeRecordWelfareObservationCommand({ actor: officer, caseId: observedCaseId, expectedVersion: 1, observedAt: new Date(), severity: "warning", operationalCode: "other", privateNote: "Synthetic activity makes cancellation unavailable", ...identity("observe-before-cancel") })).ok).toBe(true);
    const observedEventCount = await prisma.welfareCaseLifecycleEvent.count({ where: { caseId: observedCaseId } });
    expect(await executeCancelWelfareCaseCommand({ actor: officer, caseId: observedCaseId, expectedVersion: 2, cancelledAt: new Date(), cancellationCode: "not_a_case", cancellationReason: "Must be rejected after activity", ...identity("cancel-observed") })).toMatchObject({ ok: false, code: "case_not_pristine" });
    expect(await prisma.welfareCase.findUniqueOrThrow({ where: { id: observedCaseId }, select: { status: true, version: true } })).toEqual({ status: "under_observation", version: 2 });
    expect(await prisma.welfareCaseLifecycleEvent.count({ where: { caseId: observedCaseId } })).toBe(observedEventCount);

    const observedCase = await prisma.welfareCase.findUniqueOrThrow({ where: { id: observedCaseId }, select: { labId: true } });
    expect((await executeOpenWelfareEscalationCommand({
      actor: officer, caseId: observedCaseId, expectedVersion: 2, severity: "critical",
      operationalCode: "urgent_review", privateReason: "Synthetic immutable acknowledgement validation",
      openedAt: new Date(), ...identity("open-escalation-for-immutability"),
    })).ok).toBe(true);
    const escalation = await prisma.welfareEscalation.findFirstOrThrow({ where: { caseId: observedCaseId } });
    expect((await executeAcknowledgeWelfareEscalationCommand({
      actor: officer, caseId: observedCaseId, expectedVersion: 3,
      escalationId: escalation.id, expectedEscalationVersion: 1,
      acknowledgedAt: new Date(), ...identity("ack-escalation-for-immutability"),
    })).ok).toBe(true);
    await expect(rawReceipt({
      actor: officer, caseId: observedCaseId, labId: observedCase.labId,
      commandType: "welfare.escalation.resolve",
      body: (tx, receiptId) => tx.welfareEscalation.update({
        where: { id: escalation.id },
        data: {
          status: "resolved", acknowledgedAt: new Date(Date.now() + 1_000),
          acknowledgedById: vet.id, resolvedAt: new Date(), resolvedById: officer.id,
          resolutionNote: "Synthetic tamper attempt", lastCommandReceiptId: receiptId, version: { increment: 1 },
        },
      }),
    })).rejects.toThrow(/acknowledgement evidence is immutable/i);

    const treatedCaseId = await openAnimalCase(vet, "animal-005");
    expect((await executeTriageWelfareCaseCommand({ actor: vet, caseId: treatedCaseId, expectedVersion: 1, triagedAt: new Date(), ...identity("treated-triage") })).ok).toBe(true);
    const treatedCase = await prisma.welfareCase.findUniqueOrThrow({ where: { id: treatedCaseId }, select: { labId: true } });
    await expect(rawReceipt({
      actor: vet, caseId: treatedCaseId, labId: treatedCase.labId,
      commandType: "welfare.observation.record",
      body: (tx, receiptId) => tx.welfareCase.update({
        where: { id: treatedCaseId },
        data: {
          status: "under_observation", severity: "critical",
          operationalSummary: "Tampered operational summary", privateClinicalSummary: "Tampered private summary",
          triagedAt: new Date(Date.now() + 1_000), lastCommandReceiptId: receiptId, version: { increment: 1 },
        },
      }),
    })).rejects.toThrow(/immutable fields|triage evidence/i);
    expect((await executeProposeWelfareTreatmentOrderCommand({ actor: vet, caseId: treatedCaseId, expectedVersion: 2, medication: "Synthetic safety compound", dose: "1 unit", route: "synthetic route", frequency: "once", instructions: "Synthetic only", proposedAt: new Date(), ...identity("treated-order") })).ok).toBe(true);
    const order = await prisma.welfareTreatmentOrder.findFirstOrThrow({ where: { caseId: treatedCaseId } });
    expect((await executeApproveWelfareTreatmentOrderCommand({ actor: vet, caseId: treatedCaseId, expectedVersion: 3, orderId: order.id, expectedOrderVersion: 1, approvedAt: new Date(), ...identity("treated-approve") })).ok).toBe(true);
    await expect(rawReceipt({
      actor: vet, caseId: treatedCaseId, labId: treatedCase.labId,
      commandType: "welfare.treatment.administer",
      body: (tx, receiptId) => tx.welfareTreatmentOrder.update({
        where: { id: order.id },
        data: {
          status: "active", approvedAt: new Date(Date.now() + 1_000),
          approvedById: officer.id, lastCommandReceiptId: receiptId, version: { increment: 1 },
        },
      }),
    })).rejects.toThrow(/approval evidence is immutable/i);
    expect((await executeStopWelfareTreatmentOrderCommand({ actor: vet, caseId: treatedCaseId, expectedVersion: 4, orderId: order.id, expectedOrderVersion: 2, stoppedAt: new Date(), reason: "Synthetic course settled", ...identity("treated-stop") })).ok).toBe(true);
    const treatedEventCount = await prisma.welfareCaseLifecycleEvent.count({ where: { caseId: treatedCaseId } });
    expect(await executeCancelWelfareCaseCommand({ actor: vet, caseId: treatedCaseId, expectedVersion: 5, cancelledAt: new Date(), cancellationCode: "duplicate", cancellationReason: "Must be rejected after settled treatment", ...identity("cancel-treated") })).toMatchObject({ ok: false, code: "case_not_pristine" });
    expect(await prisma.welfareCase.findUniqueOrThrow({ where: { id: treatedCaseId }, select: { status: true, version: true } })).toEqual({ status: "under_observation", version: 5 });
    expect(await prisma.welfareCaseLifecycleEvent.count({ where: { caseId: treatedCaseId } })).toBe(treatedEventCount);

    const pristineCaseId = await openAnimalCase(officer, "animal-006");
    expect((await executeCancelWelfareCaseCommand({ actor: officer, caseId: pristineCaseId, expectedVersion: 1, cancelledAt: new Date(), cancellationCode: "duplicate", cancellationReason: "Synthetic duplicate record", ...identity("cancel-pristine") })).ok).toBe(true);
    expect(await prisma.welfareCase.findUniqueOrThrow({ where: { id: pristineCaseId }, select: { status: true } })).toEqual({ status: "cancelled" });
  }, 120_000);

  it("keeps lifecycle duty history valid after approved revocation and denies stale direct-ID preflight", async () => {
    const holderId = "user-lab-manager-qa";
    const userBeforeGrant = await prisma.user.findUniqueOrThrow({ where: { id: holderId }, select: { authzVersion: true } });
    const now = new Date();
    const grantRequested = await requestFacilityDutyGrant({
      targetUserId: holderId,
      duty: "designated_veterinarian",
      validFrom: now,
      validUntil: new Date(now.getTime() + 60 * 60 * 1_000),
      reason: "Synthetic M14 isolated duty-history validation",
    }, await adminActor("user-facility-admin-qa"));
    expect(grantRequested.ok).toBe(true);
    if (!grantRequested.ok) return;
    const grantRequest = await prisma.facilityDutyRequest.findUniqueOrThrow({
      where: { id: grantRequested.entityId }, select: { version: true },
    });
    const grantApproved = await decideFacilityDutyRequest({
      requestId: grantRequested.entityId,
      expectedVersion: grantRequest.version,
      decision: "approve",
    }, await adminActor("user-facility-admin-approver-qa"));
    expect(grantApproved.ok).toBe(true);

    const vetBefore = await dutyActor(holderId, "designated_veterinarian");
    const caseId = await openAnimalCase(vetBefore, "animal-007");
    const event = await prisma.welfareCaseLifecycleEvent.findFirstOrThrow({
      where: { actorId: holderId, caseId }, orderBy: { occurredAt: "asc" },
      select: { id: true, dutyAssignmentId: true, dutyAssignmentVersion: true },
    });
    const assignment = await prisma.facilityDutyAssignment.findUniqueOrThrow({ where: { id: event.dutyAssignmentId } });
    expect(assignment.version).toBe(event.dutyAssignmentVersion);
    const userBeforeRevoke = await prisma.user.findUniqueOrThrow({ where: { id: holderId }, select: { authzVersion: true } });
    expect(userBeforeRevoke.authzVersion).toBe(userBeforeGrant.authzVersion + 1);

    const requested = await requestFacilityDutyRevoke({
      assignmentId: assignment.id, assignmentVersion: assignment.version, reason: "Synthetic M14 revocation-history validation",
    }, await adminActor("user-facility-admin-qa"));
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    const request = await prisma.facilityDutyRequest.findUniqueOrThrow({ where: { id: requested.entityId }, select: { version: true } });
    const approved = await decideFacilityDutyRequest({ requestId: requested.entityId, expectedVersion: request.version, decision: "approve" }, await adminActor("user-facility-admin-approver-qa"));
    expect(approved.ok).toBe(true);

    const [assignmentAfter, userAfter, historicalEvent] = await Promise.all([
      prisma.facilityDutyAssignment.findUniqueOrThrow({ where: { id: assignment.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: holderId }, select: { authzVersion: true } }),
      prisma.welfareCaseLifecycleEvent.findUniqueOrThrow({ where: { id: event.id }, select: { dutyAssignmentVersion: true } }),
    ]);
    expect(assignmentAfter.revokedAt).not.toBeNull();
    expect(assignmentAfter.version).toBe(assignment.version + 1);
    expect(userAfter.authzVersion).toBe(userBeforeRevoke.authzVersion + 1);
    expect(historicalEvent.dutyAssignmentVersion).toBe(event.dutyAssignmentVersion);

    const existing = await executeOpenWelfareCaseCommand({ actor: vetBefore, ...identity("revoked-existing"), command: {
      subjectType: "animal", subjectId: "animal-008", expectedSubjectVersion: 1, severity: "warning",
      operationalSummary: "Must not disclose existing subject", privateClinicalSummary: "Must remain denied", openedAt: new Date(),
    } });
    const missing = await executeOpenWelfareCaseCommand({ actor: vetBefore, ...identity("revoked-missing"), command: {
      subjectType: "animal", subjectId: "missing-sensitive-subject", expectedSubjectVersion: 1, severity: "warning",
      operationalSummary: "Must not disclose missing subject", privateClinicalSummary: "Must remain denied", openedAt: new Date(),
    } });
    expect(existing).toMatchObject({ ok: false, code: "forbidden" });
    expect(missing).toMatchObject({ ok: false, code: "forbidden" });
    expect(existing.message).toBe(missing.message);
  }, 120_000);
});
