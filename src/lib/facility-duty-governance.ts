import { randomUUID } from "node:crypto";

import { Prisma, type FacilityDuty } from "@prisma/client";

import { normalizeUserRole } from "@/lib/capabilities";
import { hasFreshMfaAssurance, isElevatedIdentityContextCurrent } from "@/lib/identity-assurance";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";

export const FACILITY_DUTY_REQUEST_EXPIRY_HOURS = 24;
export const FACILITY_DUTY_MIN_DURATION_MS = 60_000;
export const FACILITY_DUTY_MAX_DURATION_MS = 366 * 24 * 60 * 60 * 1_000;

export type DutyGovernanceActor = Pick<
  ResolvedActor,
  "id" | "email" | "canonicalRole" | "authzVersion" | "authMethod" | "assurance" | "authenticatedAt" | "identityLinkId"
>;

export type DutyGovernanceResult =
  | { ok: true; message: string; entityId: string }
  | { ok: false; message: string };

function currentMfaContext(actor: DutyGovernanceActor) {
  return hasFreshMfaAssurance({
    identity: actor.email,
    authenticationMethod: actor.authMethod,
    assurance: actor.assurance,
    authenticatedAt: actor.authenticatedAt,
  });
}

function actorCanGovern(actor: DutyGovernanceActor) {
  return actor.canonicalRole === "facility_admin" && currentMfaContext(actor);
}

function isGovernanceConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && ["P2002", "P2003", "P2025", "P2034"].includes(error.code);
}

async function actorSnapshotIsCurrent(tx: Prisma.TransactionClient, actor: DutyGovernanceActor) {
  const current = await tx.user.findUnique({
    where: { id: actor.id },
    select: { active: true, role: true, authzVersion: true },
  });
  return Boolean(
    current?.active
    && normalizeUserRole(current.role) === "facility_admin"
    && current.authzVersion === actor.authzVersion,
  ) && await isElevatedIdentityContextCurrent(tx, {
    userId: actor.id,
    identity: actor.email,
    identityLinkId: actor.identityLinkId,
    authenticationMethod: actor.authMethod,
    assurance: actor.assurance,
    authenticatedAt: actor.authenticatedAt,
  });
}

function assuranceEvidence(actor: DutyGovernanceActor) {
  if (!actor.assurance || !actor.identityLinkId || !actor.authenticatedAt) return null;
  const authenticatedAt = new Date(actor.authenticatedAt);
  if (Number.isNaN(authenticatedAt.getTime())) return null;
  return { assurance: actor.assurance, identityLinkId: actor.identityLinkId, authenticatedAt };
}

async function appendDutyEvent(
  tx: Prisma.TransactionClient,
  input: {
    requestId: string;
    assignmentId?: string | null;
    targetUserId: string;
    actorId: string;
    eventType: "requested" | "approved" | "rejected" | "expired" | "activated" | "revoked";
    detail?: Prisma.InputJsonValue;
  },
) {
  await tx.facilityDutyLifecycleEvent.create({
    data: {
      id: `duty-event-${randomUUID()}`,
      requestId: input.requestId,
      assignmentId: input.assignmentId ?? null,
      targetUserId: input.targetUserId,
      actorId: input.actorId,
      eventType: input.eventType,
      detail: input.detail,
    },
  });
}

async function expireRequest(
  tx: Prisma.TransactionClient,
  request: { id: string; targetUserId: string; version: number },
  actorId: string,
) {
  const changed = await tx.facilityDutyRequest.updateMany({
    where: { id: request.id, status: "pending", version: request.version },
    data: { status: "expired", version: { increment: 1 } },
  });
  if (changed.count) {
    await appendDutyEvent(tx, {
      requestId: request.id,
      targetUserId: request.targetUserId,
      actorId,
      eventType: "expired",
    });
  }
}

function rejectMissingAssurance(actor: DutyGovernanceActor): DutyGovernanceResult | null {
  if (actor.canonicalRole !== "facility_admin") {
    return { ok: false, message: "Only a current Facility Admin can manage facility duties." };
  }
  if (!currentMfaContext(actor)) {
    return { ok: false, message: "Fresh MFA-level assurance is required for facility duty governance." };
  }
  return null;
}

export async function requestFacilityDutyGrant(input: {
  targetUserId: string;
  duty: FacilityDuty;
  validFrom: Date;
  validUntil: Date;
  reason: string;
}, actor: DutyGovernanceActor): Promise<DutyGovernanceResult> {
  const assuranceError = rejectMissingAssurance(actor);
  if (assuranceError) return assuranceError;
  const evidence = assuranceEvidence(actor);
  if (!evidence) return { ok: false, message: "Fresh MFA-level assurance is required for facility duty governance." };
  const duration = input.validUntil.getTime() - input.validFrom.getTime();
  if (!Number.isFinite(duration) || duration < FACILITY_DUTY_MIN_DURATION_MS || duration > FACILITY_DUTY_MAX_DURATION_MS) {
    return { ok: false, message: "Duty grants must last between 1 minute and 366 days." };
  }
  if (input.reason.trim().length < 5 || input.reason.trim().length > 500) {
    return { ok: false, message: "Provide a reason between 5 and 500 characters." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!await actorSnapshotIsCurrent(tx, actor) || !actorCanGovern(actor)) {
        return { ok: false, message: "Your administrator authority or assurance changed. Sign in again." } as const;
      }
      const target = await tx.user.findUnique({
        where: { id: input.targetUserId },
        select: { id: true, active: true, role: true, authzVersion: true },
      });
      if (!target?.active || normalizeUserRole(target.role) === "it_head") {
        return { ok: false, message: "The target must be an active non-IT account." } as const;
      }

      const expired = await tx.facilityDutyRequest.findMany({
        where: { targetUserId: target.id, duty: input.duty, requestType: "grant", status: "pending", expiresAt: { lte: new Date() } },
        select: { id: true, targetUserId: true, version: true },
      });
      for (const request of expired) await expireRequest(tx, request, actor.id);

      const activeOrFuture = await tx.facilityDutyAssignment.findFirst({
        where: {
          userId: target.id,
          duty: input.duty,
          revokedAt: null,
          validFrom: { lt: input.validUntil },
          validUntil: { gt: input.validFrom },
        },
        select: { id: true },
      });
      if (activeOrFuture) return { ok: false, message: "That duty already overlaps the requested period." } as const;

      const request = await tx.facilityDutyRequest.create({
        data: {
          id: `duty-request-${randomUUID()}`,
          requestType: "grant",
          duty: input.duty,
          targetUserId: target.id,
          targetAuthzVersion: target.authzVersion,
          requestedValidFrom: input.validFrom,
          requestedValidUntil: input.validUntil,
          reason: input.reason.trim(),
          requestedById: actor.id,
          requestedByAuthzVersion: actor.authzVersion,
          requestedAssurance: evidence.assurance,
          requestedIdentityLinkId: evidence.identityLinkId,
          requestedAuthenticatedAt: evidence.authenticatedAt,
          expiresAt: new Date(Date.now() + FACILITY_DUTY_REQUEST_EXPIRY_HOURS * 60 * 60 * 1_000),
        },
      });
      await appendDutyEvent(tx, {
        requestId: request.id,
        targetUserId: target.id,
        actorId: actor.id,
        eventType: "requested",
        detail: { requestType: "grant", duty: input.duty },
      });
      return { ok: true, entityId: request.id, message: "Duty grant sent for independent approval." } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isGovernanceConflict(error)) return { ok: false, message: "The duty state changed. Refresh and try again." };
    throw error;
  }
}

export async function requestFacilityDutyRevoke(input: {
  assignmentId: string;
  assignmentVersion: number;
  reason: string;
}, actor: DutyGovernanceActor): Promise<DutyGovernanceResult> {
  const assuranceError = rejectMissingAssurance(actor);
  if (assuranceError) return assuranceError;
  const evidence = assuranceEvidence(actor);
  if (!evidence) return { ok: false, message: "Fresh MFA-level assurance is required for facility duty governance." };
  if (input.reason.trim().length < 5 || input.reason.trim().length > 500) {
    return { ok: false, message: "Provide a reason between 5 and 500 characters." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!await actorSnapshotIsCurrent(tx, actor)) {
        return { ok: false, message: "Your administrator authority changed. Sign in again." } as const;
      }
      const assignment = await tx.facilityDutyAssignment.findUnique({
        where: { id: input.assignmentId },
        include: { user: { select: { active: true, role: true, authzVersion: true } } },
      });
      if (!assignment
        || assignment.version !== input.assignmentVersion
        || assignment.revokedAt
        || assignment.validUntil <= new Date()
        || !assignment.user.active
        || normalizeUserRole(assignment.user.role) === "it_head") {
        return { ok: false, message: "The duty assignment is unavailable or stale." } as const;
      }
      const expired = await tx.facilityDutyRequest.findMany({
        where: { assignmentId: assignment.id, requestType: "revoke", status: "pending", expiresAt: { lte: new Date() } },
        select: { id: true, targetUserId: true, version: true },
      });
      for (const request of expired) await expireRequest(tx, request, actor.id);

      const request = await tx.facilityDutyRequest.create({
        data: {
          id: `duty-request-${randomUUID()}`,
          requestType: "revoke",
          duty: assignment.duty,
          targetUserId: assignment.userId,
          targetAuthzVersion: assignment.user.authzVersion,
          assignmentId: assignment.id,
          assignmentVersion: assignment.version,
          reason: input.reason.trim(),
          requestedById: actor.id,
          requestedByAuthzVersion: actor.authzVersion,
          requestedAssurance: evidence.assurance,
          requestedIdentityLinkId: evidence.identityLinkId,
          requestedAuthenticatedAt: evidence.authenticatedAt,
          expiresAt: new Date(Date.now() + FACILITY_DUTY_REQUEST_EXPIRY_HOURS * 60 * 60 * 1_000),
        },
      });
      await appendDutyEvent(tx, {
        requestId: request.id,
        assignmentId: assignment.id,
        targetUserId: assignment.userId,
        actorId: actor.id,
        eventType: "requested",
        detail: { requestType: "revoke", assignmentVersion: assignment.version },
      });
      return { ok: true, entityId: request.id, message: "Duty revocation sent for independent approval." } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isGovernanceConflict(error)) return { ok: false, message: "The duty state changed. Refresh and try again." };
    throw error;
  }
}

export async function decideFacilityDutyRequest(input: {
  requestId: string;
  expectedVersion: number;
  decision: "approve" | "reject";
  reason?: string;
}, actor: DutyGovernanceActor): Promise<DutyGovernanceResult> {
  const assuranceError = rejectMissingAssurance(actor);
  if (assuranceError) return assuranceError;
  const evidence = assuranceEvidence(actor);
  if (!evidence) return { ok: false, message: "Fresh MFA-level assurance is required for facility duty governance." };
  if (input.decision === "reject" && (!input.reason || input.reason.trim().length < 5 || input.reason.trim().length > 500)) {
    return { ok: false, message: "Provide a rejection reason between 5 and 500 characters." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!await actorSnapshotIsCurrent(tx, actor)) {
        return { ok: false, message: "Your administrator authority changed. Sign in again." } as const;
      }
      const request = await tx.facilityDutyRequest.findUnique({
        where: { id: input.requestId },
        include: {
          requestedBy: { select: { active: true, role: true, authzVersion: true } },
          targetUser: { select: { active: true, role: true, authzVersion: true } },
          assignment: true,
        },
      });
      if (!request || request.status !== "pending" || request.version !== input.expectedVersion) {
        return { ok: false, message: "The duty request is unavailable or stale." } as const;
      }
      if (request.expiresAt <= new Date()) {
        await expireRequest(tx, request, actor.id);
        return { ok: false, message: "The duty request expired. Submit a new request." } as const;
      }
      if (actor.id === request.requestedById || actor.id === request.targetUserId) {
        return { ok: false, message: "A different Facility Admin must decide this request." } as const;
      }
      if (!request.requestedBy.active
        || normalizeUserRole(request.requestedBy.role) !== "facility_admin"
        || request.requestedBy.authzVersion !== request.requestedByAuthzVersion
        || !request.targetUser.active
        || normalizeUserRole(request.targetUser.role) === "it_head"
        || request.targetUser.authzVersion !== request.targetAuthzVersion) {
        await expireRequest(tx, request, actor.id);
        return { ok: false, message: "Requester or target authority changed. Submit a new request." } as const;
      }
      if (request.requestType === "revoke"
        && (!request.assignment
          || request.assignment.version !== request.assignmentVersion
          || request.assignment.revokedAt
          || request.assignment.validUntil <= new Date())) {
        return { ok: false, message: "The duty assignment changed. Submit a new revocation request." } as const;
      }

      const now = new Date();
      if (input.decision === "reject") {
        await tx.facilityDutyRequest.update({
          where: { id: request.id },
          data: {
            status: "rejected",
            decidedById: actor.id,
            decidedByAuthzVersion: actor.authzVersion,
            decidedAssurance: evidence.assurance,
            decidedIdentityLinkId: evidence.identityLinkId,
            decidedAuthenticatedAt: evidence.authenticatedAt,
            decisionReason: input.reason?.trim(),
            decidedAt: now,
            version: { increment: 1 },
          },
        });
        await appendDutyEvent(tx, {
          requestId: request.id,
          assignmentId: request.assignmentId,
          targetUserId: request.targetUserId,
          actorId: actor.id,
          eventType: "rejected",
          detail: { reason: input.reason?.trim() ?? "" },
        });
        return { ok: true, entityId: request.id, message: "Duty request rejected." } as const;
      }

      await tx.facilityDutyRequest.update({
        where: { id: request.id },
        data: {
          status: "approved",
          decidedById: actor.id,
          decidedByAuthzVersion: actor.authzVersion,
          decidedAssurance: evidence.assurance,
          decidedIdentityLinkId: evidence.identityLinkId,
          decidedAuthenticatedAt: evidence.authenticatedAt,
          decidedAt: now,
          version: { increment: 1 },
        },
      });

      let assignmentId: string;
      if (request.requestType === "grant") {
        if (!request.requestedValidFrom || !request.requestedValidUntil) throw new Error("Approved duty grant is missing validity.");
        assignmentId = `duty-assignment-${randomUUID()}`;
        await tx.facilityDutyAssignment.create({
          data: {
            id: assignmentId,
            userId: request.targetUserId,
            duty: request.duty,
            validFrom: request.requestedValidFrom,
            validUntil: request.requestedValidUntil,
            grantRequestId: request.id,
          },
        });
        await appendDutyEvent(tx, { requestId: request.id, assignmentId, targetUserId: request.targetUserId, actorId: actor.id, eventType: "activated" });
      } else {
        if (!request.assignment) throw new Error("Approved duty revocation is missing its assignment binding.");
        assignmentId = request.assignment.id;
        await tx.facilityDutyAssignment.update({
          where: { id: assignmentId },
          data: { revokeRequestId: request.id, revokedAt: now, version: { increment: 1 } },
        });
        await appendDutyEvent(tx, { requestId: request.id, assignmentId, targetUserId: request.targetUserId, actorId: actor.id, eventType: "revoked" });
      }

      await tx.user.update({ where: { id: request.targetUserId }, data: { authzVersion: { increment: 1 } } });
      await appendDutyEvent(tx, {
        requestId: request.id,
        assignmentId,
        targetUserId: request.targetUserId,
        actorId: actor.id,
        eventType: "approved",
        detail: { requestType: request.requestType },
      });
      return {
        ok: true,
        entityId: assignmentId,
        message: request.requestType === "grant" ? "Duty granted." : "Duty revoked.",
      } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isGovernanceConflict(error)) return { ok: false, message: "The duty request changed. Refresh and try again." };
    throw error;
  }
}

export async function getFacilityDutyWorkspace(actor: Pick<DutyGovernanceActor, "canonicalRole">) {
  if (actor.canonicalRole !== "facility_admin") return { assignments: [], pendingRequests: [], users: [] };
  const now = new Date();
  const [assignments, pendingRequests, users] = await Promise.all([
    prisma.facilityDutyAssignment.findMany({
      orderBy: [{ revokedAt: "asc" }, { validUntil: "asc" }, { id: "asc" }],
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.facilityDutyRequest.findMany({
      where: { status: "pending", expiresAt: { gt: now } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        targetUser: { select: { id: true, name: true, email: true } },
        requestedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.user.findMany({
      where: { active: true, role: { not: "it_head" } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, email: true, role: true },
    }),
  ]);
  return { assignments, pendingRequests, users };
}

export async function getFacilityDutyApprovalQueue(actor: Pick<DutyGovernanceActor, "canonicalRole">) {
  if (actor.canonicalRole !== "facility_admin") return [];
  return prisma.facilityDutyRequest.findMany({
    where: { status: "pending", expiresAt: { gt: new Date() } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      targetUser: { select: { id: true, name: true, email: true } },
      requestedBy: { select: { id: true, name: true } },
    },
  });
}
