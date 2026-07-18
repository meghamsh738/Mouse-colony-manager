import { createHash, randomBytes, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { normalizeUserRole } from "@/lib/capabilities";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { writeSecurityEvent } from "@/lib/security-event";
import type { CanonicalUserRole, LabMembershipRole } from "@/lib/types";

export type GovernanceActor = {
  id: string;
  canonicalRole: CanonicalUserRole;
  authzVersion: number;
};

type CreateInvitationInput = {
  email: string;
  name?: string;
  targetRole: "cmu_staff" | "lab_user";
  labId?: string;
  membershipRole?: LabMembershipRole;
  expiresInHours?: number;
};

export type GovernanceResult =
  | { ok: true; message: string; entityId: string; token?: string }
  | { ok: false; message: string };

const GOVERNANCE_REASON_MAX = 350;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function canonicalEmail(email: string) {
  return email.trim().toLowerCase();
}

function isGovernanceConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2002" || error.code === "P2025" || error.code === "P2034");
}

function expiresAt(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

async function revokePendingInvitations(
  tx: Prisma.TransactionClient,
  input: { actorId: string; email: string; exceptId?: string; reason?: string },
) {
  const pending = await tx.userInvitation.findMany({
    where: {
      email: input.email,
      status: "pending",
      ...(input.exceptId ? { id: { not: input.exceptId } } : {}),
    },
    select: { id: true, labId: true },
  });

  for (const invitation of pending) {
    await tx.userInvitation.update({
      where: { id: invitation.id },
      data: { status: "revoked", revokedAt: new Date() },
    });
    await writeSecurityEvent(tx, {
      eventType: "identity.invitation.revoked",
      outcome: "succeeded",
      severity: "warning",
      actorId: input.actorId,
      scopeLabId: invitation.labId,
      correlationId: invitation.id,
      dedupeKey: `identity.invitation.revoked:${invitation.id}`,
      subjectType: "user_invitation",
      subjectId: invitation.id,
      source: "identity_governance",
      summary: input.reason
        ? `User invitation revoked: ${input.reason.trim()}`
        : "User invitation revoked.",
    });
  }
}

async function governanceActorIsCurrent(tx: Prisma.TransactionClient, actor: GovernanceActor) {
  const current = await tx.user.findUnique({
    where: { id: actor.id },
    select: { active: true, role: true, authzVersion: true },
  });

  return Boolean(
    current?.active &&
    normalizeUserRole(current.role) === "facility_admin" &&
    current.authzVersion === actor.authzVersion,
  );
}

export async function createUserInvitation(
  input: CreateInvitationInput,
  actor: GovernanceActor,
): Promise<GovernanceResult> {
  if (actor.canonicalRole !== "facility_admin") {
    return { ok: false, message: "Only Facility Admin can invite users." };
  }

  const email = canonicalEmail(input.email);

  if (!email.includes("@") || email.length > 254) {
    return { ok: false, message: "Enter a valid invitation email." };
  }

  if (input.targetRole === "lab_user" && (!input.labId || !input.membershipRole)) {
    return { ok: false, message: "Lab User invitations require a lab and membership role." };
  }

  if (input.targetRole === "cmu_staff" && (input.labId || input.membershipRole)) {
    return { ok: false, message: "CMU Staff invitations cannot include lab membership authority." };
  }

  const hours = Math.min(Math.max(input.expiresInHours ?? 72, 1), 168);
  const token = randomBytes(32).toString("base64url");

  return prisma.$transaction(async (tx) => {
    if (!(await governanceActorIsCurrent(tx, actor))) {
      return { ok: false, message: "Your administrator access changed. Sign in again." } as const;
    }

    const [existingUser, lab] = await Promise.all([
      tx.user.findUnique({ where: { email }, select: { id: true } }),
      input.labId
        ? tx.lab.findUnique({ where: { id: input.labId }, select: { id: true, active: true } })
        : Promise.resolve(null),
    ]);

    if (existingUser) {
      return { ok: false, message: "That email already belongs to a user." } as const;
    }

    if (input.labId && !lab?.active) {
      return { ok: false, message: "The selected lab is unavailable." } as const;
    }

    await revokePendingInvitations(tx, {
      actorId: actor.id,
      email,
      reason: "Superseded by a new invitation.",
    });

    const invitation = await tx.userInvitation.create({
      data: {
        id: `invitation-${randomUUID()}`,
        email,
        name: input.name?.trim() || null,
        tokenHash: tokenHash(token),
        targetRole: input.targetRole,
        labId: input.targetRole === "lab_user" ? input.labId : null,
        membershipRole: input.targetRole === "lab_user" ? input.membershipRole : null,
        invitedById: actor.id,
        expiresAt: expiresAt(hours),
      },
    });

    await writeSecurityEvent(tx, {
      eventType: "identity.invitation.created",
      outcome: "succeeded",
      actorId: actor.id,
      scopeLabId: invitation.labId,
      correlationId: invitation.id,
      dedupeKey: `identity.invitation.created:${invitation.id}`,
      subjectType: "user_invitation",
      subjectId: invitation.id,
      source: "identity_governance",
      summary: "User invitation created.",
    });

    return {
      ok: true,
      entityId: invitation.id,
      token,
      message: `Invitation created for ${email}.`,
    } as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error) => {
    if (isGovernanceConflict(error)) {
      return { ok: false, message: "The invitation changed while it was being created. Refresh and try again." } as const;
    }
    throw error;
  });
}

export async function revokeUserInvitation(
  invitationId: string,
  reason: string,
  actor: GovernanceActor,
): Promise<GovernanceResult> {
  if (actor.canonicalRole !== "facility_admin") {
    return { ok: false, message: "Only Facility Admin can revoke invitations." };
  }
  if (reason.trim().length < 5 || reason.trim().length > 400) {
    return { ok: false, message: "Provide a revocation reason." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await governanceActorIsCurrent(tx, actor))) {
        return { ok: false, message: "Your administrator access changed. Sign in again." } as const;
      }

      const invitation = await tx.userInvitation.findUnique({
        where: { id: invitationId },
        select: { id: true, email: true, labId: true, status: true },
      });
      if (!invitation || invitation.status !== "pending") {
        return { ok: false, message: "This invitation is no longer pending." } as const;
      }

      await revokePendingInvitations(tx, { actorId: actor.id, email: invitation.email, reason });
      return { ok: true, entityId: invitation.id, message: "Invitation revoked." } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isGovernanceConflict(error)) {
      return { ok: false, message: "The invitation changed while it was being revoked. Refresh and try again." };
    }
    throw error;
  }
}

export async function resendUserInvitation(
  invitationId: string,
  actor: GovernanceActor,
  expiresInHours = 72,
): Promise<GovernanceResult> {
  if (actor.canonicalRole !== "facility_admin") {
    return { ok: false, message: "Only Facility Admin can resend invitations." };
  }

  const token = randomBytes(32).toString("base64url");
  const hours = Math.min(Math.max(expiresInHours, 1), 168);

  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await governanceActorIsCurrent(tx, actor))) {
        return { ok: false, message: "Your administrator access changed. Sign in again." } as const;
      }

      const invitation = await tx.userInvitation.findUnique({
        where: { id: invitationId },
        include: { lab: { select: { active: true } } },
      });
      if (!invitation || invitation.status === "accepted") {
        return { ok: false, message: "This invitation cannot be resent." } as const;
      }
      if (invitation.labId && !invitation.lab?.active) {
        return { ok: false, message: "The invitation lab is inactive." } as const;
      }
      const existingUser = await tx.user.findUnique({
        where: { email: invitation.email },
        select: { id: true },
      });
      if (existingUser) {
        return { ok: false, message: "That email already belongs to a user." } as const;
      }

      await revokePendingInvitations(tx, {
        actorId: actor.id,
        email: invitation.email,
        reason: "Superseded by a reissued invitation.",
      });
      const resent = await tx.userInvitation.create({
        data: {
          id: `invitation-${randomUUID()}`,
          email: invitation.email,
          name: invitation.name,
          tokenHash: tokenHash(token),
          targetRole: invitation.targetRole,
          labId: invitation.labId,
          membershipRole: invitation.membershipRole,
          invitedById: actor.id,
          expiresAt: expiresAt(hours),
        },
      });
      await writeSecurityEvent(tx, {
        eventType: "identity.invitation.resent",
        outcome: "succeeded",
        actorId: actor.id,
        scopeLabId: resent.labId,
        correlationId: invitation.id,
        dedupeKey: `identity.invitation.resent:${resent.id}`,
        subjectType: "user_invitation",
        subjectId: resent.id,
        source: "identity_governance",
        summary: "User invitation resent.",
      });

      return {
        ok: true,
        entityId: resent.id,
        token,
        message: `Invitation resent to ${resent.email}.`,
      } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      return { ok: false, message: "The invitation changed while it was being resent. Refresh and try again." };
    }
    throw error;
  }
}

export async function getInvitationPreview(token: string) {
  if (!token || token.length < 32) {
    return null;
  }

  const invitation = await prisma.userInvitation.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: {
      id: true,
      email: true,
      name: true,
      targetRole: true,
      membershipRole: true,
      status: true,
      expiresAt: true,
      lab: { select: { name: true, code: true } },
    },
  });

  if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= new Date()) {
    return null;
  }

  return invitation;
}

export async function getPrivilegedRoleApprovalQueue(actor: Pick<GovernanceActor, "canonicalRole">) {
  if (actor.canonicalRole !== "facility_admin") return [];
  return prisma.privilegedRoleChangeRequest.findMany({
    where: { status: "pending", expiresAt: { gt: new Date() } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      requestedRole: true,
      requestedActive: true,
      reason: true,
      expiresAt: true,
      createdAt: true,
      targetUser: { select: { id: true, name: true, email: true, role: true } },
      requestedBy: { select: { id: true, name: true } },
    },
  });
}

export async function acceptUserInvitation(input: {
  token: string;
  name: string;
  password: string;
}): Promise<GovernanceResult> {
  if (input.password.length < 12) {
    return { ok: false, message: "Use a password with at least 12 characters." };
  }

  const name = input.name.trim();

  if (name.length < 2 || name.length > 120) {
    return { ok: false, message: "Enter your name." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const invitation = await tx.userInvitation.findUnique({
        where: { tokenHash: tokenHash(input.token) },
        include: { lab: { select: { active: true } } },
      });

      if (!invitation || invitation.status !== "pending") {
        return { ok: false, message: "This invitation is unavailable." } as const;
      }

      if (invitation.expiresAt <= new Date()) {
        await tx.userInvitation.update({
          where: { id: invitation.id },
          data: { status: "expired" },
        });
        return { ok: false, message: "This invitation has expired." } as const;
      }

      if (invitation.labId && !invitation.lab?.active) {
        return { ok: false, message: "The lab assigned to this invitation is unavailable." } as const;
      }

      const existing = await tx.user.findUnique({ where: { email: invitation.email }, select: { id: true } });

      if (existing) {
        return { ok: false, message: "That email already belongs to a user." } as const;
      }

      const user = await tx.user.create({
        data: {
          id: `user-${randomUUID()}`,
          name,
          email: invitation.email,
          passwordHash: hashPassword(input.password),
          role: invitation.targetRole,
          active: true,
        },
      });

      if (invitation.targetRole === "lab_user") {
        if (!invitation.labId || !invitation.membershipRole) {
          throw new Error("Lab User invitation is missing its lab authority.");
        }

        await tx.labMembership.create({
          data: {
            id: `membership-${randomUUID()}`,
            labId: invitation.labId,
            userId: user.id,
            role: invitation.membershipRole,
            active: true,
          },
        });
      }

      await tx.userInvitation.update({
        where: { id: invitation.id },
        data: { status: "accepted", acceptedAt: new Date() },
      });
      await writeSecurityEvent(tx, {
        eventType: "identity.invitation.accepted",
        outcome: "succeeded",
        actorId: user.id,
        scopeLabId: invitation.labId,
        correlationId: invitation.id,
        dedupeKey: `identity.invitation.accepted:${invitation.id}`,
        subjectType: "user",
        subjectId: user.id,
        source: "identity_governance",
        summary: "User invitation accepted.",
      });

      return { ok: true, entityId: user.id, message: "Account activated. You can now sign in." } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isGovernanceConflict(error)) {
      return { ok: false, message: "This invitation is unavailable." };
    }
    throw error;
  }
}

export async function requestPrivilegedRoleChange(input: {
  targetUserId: string;
  requestedRole: CanonicalUserRole;
  reason: string;
}, actor: GovernanceActor): Promise<GovernanceResult> {
  if (actor.canonicalRole !== "facility_admin") {
    return { ok: false, message: "Only Facility Admin can request privileged role changes." };
  }

  if (input.targetUserId === actor.id) {
    return { ok: false, message: "You cannot request a global role change for yourself." };
  }

  if (input.reason.trim().length < 5 || input.reason.trim().length > GOVERNANCE_REASON_MAX) {
    return { ok: false, message: "Provide a reason for the role change." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await governanceActorIsCurrent(tx, actor))) {
        return { ok: false, message: "Your administrator access changed. Sign in again." } as const;
      }

      const target = await tx.user.findUnique({
        where: { id: input.targetUserId },
        select: {
          id: true,
          role: true,
          active: true,
          labMemberships: { where: { active: true, lab: { active: true } }, take: 1, select: { id: true } },
        },
      });
      if (!target?.active) {
        return { ok: false, message: "The target user is unavailable." } as const;
      }

      const currentRole = normalizeUserRole(target.role);
      if (currentRole === input.requestedRole) {
        return { ok: true, entityId: target.id, message: "The user already has that global role." } as const;
      }
      if (![currentRole, input.requestedRole].some((role) => role === "it_head" || role === "facility_admin")) {
        return { ok: false, message: "Routine CMU and Lab User changes do not use privileged approval." } as const;
      }
      if (input.requestedRole === "lab_user" && target.labMemberships.length === 0) {
        return { ok: false, message: "Assign an active lab membership before changing this user to Lab User." } as const;
      }

      await tx.privilegedRoleChangeRequest.updateMany({
        where: { targetUserId: target.id, status: "pending", expiresAt: { lte: new Date() } },
        data: { status: "expired" },
      });
      const existing = await tx.privilegedRoleChangeRequest.findFirst({
        where: { targetUserId: target.id, status: "pending" },
        select: { id: true },
      });

      if (existing) {
        return { ok: false, message: "A privileged role request is already pending for this user." } as const;
      }

      const request = await tx.privilegedRoleChangeRequest.create({
        data: {
          id: `role-change-${randomUUID()}`,
          targetUserId: target.id,
          requestedRole: input.requestedRole,
          reason: input.reason.trim(),
          requestedById: actor.id,
          requestedByAuthzVersion: actor.authzVersion,
          expiresAt: expiresAt(24),
        },
      });
      await writeSecurityEvent(tx, {
        eventType: "identity.role_change.requested",
        outcome: "succeeded",
        severity: "warning",
        actorId: actor.id,
        correlationId: request.id,
        dedupeKey: `identity.role_change.requested:${request.id}`,
        subjectType: "user",
        subjectId: target.id,
        source: "identity_governance",
        summary: `Privileged role change requested from ${currentRole} to ${input.requestedRole}. Reason: ${input.reason.trim()}`,
      });

      return { ok: true, entityId: request.id, message: "Privileged role change requested." } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      return { ok: false, message: "A privileged role request is already pending for this user." };
    }
    throw error;
  }
}

export async function approvePrivilegedRoleChange(
  requestId: string,
  actor: GovernanceActor,
): Promise<GovernanceResult> {
  if (actor.canonicalRole !== "facility_admin") {
    return { ok: false, message: "Only Facility Admin can approve privileged role changes." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await governanceActorIsCurrent(tx, actor))) {
        return { ok: false, message: "Your administrator access changed. Sign in again." } as const;
      }

    const request = await tx.privilegedRoleChangeRequest.findUnique({
      where: { id: requestId },
      include: {
        requestedBy: {
          select: { id: true, active: true, role: true, authzVersion: true },
        },
        targetUser: {
          select: {
            id: true,
            role: true,
            active: true,
            labMemberships: { where: { active: true, lab: { active: true } }, take: 1, select: { id: true } },
          },
        },
      },
    });

    if (!request || request.status !== "pending") {
      return { ok: false, message: "This privileged role request is unavailable." } as const;
    }

    if (request.expiresAt <= new Date()) {
      await tx.privilegedRoleChangeRequest.update({
        where: { id: request.id },
        data: { status: "expired" },
      });
      return { ok: false, message: "This privileged role request has expired." } as const;
    }

    if (actor.id === request.requestedById || actor.id === request.targetUserId) {
      return { ok: false, message: "Approval requires a different Facility Admin." } as const;
    }

    if (
      !request.requestedBy.active
      || normalizeUserRole(request.requestedBy.role) !== "facility_admin"
      || request.requestedBy.authzVersion !== request.requestedByAuthzVersion
    ) {
      await tx.privilegedRoleChangeRequest.update({
        where: { id: request.id },
        data: { status: "expired" },
      });
      return { ok: false, message: "The requesting administrator's authority changed. Submit a new request." } as const;
    }

    if (request.requestedActive === null && !request.targetUser.active) {
      return { ok: false, message: "The target user is unavailable." } as const;
    }

    const currentRole = normalizeUserRole(request.targetUser.role);
    if (request.requestedActive !== null) {
      if (currentRole !== "facility_admin" && currentRole !== "it_head") {
        return { ok: false, message: "This request no longer represents a privileged account state change." } as const;
      }
      if (request.targetUser.active === request.requestedActive) {
        return { ok: false, message: "The target account state changed. Submit a new request." } as const;
      }
      if (!request.requestedActive) {
        const roleValues = currentRole === "facility_admin" ? ["facility_admin", "admin"] as const : ["it_head"] as const;
        const remaining = await tx.user.count({
          where: { active: true, role: { in: [...roleValues] }, id: { not: request.targetUserId } },
        });
        if (remaining === 0) {
          return { ok: false, message: `The final ${currentRole.replaceAll("_", " ")} account cannot be deactivated.` } as const;
        }
        const activeResponsibility = await tx.cageUserAssignment.findFirst({
          where: { userId: request.targetUserId, endedAt: null },
          select: { cage: { select: { barcode: true } } },
        });
        if (activeResponsibility) {
          return {
            ok: false,
            message: `Reassign active cages before deactivating this account. ${activeResponsibility.cage.barcode} is still assigned.`,
          } as const;
        }
      }

      await tx.user.update({
        where: { id: request.targetUserId },
        data: { active: request.requestedActive, authzVersion: { increment: 1 } },
      });
      await tx.privilegedRoleChangeRequest.update({
        where: { id: request.id },
        data: { status: "approved", approvedById: actor.id, approvedAt: new Date() },
      });
      await writeSecurityEvent(tx, {
        eventType: request.requestedActive ? "identity.account.activation.approved" : "identity.account.deactivation.approved",
        outcome: "succeeded",
        severity: "critical",
        actorId: actor.id,
        correlationId: request.id,
        dedupeKey: `identity.account.state.approved:${request.id}`,
        subjectType: "user",
        subjectId: request.targetUserId,
        source: "identity_governance",
        summary: `Privileged ${currentRole} account ${request.requestedActive ? "activation" : "deactivation"} approved.`,
      });
      return {
        ok: true,
        entityId: request.targetUserId,
        message: `Privileged account ${request.requestedActive ? "activated" : "deactivated"}.`,
      } as const;
    }

    if (![currentRole, request.requestedRole].some((role) => role === "it_head" || role === "facility_admin")) {
      return { ok: false, message: "This request no longer represents a privileged role change." } as const;
    }
    if (request.requestedRole === "lab_user" && request.targetUser.labMemberships.length === 0) {
      return { ok: false, message: "Assign an active lab membership before changing this user to Lab User." } as const;
    }

    if (currentRole === "facility_admin" || currentRole === "it_head") {
      const roleValues = currentRole === "facility_admin" ? ["facility_admin", "admin"] as const : ["it_head"] as const;
      const remaining = await tx.user.count({
        where: { active: true, role: { in: [...roleValues] }, id: { not: request.targetUserId } },
      });

      if (remaining === 0 && request.requestedRole !== currentRole) {
        return { ok: false, message: `The final ${currentRole.replaceAll("_", " ")} account cannot be removed.` } as const;
      }
    }

    await tx.user.update({
      where: { id: request.targetUserId },
      data: { role: request.requestedRole, authzVersion: { increment: 1 } },
    });
    await tx.privilegedRoleChangeRequest.update({
      where: { id: request.id },
      data: { status: "approved", approvedById: actor.id, approvedAt: new Date() },
    });
    await writeSecurityEvent(tx, {
      eventType: "identity.role_change.approved",
      outcome: "succeeded",
      severity: "critical",
      actorId: actor.id,
      correlationId: request.id,
      dedupeKey: `identity.role_change.approved:${request.id}`,
      subjectType: "user",
      subjectId: request.targetUserId,
      source: "identity_governance",
      summary: `Privileged role change approved from ${currentRole} to ${request.requestedRole}.`.slice(0, 500),
    });

      return { ok: true, entityId: request.targetUserId, message: "Privileged role change approved." } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isGovernanceConflict(error)) {
      return { ok: false, message: "This privileged role request changed. Refresh and try again." };
    }
    throw error;
  }
}

export async function rejectPrivilegedRoleChange(
  requestId: string,
  reason: string,
  actor: GovernanceActor,
): Promise<GovernanceResult> {
  if (actor.canonicalRole !== "facility_admin") {
    return { ok: false, message: "Only Facility Admin can reject privileged role changes." };
  }
  if (reason.trim().length < 5 || reason.trim().length > GOVERNANCE_REASON_MAX) {
    return { ok: false, message: "Provide a rejection reason." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await governanceActorIsCurrent(tx, actor))) {
        return { ok: false, message: "Your administrator access changed. Sign in again." } as const;
      }

    const request = await tx.privilegedRoleChangeRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        targetUserId: true,
        requestedById: true,
        requestedByAuthzVersion: true,
        status: true,
        expiresAt: true,
        requestedBy: { select: { active: true, role: true, authzVersion: true } },
      },
    });
    if (!request || request.status !== "pending") {
      return { ok: false, message: "This privileged role request is unavailable." } as const;
    }
    if (request.expiresAt <= new Date()) {
      await tx.privilegedRoleChangeRequest.update({
        where: { id: request.id },
        data: { status: "expired" },
      });
      return { ok: false, message: "This privileged role request has expired." } as const;
    }
    if (actor.id === request.requestedById || actor.id === request.targetUserId) {
      return { ok: false, message: "A different Facility Admin must decide this request." } as const;
    }
    if (
      !request.requestedBy.active
      || normalizeUserRole(request.requestedBy.role) !== "facility_admin"
      || request.requestedBy.authzVersion !== request.requestedByAuthzVersion
    ) {
      await tx.privilegedRoleChangeRequest.update({
        where: { id: request.id },
        data: { status: "expired" },
      });
      return { ok: false, message: "The requesting administrator's authority changed. The request was expired." } as const;
    }

    await tx.privilegedRoleChangeRequest.update({
      where: { id: request.id },
      data: {
        status: "rejected",
        approvedById: actor.id,
        rejectedAt: new Date(),
      },
    });
    await writeSecurityEvent(tx, {
      eventType: "identity.role_change.rejected",
      outcome: "succeeded",
      severity: "warning",
      actorId: actor.id,
      correlationId: request.id,
      dedupeKey: `identity.role_change.rejected:${request.id}`,
      subjectType: "user",
      subjectId: request.targetUserId,
      source: "identity_governance",
      summary: `Privileged access request rejected. Reason: ${reason.trim()}`,
    });

      return { ok: true, entityId: request.targetUserId, message: "Privileged role change rejected." } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isGovernanceConflict(error)) {
      return { ok: false, message: "This privileged role request changed. Refresh and try again." };
    }
    throw error;
  }
}

export async function changeRoutineUserRole(input: {
  targetUserId: string;
  requestedRole: "cmu_staff" | "lab_user";
  reason: string;
}, actor: GovernanceActor): Promise<GovernanceResult> {
  if (actor.canonicalRole !== "facility_admin") {
    return { ok: false, message: "Only Facility Admin can change routine global access." };
  }
  if (actor.id === input.targetUserId) {
    return { ok: false, message: "You cannot change your own global role." };
  }
  if (input.reason.trim().length < 5 || input.reason.trim().length > GOVERNANCE_REASON_MAX) {
    return { ok: false, message: "Provide a reason for the role change." };
  }

  return prisma.$transaction(async (tx) => {
    if (!(await governanceActorIsCurrent(tx, actor))) {
      return { ok: false, message: "Your administrator access changed. Sign in again." } as const;
    }

    const target = await tx.user.findUnique({
      where: { id: input.targetUserId },
      select: {
        id: true,
        role: true,
        active: true,
        labMemberships: { where: { active: true, lab: { active: true } }, take: 1, select: { id: true } },
      },
    });
    if (!target?.active) return { ok: false, message: "The target user is unavailable." } as const;

    const currentRole = normalizeUserRole(target.role);
    if ([currentRole, input.requestedRole].some((role) => role === "it_head" || role === "facility_admin")) {
      return { ok: false, message: "Privileged role changes require independent approval." } as const;
    }
    if (input.requestedRole === "lab_user" && target.labMemberships.length === 0) {
      return { ok: false, message: "Assign an active lab membership before changing this user to Lab User." } as const;
    }
    if (currentRole === input.requestedRole) {
      return { ok: true, entityId: target.id, message: "The user already has that global role." } as const;
    }

    await tx.user.update({
      where: { id: target.id },
      data: { role: input.requestedRole, authzVersion: { increment: 1 } },
    });
    const securityRequestId = randomUUID();
    await writeSecurityEvent(tx, {
      eventType: "identity.role_change.completed",
      outcome: "succeeded",
      severity: "warning",
      actorId: actor.id,
      correlationId: securityRequestId,
      dedupeKey: `identity.role_change.completed:${securityRequestId}`,
      subjectType: "user",
      subjectId: target.id,
      source: "identity_governance",
      summary: `Routine user role changed from ${currentRole} to ${input.requestedRole}. Reason: ${input.reason.trim()}`,
    });
    return { ok: true, entityId: target.id, message: "User access updated." } as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error) => {
    if (isGovernanceConflict(error)) {
      return { ok: false, message: "The target account changed. Refresh and try again." } as const;
    }
    throw error;
  });
}

export async function setUserActiveState(input: {
  targetUserId: string;
  active: boolean;
  reason: string;
}, actor: GovernanceActor): Promise<GovernanceResult> {
  if (actor.canonicalRole !== "facility_admin") {
    return { ok: false, message: "Only Facility Admin can activate or deactivate users." };
  }
  if (actor.id === input.targetUserId && !input.active) {
    return { ok: false, message: "You cannot deactivate your own account." };
  }
  if (input.reason.trim().length < 5 || input.reason.trim().length > GOVERNANCE_REASON_MAX) {
    return { ok: false, message: "Provide a reason for this account change." };
  }

  return prisma.$transaction(async (tx) => {
    if (!(await governanceActorIsCurrent(tx, actor))) {
      return { ok: false, message: "Your administrator access changed. Sign in again." } as const;
    }

    const target = await tx.user.findUnique({
      where: { id: input.targetUserId },
      select: { id: true, role: true, active: true },
    });
    if (!target) return { ok: false, message: "The target user was not found." } as const;
    if (target.active === input.active) {
      return { ok: true, entityId: target.id, message: `The account is already ${input.active ? "active" : "inactive"}.` } as const;
    }

    const currentRole = normalizeUserRole(target.role);
    if (currentRole === "facility_admin" || currentRole === "it_head") {
      if (!input.active) {
        const roleValues = currentRole === "facility_admin" ? ["facility_admin", "admin"] as const : ["it_head"] as const;
        const remaining = await tx.user.count({
          where: { active: true, role: { in: [...roleValues] }, id: { not: target.id } },
        });
        if (remaining === 0) {
          return { ok: false, message: `The final ${currentRole.replaceAll("_", " ")} account cannot be deactivated.` } as const;
        }
        const activeResponsibility = await tx.cageUserAssignment.findFirst({
          where: { userId: target.id, endedAt: null },
          select: { cage: { select: { barcode: true } } },
        });
        if (activeResponsibility) {
          return {
            ok: false,
            message: `Reassign active cages before deactivating this account. ${activeResponsibility.cage.barcode} is still assigned.`,
          } as const;
        }
      }

      await tx.privilegedRoleChangeRequest.updateMany({
        where: { targetUserId: target.id, status: "pending", expiresAt: { lte: new Date() } },
        data: { status: "expired" },
      });
      const existing = await tx.privilegedRoleChangeRequest.findFirst({
        where: { targetUserId: target.id, status: "pending" },
        select: { id: true },
      });
      if (existing) {
        return { ok: false, message: "A privileged access request is already pending for this user." } as const;
      }

      const request = await tx.privilegedRoleChangeRequest.create({
        data: {
          id: `role-change-${randomUUID()}`,
          targetUserId: target.id,
          requestedRole: currentRole,
          requestedActive: input.active,
          reason: input.reason.trim(),
          requestedById: actor.id,
          requestedByAuthzVersion: actor.authzVersion,
          expiresAt: expiresAt(24),
        },
      });
      await writeSecurityEvent(tx, {
        eventType: input.active ? "identity.account.activation.requested" : "identity.account.deactivation.requested",
        outcome: "succeeded",
        severity: "warning",
        actorId: actor.id,
        correlationId: request.id,
        dedupeKey: `identity.account.state.requested:${request.id}`,
        subjectType: "user",
        subjectId: target.id,
        source: "identity_governance",
        summary: `Privileged ${currentRole} account ${input.active ? "activation" : "deactivation"} requested. Reason: ${input.reason.trim()}`,
      });
      return {
        ok: true,
        entityId: request.id,
        message: "Privileged account state change sent for independent approval.",
      } as const;
    }

    if (!input.active) {
      const activeResponsibility = await tx.cageUserAssignment.findFirst({
        where: { userId: target.id, endedAt: null },
        select: { cage: { select: { barcode: true } } },
      });
      if (activeResponsibility) {
        return {
          ok: false,
          message: `Reassign active cages before deactivating this account. ${activeResponsibility.cage.barcode} is still assigned.`,
        } as const;
      }
    }

    await tx.user.update({
      where: { id: target.id },
      data: { active: input.active, authzVersion: { increment: 1 } },
    });
    const securityRequestId = randomUUID();
    await writeSecurityEvent(tx, {
      eventType: input.active ? "identity.account.activated" : "identity.account.deactivated",
      outcome: "succeeded",
      severity: input.active ? "info" : "warning",
      actorId: actor.id,
      correlationId: securityRequestId,
      dedupeKey: `identity.account.state:${securityRequestId}`,
      subjectType: "user",
      subjectId: target.id,
      source: "identity_governance",
      summary: `${input.active ? "User account activated" : "User account deactivated"}. Reason: ${input.reason.trim()}`,
    });
    return { ok: true, entityId: target.id, message: `Account ${input.active ? "activated" : "deactivated"}.` } as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error) => {
    if (isGovernanceConflict(error)) {
      return { ok: false, message: "The target account changed. Refresh and try again." } as const;
    }
    throw error;
  });
}
