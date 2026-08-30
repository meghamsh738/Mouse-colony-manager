import { createHash, randomUUID } from "node:crypto";

import { Prisma, type CorrectionDomain, type CorrectionEventType, type CorrectionRequestStatus } from "@prisma/client";

import { canonicalJsonHash, executeIdempotentCommand, reauthorizeActorForCommand } from "@/lib/command-foundation";
import { CORRECTION_DOMAIN_CAPABILITIES, CORRECTION_POLICY_MARKER, canTransitionCorrection } from "@/lib/correction-state-machine";
import { evaluateCorrectionProposal, loadCorrectionTarget } from "@/lib/correction-target";
import { isElevatedIdentityContextCurrent } from "@/lib/identity-assurance";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";

type Identity = { idempotencyKey: string; requestId: string };

function facilityActor(actor: ResolvedActor): ResolvedActor {
  return { ...actor, activeLabId: null, activeMembership: null };
}

function actorAuthentication(actor: ResolvedActor) {
  const authenticatedAt = new Date(actor.authenticatedAt ?? "");
  if (!actor.assurance || Number.isNaN(authenticatedAt.getTime())) return null;
  return {
    assurance: actor.assurance,
    identityLinkId: actor.identityLinkId ?? null,
    authenticatedAt,
  };
}

async function currentDataStewardEvidence(tx: Prisma.TransactionClient, actor: ResolvedActor) {
  if (!actor.identityLinkId || !actor.assurance || !actor.authenticatedAt || !await isElevatedIdentityContextCurrent(tx, {
    userId: actor.id,
    identity: actor.email,
    identityLinkId: actor.identityLinkId,
    authenticationMethod: actor.authMethod,
    assurance: actor.assurance,
    authenticatedAt: actor.authenticatedAt,
  })) return null;
  const rows = await tx.$queryRaw<Array<{ id: string; version: number }>>(Prisma.sql`
    SELECT assignment.id, assignment.version
    FROM "FacilityDutyAssignment" assignment
    JOIN "User" actor ON actor.id = assignment."userId"
    WHERE assignment."userId" = ${actor.id}
      AND assignment.duty = 'data_steward'::"FacilityDuty"
      AND assignment."revokedAt" IS NULL
      AND assignment."validFrom" <= CURRENT_TIMESTAMP
      AND assignment."validUntil" > CURRENT_TIMESTAMP
      AND actor.active AND actor.role <> 'it_head'::"UserRole"
      AND actor."authzVersion" = ${actor.authzVersion}
    ORDER BY assignment.id LIMIT 1
  `);
  const assignment = rows[0];
  if (!assignment) return null;
  return {
    assignment,
    assurance: actor.assurance,
    identityLinkId: actor.identityLinkId,
    authenticatedAt: new Date(actor.authenticatedAt),
  };
}

async function appendCorrectionEvent(tx: Prisma.TransactionClient, input: {
  requestId: string;
  labId: string;
  eventType: CorrectionEventType;
  fromStatus: CorrectionRequestStatus | null;
  toStatus: CorrectionRequestStatus;
  actor: ResolvedActor;
  receiptId: string;
  detail: Prisma.InputJsonValue;
  steward?: NonNullable<Awaited<ReturnType<typeof currentDataStewardEvidence>>>;
}) {
  const authentication = actorAuthentication(input.actor);
  if (!authentication) throw new Error("Current authentication evidence is unavailable.");
  const receipt = await tx.commandReceipt.findUniqueOrThrow({
    where: { id: input.receiptId },
    select: { requestId: true, commandType: true, aggregateType: true, aggregateId: true, labId: true },
  });
  await tx.correctionLifecycleEvent.create({
    data: {
      id: `correction-event-${randomUUID()}`,
      requestId: input.requestId,
      labId: input.labId,
      eventType: input.eventType,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actorId: input.actor.id,
      actorAuthzVersion: input.actor.authzVersion,
      assurance: input.steward?.assurance ?? authentication.assurance,
      dutyAssignmentId: input.steward?.assignment.id ?? null,
      dutyAssignmentVersion: input.steward?.assignment.version ?? null,
      identityLinkId: input.steward?.identityLinkId ?? authentication.identityLinkId,
      authenticatedAt: input.steward?.authenticatedAt ?? authentication.authenticatedAt,
      commandReceiptId: input.receiptId,
      detail: input.detail,
    },
  });
  await tx.auditLog.create({
    data: {
      id: `audit-correction-${randomUUID()}`,
      actorId: input.actor.id,
      actorRole: input.actor.canonicalRole,
      labId: receipt.labId,
      requestId: receipt.requestId,
      commandReceiptId: input.receiptId,
      commandType: receipt.commandType,
      commandAggregateType: receipt.aggregateType,
      commandAggregateId: receipt.aggregateId,
      entityType: "CorrectionRequest",
      entityId: input.requestId,
      action: input.eventType,
      previousValue: input.fromStatus ? { status: input.fromStatus } : Prisma.JsonNull,
      newValue: { status: input.toStatus, policyMarker: CORRECTION_POLICY_MARKER },
      timestamp: new Date(),
    },
  });
}

export async function executeSubmitCorrectionRequest(input: Identity & {
  actor: ResolvedActor;
  command: {
    labId: string;
    domain: CorrectionDomain;
    targetEntityId: string;
    sourceEventAt: Date;
    reason: string;
    proposedCorrection: Prisma.InputJsonObject;
  };
}) {
  const requiredCapability = CORRECTION_DOMAIN_CAPABILITIES[input.command.domain];
  if (!await reauthorizeActorForCommand(prisma, input.actor, requiredCapability, input.command.labId)) {
    return { ok: false as const, code: "forbidden", message: "Your current lab authority does not permit this correction request." };
  }
  const authentication = actorAuthentication(input.actor);
  if (!authentication) return { ok: false as const, code: "identity_evidence_required", message: "Current authentication evidence is required." };
  const correctionId = `correction-${createHash("sha256").update(`${input.actor.id}:${input.idempotencyKey.trim()}`).digest("hex").slice(0, 32)}`;
  return executeIdempotentCommand({
    actor: input.actor,
    labId: input.command.labId,
    commandType: "corrections.request.submit",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: input.command as unknown as Prisma.InputJsonValue,
    requiredCapability,
    aggregateType: "correction_request",
    aggregateId: correctionId,
    handler: async (tx, context) => {
      const target = await loadCorrectionTarget(tx, input.command.domain, input.command.targetEntityId, input.command.labId);
      if (!target) return { ok: false, code: "not_found", message: "No correction target is available in the authorized lab." };
      const existingSupersession = await tx.correctionSupersession.findUnique({
        where: { domain_targetEntityId: { domain: input.command.domain, targetEntityId: input.command.targetEntityId } },
        select: { requestId: true },
      });
      if (existingSupersession) return { ok: false, code: "already_superseded", message: "This source record already has an applied supersession. Review that correction history before requesting another change." };
      if (Math.abs(target.sourceEventAt.getTime() - input.command.sourceEventAt.getTime()) > 1000) {
        return { ok: false, code: "source_time_mismatch", message: "The source event time changed. Refresh before requesting a correction." };
      }
      let evaluation;
      try {
        evaluation = evaluateCorrectionProposal(input.command.domain, target.originalSnapshot, input.command.proposedCorrection, target.downstreamRecords);
      } catch (error) {
        return { ok: false, code: "invalid_proposal", message: error instanceof Error ? error.message : "The proposed correction is invalid." };
      }
      const reason = input.command.reason.trim();
      if (reason.length < 8 || reason.length > 2000) return { ok: false, code: "invalid_reason", message: "Provide a correction reason between 8 and 2,000 characters." };
      const status: CorrectionRequestStatus = evaluation.safe ? "pending" : "blocked";
      await tx.correctionRequest.create({
        data: {
          id: correctionId,
          labId: target.labId,
          domain: input.command.domain,
          targetEntityType: input.command.domain,
          targetEntityId: input.command.targetEntityId,
          targetVersion: target.targetVersion,
          sourceEventAt: target.sourceEventAt,
          reason,
          originalSnapshot: target.originalSnapshot,
          proposedCorrection: input.command.proposedCorrection,
          status,
          blockCode: evaluation.blockCode,
          blockDetail: evaluation.blockDetail ?? Prisma.JsonNull,
          policyMarker: CORRECTION_POLICY_MARKER,
          requestedById: input.actor.id,
          requesterAuthzVersion: input.actor.authzVersion,
          requesterAssurance: authentication.assurance,
          requesterIdentityLinkId: authentication.identityLinkId,
          requesterAuthenticatedAt: authentication.authenticatedAt,
          requestCommandReceiptId: context.receiptId,
        },
      });
      await appendCorrectionEvent(tx, {
        requestId: correctionId,
        labId: target.labId,
        eventType: evaluation.safe ? "requested" : "blocked",
        fromStatus: null,
        toStatus: status,
        actor: input.actor,
        receiptId: context.receiptId,
        detail: { domain: input.command.domain, blockCode: evaluation.blockCode, targetEntityId: input.command.targetEntityId },
      });
      return { ok: true, aggregateType: "correction_request", aggregateId: correctionId, resultingVersion: 1,
        result: { correctionId, version: 1, status, blockCode: evaluation.blockCode, message: evaluation.safe ? "Correction request submitted for independent review." : "The request was recorded but is blocked from approval because it requires physical or structural reconciliation policy." } };
    },
  });
}

export async function executeDecideCorrectionRequest(input: Identity & {
  actor: ResolvedActor;
  correctionId: string;
  expectedVersion: number;
  decision: "approve" | "reject";
  decisionReason: string;
}) {
  const scopedActor = facilityActor(input.actor);
  if (!await reauthorizeActorForCommand(prisma, scopedActor, "corrections:approve", null)) {
    return { ok: false as const, code: "forbidden", message: "A current Data Steward duty is required." };
  }
  if (!await currentDataStewardEvidence(prisma as unknown as Prisma.TransactionClient, input.actor)) {
    return { ok: false as const, code: "steward_identity_required", message: "A current Data Steward duty and fresh elevated identity are required." };
  }
  const target = await prisma.correctionRequest.findUnique({ where: { id: input.correctionId }, select: { labId: true } });
  if (!target) return { ok: false as const, code: "not_found", message: "The correction request was not found." };
  const commandType = input.decision === "approve" ? "corrections.request.apply" : "corrections.request.reject";
  return executeIdempotentCommand({
    actor: scopedActor,
    labId: target.labId,
    authorizationLabId: null,
    commandType,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { correctionId: input.correctionId, decision: input.decision, decisionReason: input.decisionReason },
    requiredCapability: "corrections:approve",
    aggregateType: "correction_request",
    aggregateId: input.correctionId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      const steward = await currentDataStewardEvidence(tx, input.actor);
      if (!steward) return { ok: false, code: "steward_identity_required", message: "A current Data Steward duty and fresh elevated identity are required." };
      const correction = await tx.correctionRequest.findUnique({ where: { id: input.correctionId } });
      if (!correction) return { ok: false, code: "not_found", message: "The correction request was not found." };
      if (correction.requestedById === input.actor.id) return { ok: false, code: "independence_required", message: "The requester cannot decide their own correction." };
      const desired = input.decision === "approve" ? "applied" : "rejected";
      if ((correction.status !== "pending" && correction.status !== "blocked") || !canTransitionCorrection(correction.status, desired)) {
        return { ok: false, code: "invalid_state", message: correction.status === "blocked" && input.decision === "approve" ? "Blocked structural or physical corrections cannot be approved or applied." : "This correction request can no longer receive that decision." };
      }
      const decisionReason = input.decisionReason.trim();
      if (decisionReason.length < 8 || decisionReason.length > 2000) return { ok: false, code: "invalid_reason", message: "Provide a decision reason between 8 and 2,000 characters." };

      if (input.decision === "approve") {
        const latest = await loadCorrectionTarget(tx, correction.domain, correction.targetEntityId, correction.labId);
        if (!latest || canonicalJsonHash(latest.originalSnapshot) !== canonicalJsonHash(correction.originalSnapshot as Prisma.InputJsonValue)) {
          return { ok: false, code: "stale_conflict", message: "The source record changed after this request. Submit a new correction against the current evidence." };
        }
        let evaluation;
        try {
          evaluation = evaluateCorrectionProposal(correction.domain, latest.originalSnapshot, correction.proposedCorrection as Prisma.InputJsonObject, latest.downstreamRecords);
        } catch (error) {
          return { ok: false, code: "invalid_proposal", message: error instanceof Error ? error.message : "The proposed correction is invalid." };
        }
        if (!evaluation.safe || evaluation.blockCode) return { ok: false, code: evaluation.blockCode ?? "blocked", message: "This request requires physical or structural reconciliation and cannot be applied." };
        await tx.correctionSupersession.create({
          data: {
            id: `correction-supersession-${randomUUID()}`,
            requestId: correction.id,
            labId: correction.labId,
            domain: correction.domain,
            targetEntityType: correction.targetEntityType,
            targetEntityId: correction.targetEntityId,
            originalSnapshot: correction.originalSnapshot as Prisma.InputJsonValue,
            effectiveProjection: evaluation.effectiveProjection,
            sourceEventAt: correction.sourceEventAt,
            appliedAt: new Date(),
            appliedById: input.actor.id,
            commandReceiptId: context.receiptId,
          },
        });
        await tx.correctionReconciliation.create({
          data: {
            id: `correction-reconciliation-${randomUUID()}`,
            requestId: correction.id,
            labId: correction.labId,
            downstreamRecords: latest.downstreamRecords,
            result: { outcome: "reconciled", physicalMutationRequired: false, sourceRecordMutated: false, canonicalProjection: "CorrectionSupersession" },
            physicalMutationRequired: false,
            reconciledAt: new Date(),
            commandReceiptId: context.receiptId,
          },
        });
      }

      const nextStatus: CorrectionRequestStatus = desired;
      const updated = await tx.correctionRequest.update({
        where: { id: correction.id },
        data: {
          status: nextStatus,
          decidedById: input.actor.id,
          deciderAuthzVersion: input.actor.authzVersion,
          deciderAssurance: steward.assurance,
          deciderDutyAssignmentId: steward.assignment.id,
          deciderDutyAssignmentVersion: steward.assignment.version,
          deciderIdentityLinkId: steward.identityLinkId,
          deciderAuthenticatedAt: steward.authenticatedAt,
          decisionCommandReceiptId: context.receiptId,
          decisionReason,
          decidedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await appendCorrectionEvent(tx, {
        requestId: correction.id,
        labId: correction.labId,
        eventType: input.decision === "approve" ? "applied" : "rejected",
        fromStatus: correction.status,
        toStatus: nextStatus,
        actor: input.actor,
        receiptId: context.receiptId,
        detail: { decisionReason, physicalMutationRequired: false, sourceRecordMutated: false },
        steward,
      });
      return { ok: true, aggregateType: "correction_request", aggregateId: correction.id, resultingVersion: updated.version,
        result: { correctionId: correction.id, version: updated.version, status: nextStatus, message: input.decision === "approve" ? "Metadata supersession applied without changing the source record." : "Correction request rejected." } };
    },
  });
}
