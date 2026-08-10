import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { normalizeUserRole } from "@/lib/capabilities";
import {
  enqueueOutboxMessage,
  executeIdempotentCommand,
} from "@/lib/command-foundation";
import type { ResolvedActor } from "@/lib/session";
import { assertSopGovernanceDatabaseReady } from "@/lib/sop-database-contract";
import type { UserRole } from "@/lib/types";

type SopScopeInput = "facility" | "lab";
type SopDecisionInput = "approved" | "rejected";

type CommandIdentity = {
  idempotencyKey: string;
  requestId: string;
};

type SopPrincipal = {
  canonicalRole: ReturnType<typeof normalizeUserRole>;
  managedLabIds: Set<string>;
  memberLabIds: Set<string>;
};

function normalizeCode(value: string) {
  return value.trim().toUpperCase();
}

export function sopContentHash(input: { title: string; category: string; contentMarkdown: string }) {
  return createHash("sha256")
    .update(`${input.title}\n${input.category}\n${input.contentMarkdown}`, "utf8")
    .digest("hex");
}

function parseOptionalDate(value?: string | null) {
  if (!value?.trim()) return { ok: true as const, value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false as const };
  const parsed = new Date(`${value}T23:59:59.999Z`);
  return parsed.toISOString().slice(0, 10) === value
    ? { ok: true as const, value: parsed }
    : { ok: false as const };
}

async function getPrincipal(tx: Prisma.TransactionClient, actorId: string): Promise<SopPrincipal | null> {
  const user = await tx.user.findUnique({
    where: { id: actorId },
    select: {
      active: true,
      role: true,
      labMemberships: {
        where: { active: true, lab: { active: true } },
        select: { labId: true, role: true },
      },
    },
  });
  if (!user?.active) return null;
  return {
    canonicalRole: normalizeUserRole(user.role as UserRole),
    managedLabIds: new Set(
      user.labMemberships
        .filter((membership) => membership.role === "owner" || membership.role === "manager")
        .map((membership) => membership.labId),
    ),
    memberLabIds: new Set(user.labMemberships.map((membership) => membership.labId)),
  };
}

function canManageScope(principal: SopPrincipal, scope: SopScopeInput, labId: string | null) {
  if (scope === "facility") {
    return principal.canonicalRole === "facility_admin" || principal.canonicalRole === "cmu_staff";
  }
  return Boolean(labId && principal.canonicalRole === "lab_user" && principal.managedLabIds.has(labId));
}

function canApproveScope(
  principal: SopPrincipal,
  scope: SopScopeInput,
  labId: string | null,
  creatorId: string,
  actorId: string,
) {
  if (scope === "facility") {
    return principal.canonicalRole === "facility_admin" && creatorId !== actorId;
  }
  return Boolean(
    labId
    && creatorId !== actorId
    && principal.canonicalRole === "lab_user"
    && principal.managedLabIds.has(labId),
  );
}

async function setSopCommandContext(
  tx: Prisma.TransactionClient,
  input: { actorId: string; commandType: string; receiptId: string },
) {
  await assertSopGovernanceDatabaseReady(tx);
  await tx.$queryRaw(Prisma.sql`
    SELECT
      set_config('mcm.sop_actor_id', ${input.actorId}, true),
      set_config('mcm.sop_command_type', ${input.commandType}, true),
      set_config('mcm.sop_receipt_id', ${input.receiptId}, true),
      set_config('TimeZone', 'UTC', true)
  `);
}

async function writeSopAudit(
  tx: Prisma.TransactionClient,
  actorId: string,
  entityType: string,
  entityId: string,
  action: string,
  previousValue: Prisma.InputJsonValue | null,
  newValue: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({
    data: {
      id: randomUUID(),
      actorId,
      entityType,
      entityId,
      action,
      previousValue: previousValue ?? Prisma.JsonNull,
      newValue,
      timestamp: new Date(),
    },
  });
}

async function cancelSopAssignmentOutbox(
  tx: Prisma.TransactionClient,
  assignmentId: string,
  reason: string,
) {
  const messages = await tx.outboxMessage.findMany({
    where: {
      topic: "sop.assignment",
      aggregateType: "sop_assignment",
      aggregateId: assignmentId,
      status: { in: ["pending", "retry", "leased"] },
    },
    select: { id: true, leaseToken: true },
  });
  if (!messages.length) return;
  const now = new Date();
  const leaseTokens = messages.flatMap((message) => message.leaseToken ? [message.leaseToken] : []);
  await tx.outboxMessage.updateMany({
    where: { id: { in: messages.map((message) => message.id) } },
    data: {
      status: "cancelled",
      leaseOwner: null,
      leaseToken: null,
      workerType: null,
      leasedAt: null,
      leaseExpiresAt: null,
      lastError: reason,
    },
  });
  if (leaseTokens.length) {
    await tx.outboxDeliveryAttempt.updateMany({
      where: { leaseToken: { in: leaseTokens }, status: "processing" },
      data: { status: "failed", completedAt: now, errorMessage: reason },
    });
  }
}

export async function executeCreateSopCommand(input: {
  actor: ResolvedActor;
  command: {
    scope: SopScopeInput;
    labId?: string | null;
    code: string;
    title: string;
    category: string;
    contentMarkdown: string;
    changeSummary: string;
  };
} & CommandIdentity) {
  const requestedLabId = input.command.labId?.trim() || null;
  if (input.command.scope === "lab"
    && requestedLabId
    && requestedLabId !== input.actor.activeLabId) {
    return {
      ok: false as const,
      code: "forbidden",
      message: "Switch to the lab where this SOP should be created.",
    };
  }
  const command = {
    ...input.command,
    labId: input.command.scope === "lab" ? input.actor.activeLabId : null,
    code: normalizeCode(input.command.code),
    title: input.command.title.trim(),
    category: input.command.category.trim(),
    contentMarkdown: input.command.contentMarkdown.trim(),
    changeSummary: input.command.changeSummary.trim(),
  };
  if (!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(command.code)
    || command.title.length < 3
    || command.category.length < 2
    || command.contentMarkdown.length < 20
    || command.changeSummary.length < 3
    || (command.scope === "lab" && !command.labId)) {
    return { ok: false as const, code: "validation_error", message: "Enter a valid code, title, category, SOP content, and change summary." };
  }
  const documentId = randomUUID();
  const versionId = randomUUID();
  const contentHash = sopContentHash({
    title: command.title,
    category: command.category,
    contentMarkdown: command.contentMarkdown,
  });
  const commandType = "sop.create";
  return executeIdempotentCommand({
    actor: input.actor,
    commandType,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: command,
    requiredCapability: "sops:manage",
    labId: command.labId,
    handler: async (tx, context) => {
      const principal = await getPrincipal(tx, input.actor.id);
      if (!principal || !canManageScope(principal, command.scope, command.labId)) {
        return { ok: false, code: "forbidden", message: "You cannot author SOPs in this scope." };
      }
      if (command.labId && !await tx.lab.count({ where: { id: command.labId, active: true } })) {
        return { ok: false, code: "not_found", message: "The selected lab is not active." };
      }
      const duplicate = await tx.sopDocument.findFirst({
        where: { scope: command.scope, labId: command.labId, code: command.code },
        select: { id: true },
      });
      if (duplicate) return { ok: false, code: "duplicate_code", message: "That SOP code is already in use for this scope." };
      await tx.commandReceipt.update({
        where: { id: context.receiptId },
        data: { aggregateType: "sop_document", aggregateId: documentId },
      });
      await setSopCommandContext(tx, { actorId: input.actor.id, commandType, receiptId: context.receiptId });
      await tx.$queryRaw(Prisma.sql`
        SELECT "sop_create_document_version"(
          ${documentId}, ${versionId}, CAST(${command.scope} AS "SopScope"), ${command.labId},
          ${command.code}, ${command.title}, ${command.category}, ${command.contentMarkdown},
          ${contentHash}, ${command.changeSummary}, ${input.actor.id}
        )
      `);
      await writeSopAudit(tx, input.actor.id, "sop_document", documentId, "create", null, {
        scope: command.scope,
        labId: command.labId,
        code: command.code,
        versionId,
        versionNumber: 1,
        contentHash,
      });
      return {
        ok: true,
        result: { documentId, versionId, versionNumber: 1, contentHash },
        aggregateType: "sop_document",
        aggregateId: documentId,
        resultingVersion: 1,
      };
    },
  });
}

export async function executeCreateSopVersionCommand(input: {
  actor: ResolvedActor;
  command: {
    sopId: string;
    title: string;
    category: string;
    contentMarkdown: string;
    changeSummary: string;
  };
  expectedVersion: number;
} & CommandIdentity) {
  const command = {
    ...input.command,
    sopId: input.command.sopId.trim(),
    title: input.command.title.trim(),
    category: input.command.category.trim(),
    contentMarkdown: input.command.contentMarkdown.trim(),
    changeSummary: input.command.changeSummary.trim(),
  };
  if (!command.sopId || command.title.length < 3 || command.category.length < 2
    || command.contentMarkdown.length < 20 || command.changeSummary.length < 3) {
    return { ok: false as const, code: "validation_error", message: "Enter the revised title, category, content, and change summary." };
  }
  const commandType = "sop.version.create";
  const versionId = randomUUID();
  const contentHash = sopContentHash({
    title: command.title,
    category: command.category,
    contentMarkdown: command.contentMarkdown,
  });
  return executeIdempotentCommand({
    actor: input.actor,
    commandType,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: command,
    requiredCapability: "sops:manage",
    labId: input.actor.canonicalRole === "lab_user" ? input.actor.activeLabId : null,
    aggregateType: "sop_document",
    aggregateId: command.sopId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      const [principal, document] = await Promise.all([
        getPrincipal(tx, input.actor.id),
        tx.sopDocument.findUnique({ where: { id: command.sopId } }),
      ]);
      if (!document) return { ok: false, code: "not_found", message: "SOP not found." };
      if (!principal || !canManageScope(principal, document.scope, document.labId)) {
        return { ok: false, code: "forbidden", message: "You cannot revise this SOP." };
      }
      const latest = await tx.sopVersion.findFirst({
        where: { sopId: document.id },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });
      const versionNumber = (latest?.versionNumber ?? 0) + 1;
      await setSopCommandContext(tx, { actorId: input.actor.id, commandType, receiptId: context.receiptId });
      const [updated] = await tx.$queryRaw<Array<{ resultingVersion: number }>>(Prisma.sql`
        SELECT "sop_create_version"(
          ${versionId}, ${document.id}, CAST(${versionNumber} AS INTEGER), ${command.title}, ${command.category},
          ${command.contentMarkdown}, ${contentHash}, ${command.changeSummary}, ${input.actor.id}
        ) AS "resultingVersion"
      `);
      if (!updated) throw new Error("SOP version creation did not return an aggregate version.");
      await writeSopAudit(tx, input.actor.id, "sop_document", document.id, "version_create", {
        version: document.version,
      }, { version: updated.resultingVersion, versionId, versionNumber, contentHash });
      return {
        ok: true,
        result: { documentId: document.id, versionId, versionNumber, contentHash },
        resultingVersion: updated.resultingVersion,
      };
    },
  });
}

export async function executeDecideSopVersionCommand(input: {
  actor: ResolvedActor;
  command: { sopId: string; versionId: string; decision: SopDecisionInput; note: string };
  expectedVersion: number;
} & CommandIdentity) {
  const command = {
    sopId: input.command.sopId.trim(),
    versionId: input.command.versionId.trim(),
    decision: input.command.decision,
    note: input.command.note.trim(),
  };
  if (!command.sopId || !command.versionId || command.note.length < 3) {
    return { ok: false as const, code: "validation_error", message: "Choose a version, decision, and decision note." };
  }
  const commandType = "sop.version.decide";
  return executeIdempotentCommand({
    actor: input.actor,
    commandType,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: command,
    requiredCapability: command.decision === "approved" ? "sops:approve" : "sops:approve",
    labId: input.actor.canonicalRole === "lab_user" ? input.actor.activeLabId : null,
    aggregateType: "sop_document",
    aggregateId: command.sopId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      const [principal, version] = await Promise.all([
        getPrincipal(tx, input.actor.id),
        tx.sopVersion.findUnique({
          where: { id: command.versionId },
          include: {
            sop: { include: { currentVersion: { select: { versionNumber: true } } } },
            approval: true,
          },
        }),
      ]);
      if (!version || version.sopId !== command.sopId) return { ok: false, code: "not_found", message: "SOP version not found." };
      if (version.approval) return { ok: false, code: "already_decided", message: "This immutable version already has a decision." };
      if (!principal || !canApproveScope(principal, version.sop.scope, version.sop.labId, version.createdById, input.actor.id)) {
        return { ok: false, code: "forbidden", message: "You cannot decide this SOP version." };
      }
      if (command.decision === "approved"
        && version.sop.currentVersion
        && version.versionNumber <= version.sop.currentVersion.versionNumber) {
        return { ok: false, code: "version_regression", message: "Controlled SOP versions can only advance. Create a new version to roll back content." };
      }
      await setSopCommandContext(tx, { actorId: input.actor.id, commandType, receiptId: context.receiptId });
      const approvalId = randomUUID();
      const [updated] = await tx.$queryRaw<Array<{ resultingVersion: number }>>(Prisma.sql`
        SELECT "sop_decide_version"(
          ${approvalId}, ${version.sopId}, ${version.id}, CAST(${command.decision} AS "SopApprovalDecision"),
          ${command.note}, ${input.actor.id}
        ) AS "resultingVersion"
      `);
      if (!updated) throw new Error("SOP decision did not return an aggregate version.");
      await writeSopAudit(tx, input.actor.id, "sop_version", version.id, `decision_${command.decision}`, null, {
        approvalId,
        decision: command.decision,
        note: command.note,
        documentVersion: updated.resultingVersion,
        contentHash: version.contentHash,
      });
      return {
        ok: true,
        result: { documentId: version.sopId, versionId: version.id, decision: command.decision },
        resultingVersion: updated.resultingVersion,
      };
    },
  });
}

export async function executeAssignSopVersionCommand(input: {
  actor: ResolvedActor;
  command: { sopId: string; versionId: string; labId: string; dueAt?: string | null; reason: string };
  expectedVersion: number;
} & CommandIdentity) {
  const dueAt = parseOptionalDate(input.command.dueAt);
  const command = {
    sopId: input.command.sopId.trim(),
    versionId: input.command.versionId.trim(),
    labId: input.command.labId.trim(),
    dueAt: input.command.dueAt?.trim() || null,
    reason: input.command.reason.trim(),
  };
  if (!dueAt.ok || !command.sopId || !command.versionId || !command.labId || command.reason.length < 3) {
    return { ok: false as const, code: "validation_error", message: "Choose an approved version, target lab, optional due date, and reason." };
  }
  const commandType = "sop.assign";
  return executeIdempotentCommand({
    actor: input.actor,
    commandType,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: command,
    requiredCapability: "sops:manage",
    labId: input.actor.canonicalRole === "lab_user" ? input.actor.activeLabId : null,
    aggregateType: "sop_document",
    aggregateId: command.sopId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      const [principal, version, targetLab] = await Promise.all([
        getPrincipal(tx, input.actor.id),
        tx.sopVersion.findUnique({
          where: { id: command.versionId },
          include: { sop: true, approval: true },
        }),
        tx.lab.findUnique({ where: { id: command.labId }, select: { active: true } }),
      ]);
      if (!version || version.sopId !== command.sopId || version.approval?.decision !== "approved"
        || version.sop.currentVersionId !== version.id) {
        return { ok: false, code: "not_current", message: "Only the current approved immutable SOP version can be assigned." };
      }
      if (!targetLab?.active) return { ok: false, code: "not_found", message: "The target lab is not active." };
      const canAssign = principal && (
        (version.sop.scope === "facility" && (principal.canonicalRole === "facility_admin" || principal.canonicalRole === "cmu_staff"))
        || (version.sop.scope === "lab" && version.sop.labId === command.labId
          && principal.canonicalRole === "lab_user" && principal.managedLabIds.has(command.labId))
      );
      if (!canAssign) return { ok: false, code: "forbidden", message: "You cannot assign this SOP to the selected lab." };
      await setSopCommandContext(tx, { actorId: input.actor.id, commandType, receiptId: context.receiptId });
      const assignedAt = new Date();
      const previous = await tx.sopAssignment.findFirst({
        where: { sopId: command.sopId, labId: command.labId, revokedAt: null },
      });
      const assignmentId = randomUUID();
      const [updated] = await tx.$queryRaw<Array<{ resultingVersion: number }>>(Prisma.sql`
        SELECT "sop_assign_version"(
          ${assignmentId}, ${command.sopId}, ${version.id}, ${command.labId},
          CAST(${dueAt.value} AS TIMESTAMP(3)), ${command.reason}, ${input.actor.id}, CAST(${assignedAt} AS TIMESTAMP(3))
        ) AS "resultingVersion"
      `);
      if (!updated) throw new Error("SOP assignment did not return an aggregate version.");
      if (previous) {
        await cancelSopAssignmentOutbox(tx, previous.id, "SOP assignment was superseded before delivery.");
      }
      await enqueueOutboxMessage(tx, {
        topic: "sop.assignment",
        aggregateType: "sop_assignment",
        aggregateId: assignmentId,
        actor: input.actor,
        labId: command.labId,
        dedupeKey: `sop.assignment:${assignmentId}`,
        payload: {
          assignmentId,
          sopId: command.sopId,
          sopVersionId: version.id,
          contentHash: version.contentHash,
          labId: command.labId,
          dueAt: dueAt.value?.toISOString() ?? null,
        },
      });
      await writeSopAudit(tx, input.actor.id, "sop_assignment", assignmentId, "assign", null, {
        sopId: command.sopId,
        sopVersionId: version.id,
        labId: command.labId,
        dueAt: dueAt.value?.toISOString() ?? null,
        supersededAssignmentId: previous?.id ?? null,
      });
      return {
        ok: true,
        result: { documentId: command.sopId, assignmentId, versionId: version.id, labId: command.labId },
        resultingVersion: updated.resultingVersion,
      };
    },
  });
}

export async function executeRevokeSopAssignmentCommand(input: {
  actor: ResolvedActor;
  command: { assignmentId: string; expectedVersion: number; reason: string };
} & CommandIdentity) {
  const command = {
    assignmentId: input.command.assignmentId.trim(),
    expectedVersion: input.command.expectedVersion,
    reason: input.command.reason.trim(),
  };
  if (!command.assignmentId || !Number.isInteger(command.expectedVersion) || command.reason.length < 3) {
    return { ok: false as const, code: "validation_error", message: "Enter a reason before revoking the SOP assignment." };
  }
  const commandType = "sop.assignment.revoke";
  return executeIdempotentCommand({
    actor: input.actor,
    commandType,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: command,
    requiredCapability: "sops:manage",
    labId: input.actor.canonicalRole === "lab_user" ? input.actor.activeLabId : null,
    aggregateType: "sop_assignment",
    aggregateId: command.assignmentId,
    expectedVersion: command.expectedVersion,
    handler: async (tx, context) => {
      const [principal, assignment] = await Promise.all([
        getPrincipal(tx, input.actor.id),
        tx.sopAssignment.findUnique({ where: { id: command.assignmentId }, include: { sop: true } }),
      ]);
      if (!assignment) return { ok: false, code: "not_found", message: "SOP assignment not found." };
      if (assignment.version !== command.expectedVersion) return { ok: false, code: "stale_conflict", message: "This assignment changed. Refresh before trying again." };
      if (assignment.revokedAt) return { ok: false, code: "already_revoked", message: "This assignment is already revoked." };
      if (input.actor.canonicalRole === "lab_user" && assignment.labId !== input.actor.activeLabId) {
        return { ok: false, code: "not_found", message: "SOP assignment not found in the active lab." };
      }
      const canRevoke = principal && (
        (assignment.sop.scope === "facility" && (principal.canonicalRole === "facility_admin" || principal.canonicalRole === "cmu_staff"))
        || (assignment.sop.scope === "lab" && principal.canonicalRole === "lab_user" && principal.managedLabIds.has(assignment.labId))
      );
      if (!canRevoke) return { ok: false, code: "forbidden", message: "You cannot revoke this SOP assignment." };
      await setSopCommandContext(tx, { actorId: input.actor.id, commandType, receiptId: context.receiptId });
      const revokedAt = new Date();
      const [updated] = await tx.$queryRaw<Array<{ resultingVersion: number }>>(Prisma.sql`
        SELECT "sop_revoke_assignment"(
          ${assignment.id}, ${command.reason}, ${input.actor.id}, CAST(${revokedAt} AS TIMESTAMP(3))
        ) AS "resultingVersion"
      `);
      if (!updated) throw new Error("SOP assignment revocation did not return an aggregate version.");
      await cancelSopAssignmentOutbox(tx, assignment.id, "SOP assignment was revoked before delivery.");
      await writeSopAudit(tx, input.actor.id, "sop_assignment", assignment.id, "revoke", {
        version: assignment.version,
        revokedAt: null,
      }, { version: updated.resultingVersion, revokedAt: revokedAt.toISOString(), reason: command.reason });
      return {
        ok: true,
        result: { assignmentId: assignment.id, revokedAt: revokedAt.toISOString() },
      };
    },
  });
}

export async function executeAcknowledgeSopCommand(input: {
  actor: ResolvedActor;
  command: {
    assignmentId: string;
    expectedVersion: number;
    sopVersionId: string;
    contentHash: string;
    attestationConfirmed: boolean;
  };
} & CommandIdentity) {
  const command = {
    assignmentId: input.command.assignmentId.trim(),
    expectedVersion: input.command.expectedVersion,
    sopVersionId: input.command.sopVersionId.trim(),
    contentHash: input.command.contentHash.trim(),
    attestationConfirmed: input.command.attestationConfirmed,
  };
  if (!command.assignmentId
    || !Number.isInteger(command.expectedVersion)
    || !command.sopVersionId
    || !/^[0-9a-f]{64}$/.test(command.contentHash)
    || !command.attestationConfirmed) {
    return { ok: false as const, code: "validation_error", message: "Review the assigned exact SOP version and confirm the acknowledgement." };
  }
  const commandType = "sop.acknowledge";
  return executeIdempotentCommand({
    actor: input.actor,
    commandType,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: command,
    requiredCapability: "sops:read",
    labId: input.actor.activeLabId,
    aggregateType: "sop_assignment",
    aggregateId: command.assignmentId,
    expectedVersion: command.expectedVersion,
    handler: async (tx, context) => {
      const [principal, assignment] = await Promise.all([
        getPrincipal(tx, input.actor.id),
        tx.sopAssignment.findUnique({
          where: { id: command.assignmentId },
          include: { sopVersion: true },
        }),
      ]);
      if (!assignment || assignment.revokedAt) return { ok: false, code: "not_found", message: "The active SOP assignment was not found." };
      if (assignment.version !== command.expectedVersion
        || assignment.sopVersionId !== command.sopVersionId
        || assignment.sopVersion.contentHash !== command.contentHash) {
        return { ok: false, code: "stale_conflict", message: "The assigned SOP version changed. Review the current assignment before acknowledging." };
      }
      if (!principal
        || principal.canonicalRole !== "lab_user"
        || input.actor.activeLabId !== assignment.labId
        || !principal.memberLabIds.has(assignment.labId)) {
        return { ok: false, code: "forbidden", message: "Only an active member of the assigned lab can acknowledge this SOP." };
      }
      const existing = await tx.sopAcknowledgement.findUnique({
        where: { assignmentId_userId: { assignmentId: assignment.id, userId: input.actor.id } },
      });
      if (existing) {
        return {
          ok: true,
          result: { acknowledgementId: existing.id, assignmentId: assignment.id, acknowledgedAt: existing.acknowledgedAt.toISOString() },
        };
      }
      await setSopCommandContext(tx, { actorId: input.actor.id, commandType, receiptId: context.receiptId });
      const acknowledgementId = randomUUID();
      const acknowledgedAt = new Date();
      const attestation = "I reviewed and understand this exact SOP version.";
      await tx.$queryRaw(Prisma.sql`
        SELECT "sop_acknowledge_assignment"(
          ${acknowledgementId}, ${assignment.id}, ${assignment.sopId}, ${assignment.sopVersionId},
          ${assignment.labId}, ${input.actor.id}, ${assignment.sopVersion.contentHash},
          CAST(${acknowledgedAt} AS TIMESTAMP(3)), ${attestation}
        )
      `);
      await writeSopAudit(tx, input.actor.id, "sop_acknowledgement", acknowledgementId, "acknowledge", null, {
        assignmentId: assignment.id,
        sopVersionId: assignment.sopVersionId,
        labId: assignment.labId,
        contentHash: assignment.sopVersion.contentHash,
        acknowledgedAt: acknowledgedAt.toISOString(),
      });
      return {
        ok: true,
        result: { acknowledgementId, assignmentId: assignment.id, acknowledgedAt: acknowledgedAt.toISOString() },
      };
    },
  });
}
