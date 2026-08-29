import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  canonicalJson,
  canonicalJsonHash,
} from "@/lib/command-foundation";
import { assertDestructiveSeedAllowed } from "@/lib/destructive-seed-guard";
import {
  executePlanExperimentAssignmentsCommand,
  executePromoteExperimentAssignmentsCommand,
  executeReserveAnimalForExperimentCommand,
} from "@/lib/experiment-assignment-write";
import {
  executeCreateExperimentCommand,
  executeTransitionExperimentCommand,
  executeUpdateExperimentCommand,
} from "@/lib/experiments-write";
import { prisma } from "@/lib/prisma";
import {
  executeCreateProtocolDraftCommand,
  executeTransitionProtocolAuthorizationCommand,
} from "@/lib/protocol-governance";
import type { ResolvedActor } from "@/lib/session";
import { seedDatabase } from "../../prisma/seed-database";
import { DEMO_ADMIN_IDENTITY_LINK_ID } from "../../prisma/seed-demo-compliance";

const runId = randomUUID();

async function userActor(input: {
  id: "user-admin" | "user-manager";
  canonicalRole: "facility_admin" | "cmu_staff";
}): Promise<ResolvedActor> {
  const [user, identity] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: input.id },
      select: { name: true, email: true, role: true, authzVersion: true },
    }),
    input.id === "user-admin"
      ? prisma.externalIdentityLink.findUniqueOrThrow({
          where: { id: DEMO_ADMIN_IDENTITY_LINK_ID },
          select: { id: true },
        })
      : prisma.externalIdentityLink.findFirstOrThrow({
          where: { userId: input.id, active: true, revokedAt: null },
          select: { id: true },
        }),
  ]);
  return {
    id: input.id,
    email: user.email,
    name: user.name,
    role: input.canonicalRole === "facility_admin" ? "admin" : "colony_manager",
    databaseRole: user.role,
    canonicalRole: input.canonicalRole,
    authzVersion: user.authzVersion,
    authMethod: "synthetic_mfa",
    assurance: "synthetic_mfa",
    authenticatedAt: new Date().toISOString(),
    identityLinkId: identity.id,
    activeDuties:
      input.canonicalRole === "cmu_staff" ? ["protocol_reviewer"] : [],
    activeLabId: null,
    activeMembership: null,
    memberships: [],
    capabilities: [],
  };
}

async function protocolCreatorActor(): Promise<ResolvedActor> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: "user-researcher" },
    select: { name: true, email: true, role: true, authzVersion: true },
  });
  const membership = {
    labId: "lab-microglia",
    labName: "Microglia Imaging Lab",
    labCode: "LAB-MICRO",
    role: "manager" as const,
  };
  return {
    id: "user-researcher",
    email: user.email,
    name: user.name,
    role: "animal_staff",
    databaseRole: user.role,
    canonicalRole: "lab_user",
    authzVersion: user.authzVersion,
    activeLabId: membership.labId,
    activeMembership: membership,
    memberships: [membership],
    capabilities: [],
  };
}

describe.sequential("M13 live PostgreSQL trigger contract", () => {
  beforeAll(async () => seedDatabase(), 120_000);
  afterAll(async () => prisma.$disconnect());

  it("runs only against an explicitly guarded disposable loopback database", async () => {
    expect(() => assertDestructiveSeedAllowed()).not.toThrow();
    const [database] = await prisma.$queryRaw<Array<{ name: string; host: string | null }>>`
      SELECT current_database() AS name, inet_server_addr()::text AS host
    `;
    expect(database?.name).toMatch(/^mcm_test_[a-z0-9_]+$/);
    expect([null, "127.0.0.1", "::1"]).toContain(
      database?.host?.replace(/\/\d+$/, "") ?? null,
    );
  });

  it("does not honor the destructive flag unless the guarded helper approves it", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'false'");
      const [disabled] = await tx.$queryRaw<Array<{ allowed: boolean }>>`
        SELECT "mcm_m13_destructive_seed_allowed"() AS allowed
      `;
      expect(disabled?.allowed).toBe(false);
      await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'");
      const [guarded] = await tx.$queryRaw<Array<{ allowed: boolean }>>`
        SELECT "mcm_m13_destructive_seed_allowed"() AS allowed
      `;
      expect(guarded?.allowed).toBe(true);
    });
  });

  it("installs deferred exact-allocation pairing and immutable evidence guards", async () => {
    const triggers = await prisma.$queryRaw<Array<{ name: string; deferred: boolean }>>`
      SELECT trigger.tgname AS name, trigger.tginitdeferred AS deferred
      FROM pg_trigger trigger
      JOIN pg_class relation ON relation.oid = trigger.tgrelid
      WHERE NOT trigger.tgisinternal
        AND trigger.tgname IN (
          'ProtocolCountLedger_history_pair',
          'ProtocolCountAllocation_history_pair',
          'ComplianceEvidenceSnapshot_guard',
          'LabTransferRequest_compliance_evidence_guard',
          'ProcedureOccurrence_compliance_link_guard'
        )
    `;
    expect(new Set(triggers.map((trigger) => trigger.name))).toEqual(new Set([
      "ProtocolCountLedger_history_pair",
      "ProtocolCountAllocation_history_pair",
      "ComplianceEvidenceSnapshot_guard",
      "LabTransferRequest_compliance_evidence_guard",
      "ProcedureOccurrence_compliance_link_guard",
    ]));
    expect(triggers.find((trigger) => trigger.name === "ProtocolCountLedger_history_pair")?.deferred).toBe(true);
    expect(triggers.find((trigger) => trigger.name === "ProtocolCountAllocation_history_pair")?.deferred).toBe(true);
  });

  it("exposes the exact allocation state and keyed multi-snapshot uniqueness", async () => {
    const constraints = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT conname AS name FROM pg_constraint
      WHERE conname IN (
        'ProtocolCountAllocation_state_check',
        'ProtocolCountAllocationHistory_count_check',
        'ComplianceEvidenceSnapshot_receipt_evidence_key'
      )
    `;
    expect(new Set(constraints.map((constraint) => constraint.name))).toEqual(new Set([
      "ProtocolCountAllocation_state_check",
      "ProtocolCountAllocationHistory_count_check",
      "ComplianceEvidenceSnapshot_receipt_evidence_key",
    ]));
  });

  it("rejects sealing with a completed creation receipt from an earlier transaction", async () => {
    const protocolCreator = await protocolCreatorActor();
    const suffix = runId.slice(0, 8).toUpperCase();
    const authorizationId = `m13-stale-seal-${runId}`;
    const versionId = `${authorizationId}-v1`;
    const receiptId = `${authorizationId}-receipt`;
    const validFrom = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const validUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000);
    const content = {
      labId: "lab-microglia",
      protocolCode: `M13-STALE-${suffix}`,
      title: "Completed receipt sealing rejection fixture",
      summary: "A complete canonical scope intentionally left unsealed.",
      validFrom: validFrom.toISOString(),
      validUntil: validUntil.toISOString(),
      approvedAnimalCount: 1,
      projectIds: ["project-micro"],
      experimentIds: [],
      strainIds: ["strain-tdt"],
      procedureCodes: ["animal-use"],
      personnel: [
        { userId: protocolCreator.id, roleLabel: "principal_investigator" },
      ],
      policyVersion: "synthetic-fail-closed-v1",
    };

    await prisma.$transaction(async (tx) => {
      await tx.commandReceipt.create({
        data: {
          id: receiptId,
          actorId: protocolCreator.id,
          actorAuthzVersion: protocolCreator.authzVersion,
          labId: "lab-microglia",
          commandType: "protocol_authorization.draft.create",
          idempotencyKey: receiptId,
          requestHash: canonicalJsonHash(content),
          requestId: receiptId,
          aggregateType: "protocol_authorization",
          aggregateId: authorizationId,
        },
      });
      await tx.$queryRaw(
        Prisma.sql`SELECT set_config('mcm.audit_receipt_id', ${receiptId}, true)`,
      );
      await tx.protocolAuthorization.create({
        data: {
          id: authorizationId,
          labId: "lab-microglia",
          protocolCode: content.protocolCode,
          title: content.title,
          status: "draft",
          createdById: protocolCreator.id,
        },
      });
      await tx.protocolAuthorizationVersion.create({
        data: {
          id: versionId,
          authorizationId,
          versionNumber: 1,
          contentHash: canonicalJsonHash(content),
          contentPayload: canonicalJson(content),
          policyVersion: content.policyVersion,
          validFrom,
          validUntil,
          approvedAnimalCount: content.approvedAnimalCount,
          summary: content.summary,
          createdById: protocolCreator.id,
          creationCommandReceiptId: receiptId,
        },
      });
      await tx.protocolProjectBinding.create({
        data: {
          id: `${versionId}-project`,
          authorizationVersionId: versionId,
          labId: content.labId,
          projectId: content.projectIds[0],
        },
      });
      await tx.protocolStrainBinding.create({
        data: {
          id: `${versionId}-strain`,
          authorizationVersionId: versionId,
          labId: content.labId,
          strainId: content.strainIds[0],
        },
      });
      await tx.protocolProcedureBinding.create({
        data: {
          id: `${versionId}-procedure`,
          authorizationVersionId: versionId,
          labId: content.labId,
          procedureCode: content.procedureCodes[0],
        },
      });
      await tx.protocolPersonnelBinding.create({
        data: {
          id: `${versionId}-personnel`,
          authorizationVersionId: versionId,
          labId: content.labId,
          userId: protocolCreator.id,
          roleLabel: "principal_investigator",
        },
      });
      await tx.protocolCountLedger.create({
        data: {
          id: `${versionId}-ledger`,
          authorizationVersionId: versionId,
          approvedCount: content.approvedAnimalCount,
        },
      });
      await tx.commandReceipt.update({
        where: { id: receiptId },
        data: {
          status: "succeeded",
          result: { authorizationId, versionId },
          completedAt: new Date(),
        },
      });
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT set_config('mcm.audit_receipt_id', ${receiptId}, true)`,
        );
        await tx.protocolAuthorizationVersion.update({
          where: { id: versionId },
          data: { scopeSealedAt: new Date() },
        });
      }),
    ).rejects.toThrow(/Protocol version sealing receipt is not current/);
    expect(
      await prisma.protocolAuthorizationVersion.findUnique({
        where: { id: versionId },
        select: { scopeSealedAt: true },
      }),
    ).toEqual({ scopeSealedAt: null });
  });

  it("creates, seals, and activates a protocol while rejecting a mismatched canonical root", async () => {
    const creator = await userActor({
      id: "user-admin",
      canonicalRole: "facility_admin",
    });
    await prisma.labMembership.update({
      where: { id: "lab-member-researcher-micro" },
      data: { role: "manager" },
    });
    const protocolCreator = await protocolCreatorActor();
    const reviewer = await userActor({
      id: "user-manager",
      canonicalRole: "cmu_staff",
    });
    const suffix = runId.slice(0, 8).toUpperCase();
    const today = new Date().toISOString().slice(0, 10);
    const plannedEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 10);
    const experimentResults = await Promise.all(
      ["DIRECT", "COHORT"].map((kind) =>
        executeCreateExperimentCommand({
          actor: creator,
          command: {
            labId: "lab-microglia",
            projectId: "project-micro",
            experimentCode: `M13-${kind}-${suffix}`,
            title: `${kind} lifecycle settlement verification`,
            plannedStartAt: today,
            plannedEndAt: plannedEnd,
          },
          idempotencyKey: `m13-${kind.toLowerCase()}-${runId}`,
          requestId: `m13-${kind.toLowerCase()}-${runId}`,
        }),
      ),
    );
    for (const result of experimentResults) {
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
    if (!experimentResults[0].ok || !experimentResults[1].ok) {
      throw new Error("Experiment fixtures could not be created.");
    }
    const directExperimentId = (
      experimentResults[0].result as { experimentId: string }
    ).experimentId;
    const cohortExperimentId = (
      experimentResults[1].result as { experimentId: string }
    ).experimentId;
    const validFrom = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const validUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000);
    const created = await executeCreateProtocolDraftCommand({
      actor: protocolCreator,
      command: {
        labId: "lab-microglia",
        protocolCode: `M13-${suffix}`,
        title: "M13 live protocol sealing verification",
        validFrom,
        validUntil,
        approvedAnimalCount: 10,
        summary: "Live trigger and lifecycle settlement verification.",
        projectIds: ["project-micro"],
        experimentIds: [directExperimentId, cohortExperimentId],
        strainIds: ["strain-tdt"],
        procedureCodes: ["animal-use"],
        personnel: [
          { userId: creator.id, roleLabel: "principal_investigator" },
          { userId: creator.id, roleLabel: "named_researcher" },
        ],
      },
      idempotencyKey: `m13-protocol-create-${runId}`,
      requestId: `m13-protocol-create-${runId}`,
    });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    if (!created.ok) throw new Error(created.message);
    const createdProtocol = created.result as {
      authorizationId: string;
      versionId: string;
      version: number;
    };
    const activated = await executeTransitionProtocolAuthorizationCommand({
      actor: reviewer,
      command: {
        authorizationId: createdProtocol.authorizationId,
        labId: "lab-microglia",
        status: "active",
        reason: "Independent live trigger verification.",
      },
      expectedVersion: createdProtocol.version,
      idempotencyKey: `m13-protocol-activate-${runId}`,
      requestId: `m13-protocol-activate-${runId}`,
    });
    expect(activated.ok, JSON.stringify(activated)).toBe(true);
    expect(
      await prisma.protocolAuthorization.findUnique({
        where: { id: createdProtocol.authorizationId },
        select: { status: true, currentVersionId: true },
      }),
    ).toEqual({
      status: "active",
      currentVersionId: createdProtocol.versionId,
    });

    const malformedAuthorizationId = `m13-malformed-${runId}`;
    const malformedVersionId = `${malformedAuthorizationId}-v1`;
    const malformedReceiptId = `${malformedAuthorizationId}-receipt`;
    const malformedContent = {
      labId: "lab-microglia",
      protocolCode: `M13-BAD-${suffix}`,
      title: "A title that does not match the authorization root",
      summary: "Malformed canonical payload rejection fixture.",
      validFrom: validFrom.toISOString(),
      validUntil: validUntil.toISOString(),
      approvedAnimalCount: 2,
      projectIds: ["project-micro"],
      experimentIds: [],
      strainIds: ["strain-tdt"],
      procedureCodes: ["animal-use"],
      personnel: [
        { userId: creator.id, roleLabel: "principal_investigator" },
      ],
      policyVersion: "synthetic-fail-closed-v1",
    };
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.commandReceipt.create({
          data: {
            id: malformedReceiptId,
            actorId: protocolCreator.id,
            actorAuthzVersion: protocolCreator.authzVersion,
            labId: "lab-microglia",
            commandType: "protocol_authorization.draft.create",
            idempotencyKey: malformedReceiptId,
            requestHash: canonicalJsonHash(malformedContent),
            requestId: malformedReceiptId,
            aggregateType: "protocol_authorization",
            aggregateId: malformedAuthorizationId,
          },
        });
        await tx.$queryRaw(
          Prisma.sql`SELECT set_config('mcm.audit_receipt_id', ${malformedReceiptId}, true)`,
        );
        await tx.protocolAuthorization.create({
          data: {
            id: malformedAuthorizationId,
            labId: "lab-microglia",
            protocolCode: `M13-BAD-${suffix}`,
            title: "Canonical root title",
            status: "draft",
            createdById: protocolCreator.id,
          },
        });
        await tx.protocolAuthorizationVersion.create({
          data: {
            id: malformedVersionId,
            authorizationId: malformedAuthorizationId,
            versionNumber: 1,
            contentHash: canonicalJsonHash(malformedContent),
            contentPayload: canonicalJson(malformedContent),
            policyVersion: "synthetic-fail-closed-v1",
            validFrom,
            validUntil,
            approvedAnimalCount: 2,
            summary: malformedContent.summary,
            createdById: protocolCreator.id,
            creationCommandReceiptId: malformedReceiptId,
          },
        });
        await Promise.all([
          tx.protocolProjectBinding.create({
            data: {
              id: `${malformedVersionId}-project`,
              authorizationVersionId: malformedVersionId,
              labId: "lab-microglia",
              projectId: "project-micro",
            },
          }),
          tx.protocolStrainBinding.create({
            data: {
              id: `${malformedVersionId}-strain`,
              authorizationVersionId: malformedVersionId,
              labId: "lab-microglia",
              strainId: "strain-tdt",
            },
          }),
          tx.protocolProcedureBinding.create({
            data: {
              id: `${malformedVersionId}-procedure`,
              authorizationVersionId: malformedVersionId,
              labId: "lab-microglia",
              procedureCode: "animal-use",
            },
          }),
          tx.protocolPersonnelBinding.create({
            data: {
              id: `${malformedVersionId}-personnel`,
              authorizationVersionId: malformedVersionId,
              labId: "lab-microglia",
              userId: creator.id,
              roleLabel: "principal_investigator",
            },
          }),
          tx.protocolCountLedger.create({
            data: {
              id: `${malformedVersionId}-ledger`,
              authorizationVersionId: malformedVersionId,
              approvedCount: 2,
            },
          }),
        ]);
        await tx.protocolAuthorizationVersion.update({
          where: { id: malformedVersionId },
          data: { scopeSealedAt: new Date() },
        });
      }),
    ).rejects.toThrow(
      /Protocol version canonical payload does not match its sealed scope bindings/,
    );

    for (const experimentId of [directExperimentId, cohortExperimentId]) {
      const experiment = await prisma.experiment.findUniqueOrThrow({
        where: { id: experimentId },
      });
      const updated = await executeUpdateExperimentCommand({
        actor: creator,
        command: {
          experimentId,
          labId: experiment.labId,
          projectId: experiment.projectId,
          protocolAuthorizationId: createdProtocol.authorizationId,
          experimentCode: experiment.experimentCode,
          title: experiment.title,
          plannedStartAt: experiment.plannedStartAt
            ?.toISOString()
            .slice(0, 10),
          plannedEndAt: experiment.plannedEndAt?.toISOString().slice(0, 10),
        },
        expectedVersion: experiment.version,
        idempotencyKey: `m13-experiment-protocol-${experimentId}`,
        requestId: `m13-experiment-protocol-${experimentId}`,
      });
      expect(updated.ok, JSON.stringify(updated)).toBe(true);
    }

    const directExperiment = await prisma.experiment.findUniqueOrThrow({
      where: { id: directExperimentId },
    });
    const directAnimal = await prisma.animal.findUniqueOrThrow({
      where: { id: "animal-011" },
    });
    const directReservation = await executeReserveAnimalForExperimentCommand({
      actor: creator,
      command: {
        animalId: directAnimal.id,
        experimentId: directExperiment.id,
        startDate: today,
        treatmentGroup: "Direct settlement group",
      },
      expectedAnimalVersion: directAnimal.version,
      expectedExperimentVersion: directExperiment.version,
      idempotencyKey: `m13-direct-reserve-${runId}`,
      requestId: `m13-direct-reserve-${runId}`,
    });
    expect(directReservation.ok, JSON.stringify(directReservation)).toBe(true);
    if (!directReservation.ok) throw new Error(directReservation.message);
    const directResult = directReservation.result as {
      assignmentId: string;
      experimentVersion: number;
    };
    const directAssignment = await prisma.experimentAssignment.findUniqueOrThrow(
      {
        where: { id: directResult.assignmentId },
        include: { protocolCountAllocation: true },
      },
    );
    const activatedDirect = await executeTransitionExperimentCommand({
      actor: creator,
      command: {
        experimentId: directExperiment.id,
        labId: directExperiment.labId,
        status: "active",
      },
      expectedVersion: directResult.experimentVersion,
      idempotencyKey: `m13-direct-activate-${runId}`,
      requestId: `m13-direct-activate-${runId}`,
    });
    expect(activatedDirect.ok, JSON.stringify(activatedDirect)).toBe(true);
    if (!activatedDirect.ok) throw new Error(activatedDirect.message);
    const directActiveVersion = (activatedDirect.result as { version: number })
      .version;
    const blockedCompletion = await executeTransitionExperimentCommand({
      actor: creator,
      command: {
        experimentId: directExperiment.id,
        labId: directExperiment.labId,
        status: "completed",
      },
      expectedVersion: directActiveVersion,
      idempotencyKey: `m13-direct-complete-blocked-${runId}`,
      requestId: `m13-direct-complete-blocked-${runId}`,
    });
    expect(blockedCompletion).toMatchObject({
      ok: false,
      code: "unsettled_reservations",
    });
    const cancelledDirect = await executeTransitionExperimentCommand({
      actor: creator,
      command: {
        experimentId: directExperiment.id,
        labId: directExperiment.labId,
        status: "cancelled",
      },
      expectedVersion: directActiveVersion,
      idempotencyKey: `m13-direct-cancel-${runId}`,
      requestId: `m13-direct-cancel-${runId}`,
    });
    expect(cancelledDirect.ok, JSON.stringify(cancelledDirect)).toBe(true);
    const directReplay = await executeTransitionExperimentCommand({
      actor: creator,
      command: {
        experimentId: directExperiment.id,
        labId: directExperiment.labId,
        status: "cancelled",
      },
      expectedVersion: directActiveVersion,
      idempotencyKey: `m13-direct-cancel-${runId}`,
      requestId: `m13-direct-cancel-${runId}`,
    });
    expect(directReplay).toMatchObject({ ok: true, replayed: true });
    expect(
      await prisma.experimentAssignment.findUnique({
        where: { id: directAssignment.id },
        select: { status: true },
      }),
    ).toEqual({ status: "cancelled" });
    expect(
      await prisma.protocolCountAllocation.findUnique({
        where: { id: directAssignment.protocolCountAllocationId! },
        select: { status: true, releasedQuantity: true },
      }),
    ).toEqual({ status: "released", releasedQuantity: 1 });
    expect(
      await prisma.animal.findUnique({
        where: { id: directAnimal.id },
        select: { status: true },
      }),
    ).toEqual({ status: "colony_holding" });
    expect(
      await prisma.animalProjectAllocation.count({
        where: {
          animalId: directAnimal.id,
          projectId: directExperiment.projectId,
          endedAt: null,
        },
      }),
    ).toBe(0);

    const cohortExperiment = await prisma.experiment.findUniqueOrThrow({
      where: { id: cohortExperimentId },
    });
    const cohortAnimal = await prisma.animal.findUniqueOrThrow({
      where: { id: "animal-012" },
    });
    const planned = await executePlanExperimentAssignmentsCommand({
      actor: creator,
      command: {
        experimentId: cohortExperiment.id,
        startDate: today,
        assignments: [
          {
            animalId: cohortAnimal.animalId,
            treatmentGroup: "Cohort settlement group",
          },
        ],
      },
      expectedExperimentVersion: cohortExperiment.version,
      idempotencyKey: `m13-cohort-plan-${runId}`,
      requestId: `m13-cohort-plan-${runId}`,
    });
    expect(planned.ok, JSON.stringify(planned)).toBe(true);
    if (!planned.ok) throw new Error(planned.message);
    const plannedResult = planned.result as {
      assignmentIds: string[];
      experimentVersion: number;
    };
    const promoted = await executePromoteExperimentAssignmentsCommand({
      actor: creator,
      command: {
        experimentId: cohortExperiment.id,
        assignments: [
          {
            assignmentId: plannedResult.assignmentIds[0],
            expectedVersion: 1,
          },
        ],
      },
      expectedExperimentVersion: plannedResult.experimentVersion,
      idempotencyKey: `m13-cohort-promote-${runId}`,
      requestId: `m13-cohort-promote-${runId}`,
    });
    expect(promoted.ok, JSON.stringify(promoted)).toBe(true);
    if (!promoted.ok) throw new Error(promoted.message);
    const promotedResult = promoted.result as { experimentVersion: number };
    const promotedAssignment =
      await prisma.experimentAssignment.findUniqueOrThrow({
        where: { id: plannedResult.assignmentIds[0] },
        include: { protocolCountAllocation: true },
      });
    const promotedAllocationId = promotedAssignment.protocolCountAllocationId!;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'");
      await tx.$executeRawUnsafe(
        "SET LOCAL session_replication_role = 'replica'",
      );
      await tx.experimentAssignment.update({
        where: { id: promotedAssignment.id },
        data: { protocolCountAllocationId: null },
      });
      await tx.$executeRawUnsafe(
        "SET LOCAL session_replication_role = 'origin'",
      );
    });
    const failedCancellation = await executeTransitionExperimentCommand({
      actor: creator,
      command: {
        experimentId: cohortExperiment.id,
        labId: cohortExperiment.labId,
        status: "cancelled",
      },
      expectedVersion: promotedResult.experimentVersion,
      idempotencyKey: `m13-cohort-cancel-broken-${runId}`,
      requestId: `m13-cohort-cancel-broken-${runId}`,
    });
    expect(failedCancellation).toMatchObject({
      ok: false,
      code: "compliance_count_conflict",
    });
    expect(
      await prisma.experiment.findUnique({
        where: { id: cohortExperiment.id },
        select: { status: true },
      }),
    ).toEqual({ status: "planned" });
    expect(
      await prisma.protocolCountAllocation.findUnique({
        where: { id: promotedAllocationId },
        select: { status: true, releasedQuantity: true },
      }),
    ).toEqual({ status: "open", releasedQuantity: 0 });
    expect(
      await prisma.animal.findUnique({
        where: { id: cohortAnimal.id },
        select: { status: true },
      }),
    ).toEqual({ status: "reserved" });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'");
      await tx.$executeRawUnsafe(
        "SET LOCAL session_replication_role = 'replica'",
      );
      await tx.experimentAssignment.update({
        where: { id: promotedAssignment.id },
        data: { protocolCountAllocationId: promotedAllocationId },
      });
      await tx.$executeRawUnsafe(
        "SET LOCAL session_replication_role = 'origin'",
      );
    });
    const cancelledCohort = await executeTransitionExperimentCommand({
      actor: creator,
      command: {
        experimentId: cohortExperiment.id,
        labId: cohortExperiment.labId,
        status: "cancelled",
      },
      expectedVersion: promotedResult.experimentVersion,
      idempotencyKey: `m13-cohort-cancel-${runId}`,
      requestId: `m13-cohort-cancel-${runId}`,
    });
    expect(cancelledCohort.ok, JSON.stringify(cancelledCohort)).toBe(true);
    expect(
      await prisma.experimentAssignment.findUnique({
        where: { id: promotedAssignment.id },
        select: { status: true },
      }),
    ).toEqual({ status: "cancelled" });
    expect(
      await prisma.protocolCountAllocation.findUnique({
        where: { id: promotedAllocationId },
        select: { status: true, releasedQuantity: true },
      }),
    ).toEqual({ status: "released", releasedQuantity: 1 });
    expect(
      await prisma.animal.findUnique({
        where: { id: cohortAnimal.id },
        select: { status: true },
      }),
    ).toEqual({ status: "colony_holding" });
  }, 120_000);

  it("rejects direct SQL destruction when the guarded bypass is not enabled", async () => {
    await expect(
      prisma.$executeRawUnsafe('TRUNCATE TABLE "ComplianceEvidenceSnapshot" CASCADE'),
    ).rejects.toThrow(/append-only immutable evidence/);
  });
});
