import { randomUUID } from "node:crypto";

import {
  Prisma,
  type CompetencyEventType,
  type ProtocolAuthorizationStatus,
  type ProtocolPersonnelRole,
} from "@prisma/client";

import { canonicalJson, canonicalJsonHash, executeIdempotentCommand } from "@/lib/command-foundation";
import { COMPLIANCE_POLICY_VERSION } from "@/lib/protocol-compliance";
import type { ResolvedActor } from "@/lib/session";

type CommandIdentity = { idempotencyKey: string; requestId: string };

function governanceEvidence(actor: ResolvedActor) {
  const authenticatedAt = actor.authenticatedAt ? new Date(actor.authenticatedAt) : null;
  if (!actor.assurance || !actor.identityLinkId || !authenticatedAt || Number.isNaN(authenticatedAt.valueOf())) return null;
  return { assurance: actor.assurance, identityLinkId: actor.identityLinkId, authenticatedAt };
}

async function currentDuty(
  tx: Prisma.TransactionClient,
  actorId: string,
  duty: "protocol_reviewer" | "training_administrator",
  at: Date,
) {
  return tx.facilityDutyAssignment.findFirst({
    where: { userId: actorId, duty, revokedAt: null, validFrom: { lte: at }, validUntil: { gt: at } },
    orderBy: [{ validFrom: "desc" }, { id: "asc" }],
    select: { id: true, version: true },
  });
}

async function databaseNow(tx: Prisma.TransactionClient) {
  return (await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT CURRENT_TIMESTAMP AS now`))[0]?.now ?? null;
}

export type ProtocolDraftInput = {
  labId: string;
  protocolCode: string;
  title: string;
  validFrom: Date;
  validUntil: Date;
  approvedAnimalCount: number;
  summary: string;
  projectIds: string[];
  experimentIds?: string[];
  strainIds: string[];
  procedureCodes: string[];
  personnel: Array<{ userId: string; roleLabel: ProtocolPersonnelRole }>;
};

export async function executeCreateProtocolDraftCommand(input: {
  actor: ResolvedActor;
  command: ProtocolDraftInput;
} & CommandIdentity) {
  const command = {
    ...input.command,
    labId: input.command.labId.trim(),
    protocolCode: input.command.protocolCode.trim().toUpperCase(),
    title: input.command.title.trim(),
    summary: input.command.summary.trim(),
    projectIds: [...new Set(input.command.projectIds.map((value) => value.trim()).filter(Boolean))].sort(),
    experimentIds: [...new Set((input.command.experimentIds ?? []).map((value) => value.trim()).filter(Boolean))].sort(),
    strainIds: [...new Set(input.command.strainIds.map((value) => value.trim()).filter(Boolean))].sort(),
    procedureCodes: [...new Set(input.command.procedureCodes.map((value) => value.trim()).filter(Boolean))].sort(),
    personnel: [...new Map(input.command.personnel.map((person) => [
      `${person.userId.trim()}\u0000${person.roleLabel}`,
      { userId: person.userId.trim(), roleLabel: person.roleLabel },
    ])).values()]
      .filter((person) => person.userId)
      .sort((left, right) => left.userId.localeCompare(right.userId) || left.roleLabel.localeCompare(right.roleLabel)),
  };
  if (!command.labId || command.protocolCode.length < 2 || command.title.length < 3 || command.summary.length < 3
    || command.validUntil <= command.validFrom || !Number.isInteger(command.approvedAnimalCount) || command.approvedAnimalCount < 0
    || command.projectIds.length === 0 || command.strainIds.length === 0 || command.procedureCodes.length === 0 || command.personnel.length === 0) {
    return { ok: false as const, code: "validation_error", message: "Protocol scope, dates, count, procedures, strains, and named personnel are required." };
  }
  const authorizationId = randomUUID();
  const versionId = randomUUID();
  const personnelUserIds = [...new Set(command.personnel.map((person) => person.userId))];
  const content = { ...command, validFrom: command.validFrom.toISOString(), validUntil: command.validUntil.toISOString(), policyVersion: COMPLIANCE_POLICY_VERSION };
  const contentPayload = canonicalJson(content);
  const contentHash = canonicalJsonHash(content);
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "protocol_authorization.draft.create",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { ...command, validFrom: command.validFrom.toISOString(), validUntil: command.validUntil.toISOString() } as unknown as Prisma.InputJsonValue,
    requiredCapability: "protocols:draft",
    labId: command.labId,
    handler: async (tx, context) => {
      const [lab, projects, experiments, strains, memberships] = await Promise.all([
        tx.lab.findFirst({ where: { id: command.labId, active: true }, select: { id: true } }),
        tx.project.count({ where: { id: { in: command.projectIds }, labId: command.labId } }),
        tx.experiment.count({ where: { id: { in: command.experimentIds }, labId: command.labId } }),
        tx.strain.count({ where: { id: { in: command.strainIds } } }),
        tx.labMembership.count({
          where: {
            labId: command.labId,
            active: true,
            userId: { in: personnelUserIds },
            user: { active: true, role: { not: "it_head" } },
          },
        }),
      ]);
      if (!lab || projects !== command.projectIds.length || experiments !== command.experimentIds.length
        || strains !== command.strainIds.length || memberships !== personnelUserIds.length) {
        return { ok: false, code: "compliance_scope_invalid", message: "Protocol bindings and named personnel must be active members of the selected lab." };
      }
      await tx.protocolAuthorization.create({
        data: { id: authorizationId, labId: command.labId, protocolCode: command.protocolCode, title: command.title, status: "draft", createdById: input.actor.id },
      });
      await tx.protocolAuthorizationVersion.create({
        data: {
          id: versionId,
          authorizationId,
          versionNumber: 1,
          contentHash,
          contentPayload,
          policyVersion: COMPLIANCE_POLICY_VERSION,
          validFrom: command.validFrom,
          validUntil: command.validUntil,
          approvedAnimalCount: command.approvedAnimalCount,
          summary: command.summary,
          createdById: input.actor.id,
          creationCommandReceiptId: context.receiptId,
        },
      });
      await Promise.all([
        tx.protocolProjectBinding.createMany({ data: command.projectIds.map((projectId) => ({ id: randomUUID(), authorizationVersionId: versionId, labId: command.labId, projectId })) }),
        tx.protocolExperimentBinding.createMany({ data: command.experimentIds.map((experimentId) => ({ id: randomUUID(), authorizationVersionId: versionId, labId: command.labId, experimentId })) }),
        tx.protocolStrainBinding.createMany({ data: command.strainIds.map((strainId) => ({ id: randomUUID(), authorizationVersionId: versionId, labId: command.labId, strainId })) }),
        tx.protocolProcedureBinding.createMany({ data: command.procedureCodes.map((procedureCode) => ({ id: randomUUID(), authorizationVersionId: versionId, labId: command.labId, procedureCode })) }),
        tx.protocolPersonnelBinding.createMany({ data: command.personnel.map((person) => ({ id: randomUUID(), authorizationVersionId: versionId, labId: command.labId, ...person })) }),
        tx.protocolCountLedger.create({ data: { id: randomUUID(), authorizationVersionId: versionId, approvedCount: command.approvedAnimalCount } }),
      ]);
      await tx.protocolAuthorizationVersion.update({
        where: { id: versionId },
        data: { scopeSealedAt: new Date() },
      });
      await tx.protocolAuthorization.update({ where: { id: authorizationId }, data: { currentVersionId: versionId, version: { increment: 1 } } });
      return { ok: true, result: { authorizationId, versionId, status: "draft", version: 2 }, aggregateType: "protocol_authorization", aggregateId: authorizationId, resultingVersion: 2 };
    },
  });
}

const transitions: Record<ProtocolAuthorizationStatus, readonly ProtocolAuthorizationStatus[]> = {
  draft: ["active", "revoked"],
  active: ["suspended", "expired", "revoked"],
  suspended: ["active", "expired", "revoked"],
  expired: [],
  revoked: [],
  legacy_unverified: ["revoked"],
};

export async function executeTransitionProtocolAuthorizationCommand(input: {
  actor: ResolvedActor;
  command: { authorizationId: string; labId: string; status: ProtocolAuthorizationStatus; reason: string };
  expectedVersion: number;
} & CommandIdentity) {
  const evidence = governanceEvidence(input.actor);
  if (!evidence || input.command.reason.trim().length < 3) {
    return { ok: false as const, code: "compliance_assurance_required", message: "Fresh MFA assurance and a reason are required." };
  }
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: `protocol_authorization.${input.command.status}`,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: input.command,
    requiredCapability: "protocols:approve",
    labId: input.command.labId,
    handler: async (tx, context) => {
      const authorization = await tx.protocolAuthorization.findFirst({ where: { id: input.command.authorizationId, labId: input.command.labId } });
      if (!authorization) return { ok: false, code: "not_found", message: "Protocol authorization not found." };
      if (authorization.version !== input.expectedVersion) return { ok: false, code: "stale_conflict", message: "The protocol authorization changed. Refresh before deciding." };
      if (!transitions[authorization.status].includes(input.command.status)) return { ok: false, code: "invalid_transition", message: "That protocol status transition is not allowed." };
      const now = await databaseNow(tx);
      const duty = now ? await currentDuty(tx, input.actor.id, "protocol_reviewer", now) : null;
      if (!now || !duty) return { ok: false, code: "compliance_duty_required", message: "A current protocol reviewer duty is required." };
      if (authorization.createdById === input.actor.id) return { ok: false, code: "maker_checker_required", message: "A protocol draft must be reviewed by someone other than its creator." };
      const shared = {
        actorId: input.actor.id,
        actorAuthzVersion: input.actor.authzVersion,
        assurance: evidence.assurance,
        identityLinkId: evidence.identityLinkId,
        authenticatedAt: evidence.authenticatedAt,
        dutyAssignmentId: duty.id,
        dutyAssignmentVersion: duty.version,
      };
      await tx.protocolAuthorizationLifecycleEvent.create({
        data: {
          id: randomUUID(), authorizationId: authorization.id, fromStatus: authorization.status, toStatus: input.command.status,
          commandReceiptId: context.receiptId, reason: input.command.reason.trim(), occurredAt: now, ...shared,
        },
      });
      const updated = await tx.protocolAuthorization.update({
        where: { id: authorization.id },
        data: {
          status: input.command.status,
          reviewedById: input.actor.id,
          reviewedByAuthzVersion: input.actor.authzVersion,
          reviewedAssurance: evidence.assurance,
          reviewedIdentityLinkId: evidence.identityLinkId,
          reviewedAuthenticatedAt: evidence.authenticatedAt,
          reviewedDutyAssignmentId: duty.id,
          reviewedDutyAssignmentVersion: duty.version,
          reviewedAt: now,
          activatedAt: input.command.status === "active" ? now : authorization.activatedAt,
          suspendedAt: input.command.status === "suspended" ? now : authorization.suspendedAt,
          revokedAt: input.command.status === "revoked" ? now : authorization.revokedAt,
          statusReason: input.command.reason.trim(),
          version: { increment: 1 },
        },
      });
      return { ok: true, result: { authorizationId: updated.id, status: updated.status, version: updated.version }, aggregateType: "protocol_authorization", aggregateId: updated.id, resultingVersion: updated.version };
    },
  });
}

export async function executeUpsertCompetencyEvidenceCommand(input: {
  actor: ResolvedActor;
  command: { userId: string; labId: string; procedureCode: string; evidenceType: string; validFrom: Date; validUntil: Date; note?: string | null; renewRevoked?: boolean };
  expectedVersion?: number;
} & CommandIdentity) {
  const evidence = governanceEvidence(input.actor);
  if (!evidence || input.command.validUntil <= input.command.validFrom) {
    return { ok: false as const, code: "validation_error", message: "Fresh MFA assurance and valid competency dates are required." };
  }
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "competency_evidence.upsert",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { ...input.command, validFrom: input.command.validFrom.toISOString(), validUntil: input.command.validUntil.toISOString() } as Prisma.InputJsonValue,
    requiredCapability: "competencies:manage",
    labId: input.command.labId,
    handler: async (tx, context) => {
      const now = await databaseNow(tx);
      const duty = now ? await currentDuty(tx, input.actor.id, "training_administrator", now) : null;
      if (!now || !duty) return { ok: false, code: "compliance_duty_required", message: "A current training administrator duty is required." };
      if (input.command.userId === input.actor.id) return { ok: false, code: "maker_checker_required", message: "Training administrators cannot issue their own competency evidence." };
      const targetMembership = await tx.labMembership.findFirst({
        where: { labId: input.command.labId, userId: input.command.userId, active: true, user: { active: true, role: { not: "it_head" } } },
        select: { id: true },
      });
      if (!targetMembership) return { ok: false, code: "compliance_scope_invalid", message: "The competency subject must be an active member of the selected lab." };
      const existing = await tx.competencyEvidence.findUnique({
        where: { userId_labId_procedureCode: { userId: input.command.userId, labId: input.command.labId, procedureCode: input.command.procedureCode.trim() } },
        select: { id: true, version: true, status: true },
      });
      if (existing && input.expectedVersion !== existing.version) return { ok: false, code: "stale_conflict", message: "The competency evidence changed. Refresh before renewing it." };
      if (existing?.status === "revoked" && input.command.renewRevoked !== true) {
        return { ok: false, code: "explicit_transition_required", message: "Renewing revoked competency requires an explicit renewal transition." };
      }
      const evidenceId = existing?.id ?? randomUUID();
      const versionNumber = existing ? existing.version + 1 : 1;
      const versionId = randomUUID();
      const governance = {
        governedById: input.actor.id,
        governedByAuthzVersion: input.actor.authzVersion,
        governedAssurance: evidence.assurance,
        governedIdentityLinkId: evidence.identityLinkId,
        governedAuthenticatedAt: evidence.authenticatedAt,
        governedDutyAssignmentId: duty.id,
        governedDutyAssignmentVersion: duty.version,
        governedAt: now,
      };
      if (!existing) {
        await tx.competencyEvidence.create({
          data: { id: evidenceId, userId: input.command.userId, labId: input.command.labId, procedureCode: input.command.procedureCode.trim(), status: "current", ...governance },
        });
      }
      const versionHash = canonicalJsonHash({ ...input.command, validFrom: input.command.validFrom.toISOString(), validUntil: input.command.validUntil.toISOString(), versionNumber });
      const versionPayload = canonicalJson({ ...input.command, validFrom: input.command.validFrom.toISOString(), validUntil: input.command.validUntil.toISOString(), versionNumber });
      await tx.competencyEvidenceVersion.create({
        data: { id: versionId, evidenceId, versionNumber, evidenceType: input.command.evidenceType.trim(), contentHash: versionHash, contentPayload: versionPayload, validFrom: input.command.validFrom, validUntil: input.command.validUntil, issuedById: input.actor.id, commandReceiptId: context.receiptId, note: input.command.note?.trim() || null },
      });
      const updated = await tx.competencyEvidence.update({
        where: { id: evidenceId },
        data: { currentVersionId: versionId, status: "current", revokedAt: null, version: existing ? { increment: 1 } : 1, ...governance },
      });
      await tx.competencyLifecycleEvent.create({
        data: {
          id: randomUUID(), evidenceId, actorId: input.actor.id, actorAuthzVersion: input.actor.authzVersion,
          assurance: evidence.assurance, identityLinkId: evidence.identityLinkId, authenticatedAt: evidence.authenticatedAt,
          dutyAssignmentId: duty.id, dutyAssignmentVersion: duty.version, commandReceiptId: context.receiptId,
          eventType: (existing ? "renewed" : "created") satisfies CompetencyEventType, evidenceVersion: updated.version,
          detail: { versionId, validUntil: input.command.validUntil.toISOString() }, occurredAt: now,
        },
      });
      return { ok: true, result: { evidenceId, versionId, version: updated.version }, aggregateType: "competency_evidence", aggregateId: evidenceId, resultingVersion: updated.version };
    },
  });
}

export async function executeTransitionCompetencyEvidenceCommand(input: {
  actor: ResolvedActor;
  command: { evidenceId: string; labId: string; status: "expired" | "revoked"; reason: string };
  expectedVersion: number;
} & CommandIdentity) {
  const evidence = governanceEvidence(input.actor);
  if (!evidence || input.command.reason.trim().length < 3 || input.expectedVersion < 1) {
    return { ok: false as const, code: "validation_error", message: "Fresh MFA assurance, current version, and a reason are required." };
  }
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: `competency_evidence.${input.command.status}`,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { ...input.command, expectedVersion: input.expectedVersion },
    requiredCapability: "competencies:manage",
    labId: input.command.labId,
    aggregateType: "competency_evidence",
    aggregateId: input.command.evidenceId,
    handler: async (tx, context) => {
      const record = await tx.competencyEvidence.findFirst({ where: { id: input.command.evidenceId, labId: input.command.labId } });
      if (!record) return { ok: false, code: "not_found", message: "Competency evidence not found." };
      if (record.version !== input.expectedVersion) return { ok: false, code: "stale_conflict", message: "The competency evidence changed. Refresh before deciding." };
      if (record.status !== "current") return { ok: false, code: "invalid_transition", message: "Only current competency evidence can be expired or revoked." };
      if (record.userId === input.actor.id) return { ok: false, code: "maker_checker_required", message: "Training administrators cannot decide their own competency evidence." };
      const now = await databaseNow(tx);
      const duty = now ? await currentDuty(tx, input.actor.id, "training_administrator", now) : null;
      if (!now || !duty) return { ok: false, code: "compliance_duty_required", message: "A current training administrator duty is required." };
      const governance = {
        governedById: input.actor.id,
        governedByAuthzVersion: input.actor.authzVersion,
        governedAssurance: evidence.assurance,
        governedIdentityLinkId: evidence.identityLinkId,
        governedAuthenticatedAt: evidence.authenticatedAt,
        governedDutyAssignmentId: duty.id,
        governedDutyAssignmentVersion: duty.version,
        governedAt: now,
      };
      const updated = await tx.competencyEvidence.update({
        where: { id: record.id },
        data: {
          status: input.command.status,
          revokedAt: input.command.status === "revoked" ? now : null,
          version: { increment: 1 },
          ...governance,
        },
      });
      await tx.competencyLifecycleEvent.create({
        data: {
          id: randomUUID(),
          evidenceId: record.id,
          actorId: input.actor.id,
          actorAuthzVersion: input.actor.authzVersion,
          assurance: evidence.assurance,
          identityLinkId: evidence.identityLinkId,
          authenticatedAt: evidence.authenticatedAt,
          dutyAssignmentId: duty.id,
          dutyAssignmentVersion: duty.version,
          commandReceiptId: context.receiptId,
          eventType: input.command.status,
          evidenceVersion: updated.version,
          detail: { reason: input.command.reason.trim() },
          occurredAt: now,
        },
      });
      return { ok: true, result: { evidenceId: updated.id, status: updated.status, version: updated.version }, resultingVersion: updated.version };
    },
  });
}
