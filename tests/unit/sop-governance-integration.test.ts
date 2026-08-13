import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { getActorCapabilities } from "@/lib/capabilities";
import {
  authenticateOutboxWorker,
} from "@/lib/command-foundation";
import { prisma } from "@/lib/prisma";
import { runOutboxWorkerOnce } from "@/lib/notification-delivery";
import type { ResolvedActor } from "@/lib/session";
import { getSopWorkspace } from "@/lib/sop-read";
import {
  executeAcknowledgeSopCommand,
  executeAssignSopVersionCommand,
  executeCreateSopCommand,
  executeCreateSopVersionCommand,
  executeDecideSopVersionCommand,
  executeRevokeSopAssignmentCommand,
} from "@/lib/sop-write";

function actor(input: {
  id: string;
  role: "facility_admin" | "cmu_staff" | "lab_user";
  labId?: string;
  membershipRole?: "owner" | "manager" | "staff" | "viewer";
}): ResolvedActor {
  const activeMembership = input.role === "lab_user" && input.labId
    ? {
        labId: input.labId,
        labCode: input.labId,
        labName: input.labId,
        role: input.membershipRole ?? "staff",
      }
    : null;
  const capabilities = [...getActorCapabilities({ canonicalRole: input.role, activeMembership })];
  return {
    id: input.id,
    email: `${input.id}@example.test`,
    name: input.id,
    role: input.role === "facility_admin" ? "admin" : input.role === "cmu_staff" ? "colony_manager" : "animal_staff",
    databaseRole: input.role,
    canonicalRole: input.role,
    authzVersion: 1,
    activeLabId: activeMembership?.labId ?? null,
    activeMembership,
    memberships: activeMembership ? [activeMembership] : [],
    capabilities,
  };
}

describe("SOP governance commands", () => {
  it("preserves private lab SOPs and exact approved assignment acknowledgements", async () => {
    const facility = actor({ id: "sop-facility", role: "facility_admin" });
    const cmu = actor({ id: "sop-cmu", role: "cmu_staff" });
    const labManager = actor({ id: "sop-lab-a-manager", role: "lab_user", labId: "sop-lab-a", membershipRole: "manager" });
    const labApprover = actor({ id: "sop-lab-a-approver", role: "lab_user", labId: "sop-lab-a", membershipRole: "owner" });
    const labMember = actor({ id: "sop-lab-a-member", role: "lab_user", labId: "sop-lab-a", membershipRole: "staff" });
    const otherManager = actor({ id: "sop-lab-b-manager", role: "lab_user", labId: "sop-lab-b", membershipRole: "manager" });

    await prisma.user.createMany({
      data: [facility, cmu, labManager, labApprover, labMember, otherManager].map((entry) => ({
        id: entry.id,
        name: entry.name ?? entry.id,
        email: entry.email,
        passwordHash: "not-a-login-hash",
        role: entry.databaseRole,
      })),
      skipDuplicates: true,
    });
    await prisma.lab.createMany({
      data: [
        { id: "sop-lab-a", code: "SOPA", name: "SOP Lab A" },
        { id: "sop-lab-b", code: "SOPB", name: "SOP Lab B" },
      ],
      skipDuplicates: true,
    });
    await prisma.labMembership.createMany({
      data: [
        { id: "sop-membership-a-manager", labId: "sop-lab-a", userId: labManager.id, role: "manager" },
        { id: "sop-membership-a-approver", labId: "sop-lab-a", userId: labApprover.id, role: "owner" },
        { id: "sop-membership-b-for-a-manager", labId: "sop-lab-b", userId: labManager.id, role: "manager" },
        { id: "sop-membership-a-member", labId: "sop-lab-a", userId: labMember.id, role: "staff" },
        { id: "sop-membership-b-manager", labId: "sop-lab-b", userId: otherManager.id, role: "manager" },
      ],
      skipDuplicates: true,
    });

    const crossActiveLabCreate = await executeCreateSopCommand({
      actor: labManager,
      command: {
        scope: "lab",
        labId: "sop-lab-b",
        code: "SOPB-PRIVACY-001",
        title: "Cross-active-lab attempt",
        category: "Privacy",
        contentMarkdown: "A manager must switch active lab before creating a private SOP in another managed lab.",
        changeSummary: "Direct-ID active-lab regression",
      },
      idempotencyKey: "ac94a2fe-51ed-49c2-902c-d7cf5d493293",
      requestId: "20d22ee0-e7a0-4649-8e48-b75f21fc87ca",
    });
    expect(crossActiveLabCreate.ok).toBe(false);
    expect(crossActiveLabCreate.code).toBe("forbidden");
    expect(await prisma.sopDocument.count({ where: { code: "SOPB-PRIVACY-001" } })).toBe(0);

    const facilityCreate = await executeCreateSopCommand({
      actor: cmu,
      command: {
        scope: "facility",
        code: "FAC-WELFARE-001",
        title: "Facility welfare observation",
        category: "Welfare",
        contentMarkdown: "Observe each cage daily and record any welfare exception before leaving the room.",
        changeSummary: "Initial controlled version",
      },
      idempotencyKey: "a65d1a3b-fb08-4df2-9f4b-c7edbf5deac1",
      requestId: "408dd923-a8a6-4b18-843a-7f2e031e3798",
    });
    expect(facilityCreate.ok).toBe(true);
    if (!facilityCreate.ok) return;
    const facilityResult = facilityCreate.result as { documentId: string; versionId: string };
    const facilityReceipt = await prisma.commandReceipt.findFirstOrThrow({
      where: { actorId: cmu.id, commandType: "sop.create", idempotencyKey: "a65d1a3b-fb08-4df2-9f4b-c7edbf5deac1" },
    });
    expect(facilityReceipt.actorAuthzVersion).toBe(cmu.authzVersion);
    expect(facilityReceipt.databasePrincipal.length).toBeGreaterThan(0);
    await expect(prisma.commandReceipt.update({
      where: { id: facilityReceipt.id },
      data: { actorAuthzVersion: { increment: 1 } },
    })).rejects.toThrow(/audit identity is immutable/i);
    const facilityDocument = await prisma.sopDocument.findUniqueOrThrow({ where: { id: facilityResult.documentId } });

    const cmuSelfDecision = await executeDecideSopVersionCommand({
      actor: cmu,
      command: { sopId: facilityResult.documentId, versionId: facilityResult.versionId, decision: "approved", note: "Self approval attempt" },
      expectedVersion: facilityDocument.version,
      idempotencyKey: "df3ce5f0-101c-4c91-97cc-37399fc125b8",
      requestId: "18f1083c-4292-4ee0-85b6-11a23cca76e1",
    });
    expect(cmuSelfDecision.ok).toBe(false);

    const facilityDecision = await executeDecideSopVersionCommand({
      actor: facility,
      command: { sopId: facilityResult.documentId, versionId: facilityResult.versionId, decision: "approved", note: "Facility review complete" },
      expectedVersion: facilityDocument.version,
      idempotencyKey: "ffcb56c1-16e8-42ab-a717-f3828620d8f3",
      requestId: "e311cd55-340b-4fc9-b71b-b2e2c09ed842",
    });
    expect(facilityDecision.ok).toBe(true);
    const approvedFacility = await prisma.sopDocument.findUniqueOrThrow({ where: { id: facilityResult.documentId } });

    const assigned = await executeAssignSopVersionCommand({
      actor: cmu,
      command: {
        sopId: facilityResult.documentId,
        versionId: facilityResult.versionId,
        labId: "sop-lab-a",
        reason: "Required for all active animal room staff",
      },
      expectedVersion: approvedFacility.version,
      idempotencyKey: "c6d30a18-35b7-426e-8283-140e3a44020e",
      requestId: "d2ae080a-cfc7-4511-a9ab-f63d90696b44",
    });
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    const assignmentId = (assigned.result as { assignmentId: string }).assignmentId;
    const assignedRecord = await prisma.sopAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: { sopVersion: true },
    });

    const acknowledged = await executeAcknowledgeSopCommand({
      actor: labMember,
      command: {
        assignmentId,
        expectedVersion: assignedRecord.version,
        sopVersionId: assignedRecord.sopVersionId,
        contentHash: assignedRecord.sopVersion.contentHash,
        attestationConfirmed: true,
      },
      idempotencyKey: "53de008c-8fc3-4fce-89df-6fe2e342059f",
      requestId: "0b6d3cd5-8224-4e4c-8939-0a9f2d38596c",
    });
    expect(acknowledged.ok, JSON.stringify(acknowledged)).toBe(true);
    const managerAcknowledgement = await executeAcknowledgeSopCommand({
      actor: labManager,
      command: {
        assignmentId,
        expectedVersion: assignedRecord.version,
        sopVersionId: assignedRecord.sopVersionId,
        contentHash: assignedRecord.sopVersion.contentHash,
        attestationConfirmed: true,
      },
      idempotencyKey: "8f6c589a-92f3-40bc-97b4-6bc118df09ae",
      requestId: "26f8df79-eb32-40a3-9dd6-a8cfdc377680",
    });
    expect(managerAcknowledgement.ok).toBe(true);
    const acknowledgement = await prisma.sopAcknowledgement.findFirstOrThrow({ where: { assignmentId, userId: labMember.id } });
    const assignedVersion = await prisma.sopVersion.findUniqueOrThrow({ where: { id: facilityResult.versionId } });
    expect(acknowledgement.contentHash).toBe(assignedVersion.contentHash);

    const beforeVersion2 = await prisma.sopDocument.findUniqueOrThrow({ where: { id: facilityResult.documentId } });
    const version2 = await executeCreateSopVersionCommand({
      actor: cmu,
      command: {
        sopId: facilityResult.documentId,
        title: "Facility welfare observation draft two",
        category: "Welfare draft",
        contentMarkdown: "This pending second draft must not replace the controlled title or become visible to ordinary lab readers.",
        changeSummary: "Pending draft two",
      },
      expectedVersion: beforeVersion2.version,
      idempotencyKey: "0e0a234b-97df-43d9-85dd-e77e1f6cfec7",
      requestId: "f2136ed2-9c3b-4629-999e-991d2348cb40",
    });
    expect(version2.ok).toBe(true);
    if (!version2.ok) return;
    const version2Result = version2.result as { versionId: string };

    const afterVersion2 = await prisma.sopDocument.findUniqueOrThrow({ where: { id: facilityResult.documentId } });
    expect(afterVersion2.title).toBe("Facility welfare observation");
    const version3 = await executeCreateSopVersionCommand({
      actor: cmu,
      command: {
        sopId: facilityResult.documentId,
        title: "Facility welfare observation controlled three",
        category: "Welfare",
        contentMarkdown: "Observe each cage daily, record welfare exceptions, and escalate urgent findings using the controlled facility pathway.",
        changeSummary: "Controlled third version",
      },
      expectedVersion: afterVersion2.version,
      idempotencyKey: "82ff0c1e-7bb5-4dfc-86d4-9c480efbd9c4",
      requestId: "451ff112-fddd-44a3-981b-98ac48956c82",
    });
    expect(version3.ok).toBe(true);
    if (!version3.ok) return;
    const version3Result = version3.result as { versionId: string };

    const beforeVersion3Decision = await prisma.sopDocument.findUniqueOrThrow({ where: { id: facilityResult.documentId } });
    const approveVersion3 = await executeDecideSopVersionCommand({
      actor: facility,
      command: {
        sopId: facilityResult.documentId,
        versionId: version3Result.versionId,
        decision: "approved",
        note: "Third version independently reviewed",
      },
      expectedVersion: beforeVersion3Decision.version,
      idempotencyKey: "ee8f7be4-c41a-4733-b848-45bdf1c75bb8",
      requestId: "5a488b2a-d315-46e2-8fb1-ded46ce40fce",
    });
    expect(approveVersion3.ok).toBe(true);

    const afterVersion3Decision = await prisma.sopDocument.findUniqueOrThrow({ where: { id: facilityResult.documentId } });
    const regressToVersion2 = await executeDecideSopVersionCommand({
      actor: facility,
      command: {
        sopId: facilityResult.documentId,
        versionId: version2Result.versionId,
        decision: "approved",
        note: "Attempt historical approval",
      },
      expectedVersion: afterVersion3Decision.version,
      idempotencyKey: "0f8f34b9-1621-4562-a466-5fd241aec2db",
      requestId: "c484e536-d086-4d07-8879-73577618a41b",
    });
    expect(regressToVersion2.ok).toBe(false);
    expect(regressToVersion2.code).toBe("version_regression");

    const [ordinaryAfterDraft, governanceAfterDraft] = await Promise.all([
      getSopWorkspace(labMember),
      getSopWorkspace(facility),
    ]);
    const ordinaryFacilityDocument = ordinaryAfterDraft.documents.find((document) => document.id === facilityResult.documentId);
    const governanceFacilityDocument = governanceAfterDraft.documents.find((document) => document.id === facilityResult.documentId);
    expect(ordinaryFacilityDocument?.title).toBe("Facility welfare observation controlled three");
    expect(ordinaryFacilityDocument?.versions.some((version) => version.id === version2Result.versionId)).toBe(false);
    expect(ordinaryFacilityDocument?.assignments[0]?.acknowledgementCount).toBe(2);
    expect(ordinaryFacilityDocument?.assignments[0]?.acknowledgements).toHaveLength(1);
    expect(ordinaryFacilityDocument?.assignments[0]?.acknowledgements[0]?.userId).toBe(labMember.id);
    expect(governanceFacilityDocument?.versions.some((version) => version.id === version2Result.versionId)).toBe(true);

    const historicalAssignment = await executeAssignSopVersionCommand({
      actor: cmu,
      command: {
        sopId: facilityResult.documentId,
        versionId: facilityResult.versionId,
        labId: "sop-lab-a",
        reason: "Attempt to assign obsolete version one",
      },
      expectedVersion: afterVersion3Decision.version,
      idempotencyKey: "228ff6d0-35b3-47f2-88d9-48233e24cf15",
      requestId: "f503b20f-574b-450f-8587-951b01250acd",
    });
    expect(historicalAssignment.ok).toBe(false);
    expect(historicalAssignment.code).toBe("not_current");

    await expect(prisma.sopAssignment.create({
      data: {
        id: "sop-forged-assignment",
        sopId: facilityResult.documentId,
        sopVersionId: version3Result.versionId,
        labId: "sop-lab-b",
        assignedById: cmu.id,
        reason: "Forged direct assignment",
      },
    })).rejects.toThrow("active command receipt");

    await expect(prisma.$transaction(async (tx) => {
      const receiptId = "sop-historical-assignment-receipt";
      await tx.commandReceipt.create({
        data: {
          id: receiptId,
          actorId: cmu.id,
          commandType: "sop.assign",
          idempotencyKey: "sop-historical-assignment-idempotency",
          requestHash: "2".repeat(64),
          requestId: "sop-historical-assignment-request",
          aggregateType: "sop_document",
          aggregateId: facilityResult.documentId,
          expectedVersion: afterVersion3Decision.version,
        },
      });
      await tx.$queryRaw(Prisma.sql`
        SELECT set_config('mcm.sop_actor_id', ${cmu.id}, true),
               set_config('mcm.sop_command_type', 'sop.assign', true),
               set_config('mcm.sop_receipt_id', ${receiptId}, true)
      `);
      await tx.$queryRaw(Prisma.sql`
        SELECT "sop_assign_version"(
          'sop-historical-assignment', ${facilityResult.documentId}, ${facilityResult.versionId},
          'sop-lab-b', CAST(NULL AS TIMESTAMP(3)), 'Historical assignment attempt', ${cmu.id}, CAST(CURRENT_TIMESTAMP AS TIMESTAMP(3))
        )
      `);
    })).rejects.toThrow("current approved exact version");

    const beforeCurrentAssignment = await prisma.sopDocument.findUniqueOrThrow({ where: { id: facilityResult.documentId } });
    const currentAssignment = await executeAssignSopVersionCommand({
      actor: cmu,
      command: {
        sopId: facilityResult.documentId,
        versionId: version3Result.versionId,
        labId: "sop-lab-a",
        reason: "Supersede Lab A with controlled version three",
      },
      expectedVersion: beforeCurrentAssignment.version,
      idempotencyKey: "b8f464d2-52ed-4f0f-b231-f34b2440a893",
      requestId: "9317fc93-fee6-4fa2-a8d7-85b7b37bd293",
    });
    expect(currentAssignment.ok).toBe(true);
    if (!currentAssignment.ok) return;
    const currentAssignmentId = (currentAssignment.result as { assignmentId: string }).assignmentId;
    expect((await prisma.outboxMessage.findFirstOrThrow({ where: { aggregateId: assignmentId } })).status).toBe("cancelled");

    const beforeLabBAssignment = await prisma.sopDocument.findUniqueOrThrow({ where: { id: facilityResult.documentId } });
    const labBAssignment = await executeAssignSopVersionCommand({
      actor: cmu,
      command: {
        sopId: facilityResult.documentId,
        versionId: version3Result.versionId,
        labId: "sop-lab-b",
        reason: "Assign controlled version three to Lab B",
      },
      expectedVersion: beforeLabBAssignment.version,
      idempotencyKey: "9b6d1814-9236-4683-9f99-eafaf0c2d567",
      requestId: "3e030e19-b034-436c-9d59-f2fa5e0d342e",
    });
    expect(labBAssignment.ok).toBe(true);
    if (!labBAssignment.ok) return;
    const labBAssignmentId = (labBAssignment.result as { assignmentId: string }).assignmentId;
    const labBAssignmentRecord = await prisma.sopAssignment.findUniqueOrThrow({ where: { id: labBAssignmentId } });
    const crossActiveLabRevoke = await executeRevokeSopAssignmentCommand({
      actor: labManager,
      command: {
        assignmentId: labBAssignmentId,
        expectedVersion: labBAssignmentRecord.version,
        reason: "Attempt from the wrong active lab",
      },
      idempotencyKey: "cb91b7f3-1d7f-4cde-9407-3260e53593fc",
      requestId: "f05d046e-b18a-41b1-af45-a21ad034714a",
    });
    expect(crossActiveLabRevoke.ok).toBe(false);
    expect(crossActiveLabRevoke.code).toBe("not_found");

    const documentBeforeRawRegression = await prisma.sopDocument.findUniqueOrThrow({ where: { id: facilityResult.documentId } });
    await expect(prisma.$transaction(async (tx) => {
      const receiptId = "sop-raw-regression-receipt";
      await tx.commandReceipt.create({
        data: {
          id: receiptId,
          actorId: facility.id,
          commandType: "sop.version.decide",
          idempotencyKey: "sop-raw-regression-idempotency",
          requestHash: "3".repeat(64),
          requestId: "sop-raw-regression-request",
          aggregateType: "sop_document",
          aggregateId: facilityResult.documentId,
          expectedVersion: documentBeforeRawRegression.version,
        },
      });
      await tx.$queryRaw(Prisma.sql`
        SELECT set_config('mcm.sop_actor_id', ${facility.id}, true),
               set_config('mcm.sop_command_type', 'sop.version.decide', true),
               set_config('mcm.sop_receipt_id', ${receiptId}, true)
      `);
      await tx.$queryRaw(Prisma.sql`
        SELECT "sop_decide_version"(
          'sop-raw-regression-approval', ${facilityResult.documentId}, ${version2Result.versionId},
          CAST('approved' AS "SopApprovalDecision"), 'Raw regression attempt', ${facility.id}
        )
      `);
    })).rejects.toThrow("monotonically");

    await expect(prisma.sopVersionApproval.create({
      data: {
        id: "sop-forged-approval",
        sopId: facilityResult.documentId,
        sopVersionId: version2Result.versionId,
        decision: "approved",
        decidedById: facility.id,
        note: "Forged raw approval",
      },
    })).rejects.toThrow("active command receipt");

    const documentBeforeBadHash = await prisma.sopDocument.findUniqueOrThrow({ where: { id: facilityResult.documentId } });
    const nextVersionNumber = (await prisma.sopVersion.aggregate({
      where: { sopId: facilityResult.documentId },
      _max: { versionNumber: true },
    }))._max.versionNumber! + 1;
    await expect(prisma.$transaction(async (tx) => {
      const receiptId = "sop-wrong-hash-receipt";
      await tx.commandReceipt.create({
        data: {
          id: receiptId,
          actorId: cmu.id,
          commandType: "sop.version.create",
          idempotencyKey: "sop-wrong-hash-idempotency",
          requestHash: "1".repeat(64),
          requestId: "sop-wrong-hash-request",
          aggregateType: "sop_document",
          aggregateId: facilityResult.documentId,
          expectedVersion: documentBeforeBadHash.version,
        },
      });
      await tx.$queryRaw(Prisma.sql`
        SELECT set_config('mcm.sop_actor_id', ${cmu.id}, true),
               set_config('mcm.sop_command_type', 'sop.version.create', true),
               set_config('mcm.sop_receipt_id', ${receiptId}, true)
      `);
      await tx.$queryRaw(Prisma.sql`
        SELECT "sop_create_version"(
          'sop-wrong-hash-version', ${facilityResult.documentId}, CAST(${nextVersionNumber} AS INTEGER),
          'Wrong hash title', 'Welfare', 'This content deliberately carries a syntactically valid but incorrect digest.',
          ${"f".repeat(64)}, 'Wrong hash attempt', ${cmu.id}
        )
      `);
    })).rejects.toThrow("content hash");

    const revokeLabB = await executeRevokeSopAssignmentCommand({
      actor: cmu,
      command: {
        assignmentId: labBAssignmentId,
        expectedVersion: labBAssignmentRecord.version,
        reason: "Remove Lab B assignment before delivery",
      },
      idempotencyKey: "3948b365-f3ad-43b5-aa5a-52c6b35a4ee2",
      requestId: "8fa0894b-e8c6-4eae-8b4d-791bb3b5b424",
    });
    expect(revokeLabB.ok).toBe(true);
    expect((await prisma.outboxMessage.findFirstOrThrow({ where: { aggregateId: labBAssignmentId } })).status).toBe("cancelled");

    await prisma.user.update({ where: { id: cmu.id }, data: { active: false } });
    process.env.OUTBOX_WORKER_TOKEN_SOP_DELIVERY = "sop-test-worker-token-0123456789abcdef";
    const worker = authenticateOutboxWorker({
      workerId: "sop-test-worker",
      workerType: "sop_delivery",
      token: process.env.OUTBOX_WORKER_TOKEN_SOP_DELIVERY,
    });
    expect(worker).not.toBeNull();
    if (!worker) return;
    const acknowledgementRun = await runOutboxWorkerOnce({
      workerType: "sop_delivery",
      workerId: worker.id,
      token: process.env.OUTBOX_WORKER_TOKEN_SOP_DELIVERY,
      batchSize: 10,
      concurrency: 1,
    });
    expect(acknowledgementRun).toMatchObject({
      outcome: "completed",
      exitCode: 0,
      claimed: 1,
      delivered: 1,
      cancelled: 0,
    });
    await expect(prisma.outboxMessage.findFirstOrThrow({ where: { aggregateId: currentAssignmentId } })).resolves.toMatchObject({
      status: "delivered",
      attemptCount: 1,
    });

    const beforePayloadValidationAssignment = await prisma.sopDocument.findUniqueOrThrow({ where: { id: facilityResult.documentId } });
    const payloadValidationAssignment = await executeAssignSopVersionCommand({
      actor: facility,
      command: {
        sopId: facilityResult.documentId,
        versionId: version3Result.versionId,
        labId: "sop-lab-a",
        reason: "Create a delivery payload validation case",
      },
      expectedVersion: beforePayloadValidationAssignment.version,
      idempotencyKey: "333686ab-f0c0-4bc6-a5e0-15ed5469ff78",
      requestId: "3bddbe18-919a-42cd-bf3a-729beebcf136",
    });
    expect(payloadValidationAssignment.ok).toBe(true);
    if (!payloadValidationAssignment.ok) return;
    const payloadValidationAssignmentId = (payloadValidationAssignment.result as { assignmentId: string }).assignmentId;
    const payloadMessage = await prisma.outboxMessage.findFirstOrThrow({ where: { aggregateId: payloadValidationAssignmentId } });
    await prisma.outboxMessage.update({
      where: { id: payloadMessage.id },
      data: {
        payload: {
          assignmentId: payloadValidationAssignmentId,
          sopId: facilityResult.documentId,
          sopVersionId: version3Result.versionId,
          contentHash: "0".repeat(64),
          labId: "sop-lab-a",
          dueAt: null,
        },
      },
    });
    const staleAcknowledgementRun = await runOutboxWorkerOnce({
      workerType: "sop_delivery",
      workerId: worker.id,
      token: process.env.OUTBOX_WORKER_TOKEN_SOP_DELIVERY,
      batchSize: 10,
      concurrency: 1,
    });
    expect(staleAcknowledgementRun).toMatchObject({
      outcome: "completed",
      claimed: 0,
      delivered: 0,
      cancelled: 0,
    });
    expect((await prisma.outboxMessage.findUniqueOrThrow({ where: { id: payloadMessage.id } })).status).toBe("cancelled");

    const labCreate = await executeCreateSopCommand({
      actor: labManager,
      command: {
        scope: "lab",
        labId: "sop-lab-a",
        code: "LAB-A-PRIVATE-001",
        title: "Private colony handling note",
        category: "Lab method",
        contentMarkdown: "Use the lab-specific handling sequence recorded in this controlled private document.",
        changeSummary: "Initial private lab version",
      },
      idempotencyKey: "230a90c9-18b1-4f3a-903c-d5d7443e52cd",
      requestId: "12264371-2e4e-47ca-aa7f-e0270fa09534",
    });
    expect(labCreate.ok).toBe(true);
    if (!labCreate.ok) return;
    const labResult = labCreate.result as { documentId: string; versionId: string };
    const labDocument = await prisma.sopDocument.findUniqueOrThrow({ where: { id: labResult.documentId } });
    const labDecision = await executeDecideSopVersionCommand({
      actor: labManager,
      command: { sopId: labResult.documentId, versionId: labResult.versionId, decision: "approved", note: "Lab manager publication" },
      expectedVersion: labDocument.version,
      idempotencyKey: "95c90a2a-9396-460e-b490-6b7217c644be",
      requestId: "205520d0-34b9-4360-a18a-d7a662a94bb4",
    });
    expect(labDecision.ok).toBe(false);
    expect(labDecision.code).toBe("forbidden");
    const independentLabDecision = await executeDecideSopVersionCommand({
      actor: labApprover,
      command: { sopId: labResult.documentId, versionId: labResult.versionId, decision: "approved", note: "Independent lab owner publication" },
      expectedVersion: labDocument.version,
      idempotencyKey: "8a6ae72d-9da6-455e-8e72-dc1824b60f86",
      requestId: "6f06dc28-0ef9-47a1-a220-7990bb3b47a2",
    });
    expect(independentLabDecision.ok).toBe(true);

    const [labAView, labBView, facilityView] = await Promise.all([
      getSopWorkspace(labManager),
      getSopWorkspace(otherManager),
      getSopWorkspace(facility),
    ]);
    expect(labAView.documents.some((document) => document.id === labResult.documentId)).toBe(true);
    expect(labBView.documents.some((document) => document.id === labResult.documentId)).toBe(false);
    expect(facilityView.documents.some((document) => document.id === labResult.documentId)).toBe(false);
    expect(labAView.documents
      .find((document) => document.id === facilityResult.documentId)
      ?.assignments.find((assignment) => !assignment.revokedAt)
      ?.acknowledgedByMe).toBe(false);

    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE "SopVersion" SET title = 'tampered' WHERE id = '${facilityResult.versionId}'`);
      throw new Error("MUTATION_SUCCEEDED");
    })).rejects.toThrow("immutable SOP governance ledger");

    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('TRUNCATE TABLE "SopAcknowledgement"');
      throw new Error("TRUNCATE_SUCCEEDED");
    })).rejects.toThrow("immutable SOP governance ledger");

    const currentAssignmentRecord = await prisma.sopAssignment.findUniqueOrThrow({
      where: { id: payloadValidationAssignmentId },
      include: { sopVersion: true },
    });
    await expect(prisma.sopAcknowledgement.create({
      data: {
        id: "sop-forged-raw-ack",
        assignmentId: payloadValidationAssignmentId,
        sopId: facilityResult.documentId,
        sopVersionId: currentAssignmentRecord.sopVersionId,
        labId: "sop-lab-a",
        userId: labMember.id,
        contentHash: currentAssignmentRecord.sopVersion.contentHash,
        attestation: "I reviewed and understand this exact SOP version.",
      },
    })).rejects.toThrow("active command receipt");
  });
});
