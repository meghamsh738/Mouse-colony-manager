import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { actorHasCapability, normalizeUserRole } from "@/lib/capabilities";
import { prisma } from "@/lib/prisma";
import { writeSecurityEvent } from "@/lib/security-event";
import type { ResolvedActor } from "@/lib/session";
import type { CanonicalUserRole, LabMembershipRole } from "@/lib/types";

export type LabAdministrationActor = Pick<ResolvedActor, "id" | "canonicalRole" | "authzVersion" | "activeLabId" | "activeMembership">;

type LabAdministrationResult =
  | { ok: true; message: string; entityId: string }
  | { ok: false; message: string };

const TERMINAL_ANIMAL_STATUSES = ["euthanized", "dead", "transferred_out", "archived"] as const;
const OPEN_TRANSFER_STATUSES = ["requested", "destination_accepted"] as const;
const OPEN_QUARANTINE_STATUSES = ["admitted", "under_observation", "exception_open", "release_requested"] as const;
const ADMINISTRATION_REASON_MAX = 350;

function normalizeLabCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, "-");
}

function cleanOptional(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

async function currentAuthority(
  tx: Prisma.TransactionClient,
  actor: LabAdministrationActor,
  input: { labId?: string; facilityOnly?: boolean },
) {
  const current = await tx.user.findUnique({
    where: { id: actor.id },
    select: {
      active: true,
      role: true,
      authzVersion: true,
      labMemberships: input.labId
        ? {
            where: { labId: input.labId, active: true, lab: { active: true } },
            take: 1,
            select: { role: true },
          }
        : false,
    },
  });
  if (!current?.active || current.authzVersion !== actor.authzVersion) return null;

  const role = normalizeUserRole(current.role);
  if (role !== actor.canonicalRole) return null;
  if (role === "facility_admin") return { role, scope: "facility" as const };
  if (input.facilityOnly || role !== "lab_user" || !input.labId || actor.activeLabId !== input.labId) return null;
  const membership = current.labMemberships[0];
  if (membership?.role !== "owner") return null;
  return { role, scope: "lab" as const };
}

function databaseFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Reassign active cages before removing this lab membership")) {
    return "Reassign active cages before changing this membership.";
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
    return "The record changed while it was being updated. Refresh and try again.";
  }
  return null;
}

export async function getLabAdministrationView(actor: ResolvedActor) {
  if (!actorHasCapability(actor, "labs:manage")) {
    throw new Error("Lab administration is unavailable.");
  }

  const facilityAdministrator = actor.canonicalRole === "facility_admin";
  const ownerLabId = actor.canonicalRole === "lab_user" && actor.activeMembership?.role === "owner"
    ? actor.activeLabId
    : null;
  if (!facilityAdministrator && !ownerLabId) {
    throw new Error("Lab administration is unavailable.");
  }

  const [labs, candidateUsers] = await Promise.all([
    prisma.lab.findMany({
      where: facilityAdministrator ? {} : { id: ownerLabId ?? "__none__", active: true },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        billingContact: true,
        notes: true,
        active: true,
        updatedAt: true,
        memberships: {
          orderBy: [{ active: "desc" }, { user: { name: "asc" } }],
          select: {
            id: true,
            role: true,
            active: true,
            createdAt: true,
            user: { select: { id: true, name: true, email: true, active: true, role: true } },
          },
        },
        _count: {
          select: {
            cages: { where: { active: true } },
            animals: { where: { status: { notIn: [...TERMINAL_ANIMAL_STATUSES] } } },
          },
        },
      },
    }),
    facilityAdministrator
      ? prisma.user.findMany({
          where: { active: true },
          orderBy: [{ name: "asc" }, { email: "asc" }],
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    canAdministerMemberships: facilityAdministrator,
    canCreateLabs: facilityAdministrator,
    labs: labs.map((lab) => ({ ...lab, updatedAt: lab.updatedAt.toISOString() })),
    candidateUsers,
  };
}

export async function createLab(
  input: { name: string; code: string; billingContact?: string | null; notes?: string | null },
  actor: LabAdministrationActor,
): Promise<LabAdministrationResult> {
  if (actor.canonicalRole !== "facility_admin") {
    return { ok: false, message: "Only Facility Admin can create labs." };
  }
  const name = input.name.trim();
  const code = normalizeLabCode(input.code);
  if (name.length < 2 || name.length > 120 || !/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code)) {
    return { ok: false, message: "Enter a lab name and a 2-20 character code using letters, numbers, underscores, or hyphens." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await currentAuthority(tx, actor, { facilityOnly: true }))) {
        return { ok: false, message: "Your administrator access changed. Sign in again." } as const;
      }
      const lab = await tx.lab.create({
        data: {
          id: `lab-${randomUUID()}`,
          name,
          code,
          billingContact: cleanOptional(input.billingContact),
          notes: cleanOptional(input.notes),
          active: true,
        },
      });
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: actor.id,
          entityType: "lab",
          entityId: lab.id,
          action: "create",
          newValue: { name: lab.name, code: lab.code, billingContact: lab.billingContact, active: lab.active },
          timestamp: new Date(),
        },
      });
      return { ok: true, entityId: lab.id, message: "Lab created." } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, message: "That lab code is already in use." };
    }
    const message = databaseFailure(error);
    if (message) return { ok: false, message };
    throw error;
  }
}

export async function updateLabDetails(
  input: { labId: string; name: string; billingContact?: string | null; notes?: string | null },
  actor: LabAdministrationActor,
): Promise<LabAdministrationResult> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) {
    return { ok: false, message: "Enter a lab name between 2 and 120 characters." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await currentAuthority(tx, actor, { labId: input.labId }))) {
        return { ok: false, message: "You no longer have authority to update this lab." } as const;
      }
      const existing = await tx.lab.findUnique({ where: { id: input.labId } });
      if (!existing) return { ok: false, message: "Lab not found." } as const;

      const lab = await tx.lab.update({
        where: { id: existing.id },
        data: {
          name,
          billingContact: cleanOptional(input.billingContact),
          notes: cleanOptional(input.notes),
        },
      });
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: actor.id,
          entityType: "lab",
          entityId: lab.id,
          action: "update_details",
          previousValue: { name: existing.name, billingContact: existing.billingContact, notes: existing.notes },
          newValue: { name: lab.name, billingContact: lab.billingContact, notes: lab.notes },
          timestamp: new Date(),
        },
      });
      return { ok: true, entityId: lab.id, message: "Lab details updated." } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    const message = databaseFailure(error);
    if (message) return { ok: false, message };
    throw error;
  }
}

async function labDeactivationBlocker(tx: Prisma.TransactionClient, labId: string) {
  const [cages, animals, charges, invoices, breeding, experiments, quarantine, transfers] = await Promise.all([
    tx.cage.count({ where: { labId, active: true } }),
    tx.animal.count({ where: { owningLabId: labId, status: { notIn: [...TERMINAL_ANIMAL_STATUSES] } } }),
    tx.cageChargePeriod.count({ where: { labId, endedAt: null } }),
    tx.invoice.count({ where: { labId, status: "draft" } }),
    tx.breedingSetup.count({ where: { labId, status: { in: ["planned", "active", "paused"] } } }),
    tx.experiment.count({ where: { labId, status: { in: ["planned", "active"] } } }),
    tx.quarantineCase.count({ where: { labId, status: { in: [...OPEN_QUARANTINE_STATUSES] } } }),
    tx.labTransferRequest.count({
      where: {
        status: { in: [...OPEN_TRANSFER_STATUSES] },
        OR: [{ sourceLabId: labId }, { destinationLabId: labId }],
      },
    }),
  ]);
  if (cages) return `${cages} active cage${cages === 1 ? "" : "s"}`;
  if (animals) return `${animals} current animal${animals === 1 ? "" : "s"}`;
  if (charges) return `${charges} open charge period${charges === 1 ? "" : "s"}`;
  if (invoices) return `${invoices} draft invoice${invoices === 1 ? "" : "s"}`;
  if (breeding) return `${breeding} open breeding setup${breeding === 1 ? "" : "s"}`;
  if (experiments) return `${experiments} open experiment${experiments === 1 ? "" : "s"}`;
  if (quarantine) return `${quarantine} open quarantine case${quarantine === 1 ? "" : "s"}`;
  if (transfers) return `${transfers} open lab transfer${transfers === 1 ? "" : "s"}`;
  return null;
}

export async function setLabActiveState(
  input: { labId: string; active: boolean; reason: string },
  actor: LabAdministrationActor,
): Promise<LabAdministrationResult> {
  if (actor.canonicalRole !== "facility_admin") {
    return { ok: false, message: "Only Facility Admin can change lab status." };
  }
  if (input.reason.trim().length < 5 || input.reason.trim().length > ADMINISTRATION_REASON_MAX) {
    return { ok: false, message: "Provide a reason for the lab status change." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await currentAuthority(tx, actor, { facilityOnly: true }))) {
        return { ok: false, message: "Your administrator access changed. Sign in again." } as const;
      }
      const lab = await tx.lab.findUnique({ where: { id: input.labId }, select: { id: true, active: true } });
      if (!lab) return { ok: false, message: "Lab not found." } as const;
      if (lab.active === input.active) {
        return { ok: true, entityId: lab.id, message: `The lab is already ${input.active ? "active" : "inactive"}.` } as const;
      }
      if (!input.active) {
        const blocker = await labDeactivationBlocker(tx, lab.id);
        if (blocker) {
          return { ok: false, message: `Resolve ${blocker} before deactivating this lab.` } as const;
        }
      }

      const affectedUsers = await tx.labMembership.findMany({
        where: { labId: lab.id, active: true },
        select: { userId: true },
      });
      await tx.lab.update({ where: { id: lab.id }, data: { active: input.active } });
      if (affectedUsers.length) {
        await tx.user.updateMany({
          where: { id: { in: [...new Set(affectedUsers.map((membership) => membership.userId))] } },
          data: { authzVersion: { increment: 1 } },
        });
      }
      if (!input.active) {
        const pendingInvitations = await tx.userInvitation.findMany({
          where: { labId: lab.id, status: "pending" },
          select: { id: true },
        });
        for (const invitation of pendingInvitations) {
          await tx.userInvitation.update({
            where: { id: invitation.id },
            data: { status: "revoked", revokedAt: new Date() },
          });
          await writeSecurityEvent(tx, {
            eventType: "identity.invitation.revoked",
            outcome: "succeeded",
            severity: "warning",
            actorId: actor.id,
            scopeLabId: lab.id,
            correlationId: invitation.id,
            dedupeKey: `identity.invitation.revoked:${invitation.id}`,
            subjectType: "user_invitation",
            subjectId: invitation.id,
            source: "lab_administration",
            summary: "User invitation revoked: owning lab was deactivated.",
          });
        }
      }
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: actor.id,
          entityType: "lab",
          entityId: lab.id,
          action: input.active ? "activate" : "deactivate",
          previousValue: { active: lab.active },
          newValue: { active: input.active, reason: input.reason.trim() },
          timestamp: new Date(),
        },
      });
      await writeSecurityEvent(tx, {
        eventType: input.active ? "identity.lab.activated" : "identity.lab.deactivated",
        outcome: "succeeded",
        severity: input.active ? "info" : "warning",
        actorId: actor.id,
        scopeLabId: lab.id,
        correlationId: lab.id,
        dedupeKey: `identity.lab.state:${lab.id}:${input.active ? "active" : "inactive"}:${randomUUID()}`,
        subjectType: "lab",
        subjectId: lab.id,
        source: "lab_administration",
        summary: input.active ? "Lab activated." : "Lab deactivated.",
      });
      return { ok: true, entityId: lab.id, message: `Lab ${input.active ? "activated" : "deactivated"}.` } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    const message = databaseFailure(error);
    if (message) return { ok: false, message };
    throw error;
  }
}

export async function upsertLabMembership(
  input: { labId: string; userId: string; role: LabMembershipRole; reason: string },
  actor: LabAdministrationActor,
): Promise<LabAdministrationResult> {
  if (actor.canonicalRole !== "facility_admin") {
    return { ok: false, message: "Only Facility Admin can assign lab memberships." };
  }
  if (input.reason.trim().length < 5 || input.reason.trim().length > ADMINISTRATION_REASON_MAX) {
    return { ok: false, message: "Provide a reason for the membership assignment." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await currentAuthority(tx, actor, { facilityOnly: true }))) {
        return { ok: false, message: "Your administrator access changed. Sign in again." } as const;
      }
      const [lab, user, existing] = await Promise.all([
        tx.lab.findUnique({ where: { id: input.labId }, select: { id: true, active: true } }),
        tx.user.findUnique({ where: { id: input.userId }, select: { id: true, active: true, role: true } }),
        tx.labMembership.findUnique({
          where: { labId_userId: { labId: input.labId, userId: input.userId } },
          select: { id: true, role: true, active: true },
        }),
      ]);
      if (!lab?.active) return { ok: false, message: "Choose an active lab." } as const;
      if (!user?.active) {
        return { ok: false, message: "Choose an active user account." } as const;
      }
      if (existing?.active && existing.role === input.role) {
        return { ok: true, entityId: existing.id, message: "That membership is already active." } as const;
      }

      const membership = existing
        ? await tx.labMembership.update({
            where: { id: existing.id },
            data: { role: input.role, active: true },
          })
        : await tx.labMembership.create({
            data: {
              id: `membership-${randomUUID()}`,
              labId: lab.id,
              userId: user.id,
              role: input.role,
              active: true,
            },
          });
      await tx.user.update({ where: { id: user.id }, data: { authzVersion: { increment: 1 } } });
      await writeSecurityEvent(tx, {
        eventType: existing ? "identity.lab_membership.updated" : "identity.lab_membership.assigned",
        outcome: "succeeded",
        severity: "warning",
        actorId: actor.id,
        scopeLabId: lab.id,
        correlationId: membership.id,
        dedupeKey: `identity.lab_membership.generation:${membership.id}:${randomUUID()}`,
        subjectType: "user",
        subjectId: user.id,
        source: "lab_administration",
        summary: `Lab membership ${existing?.role ?? "none"}/${existing?.active ? "active" : "inactive"} -> ${input.role}/active. Reason: ${input.reason.trim()}`,
      });
      return { ok: true, entityId: membership.id, message: "Lab membership saved." } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    const message = databaseFailure(error);
    if (message) return { ok: false, message };
    throw error;
  }
}

export async function setLabMembershipActiveState(
  input: { membershipId: string; active: boolean; reason: string },
  actor: LabAdministrationActor,
): Promise<LabAdministrationResult> {
  if (actor.canonicalRole !== "facility_admin") {
    return { ok: false, message: "Only Facility Admin can change lab memberships." };
  }
  if (input.reason.trim().length < 5 || input.reason.trim().length > ADMINISTRATION_REASON_MAX) {
    return { ok: false, message: "Provide a reason for the membership change." };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await currentAuthority(tx, actor, { facilityOnly: true }))) {
        return { ok: false, message: "Your administrator access changed. Sign in again." } as const;
      }
      const membership = await tx.labMembership.findUnique({
        where: { id: input.membershipId },
        include: {
          lab: { select: { active: true } },
          user: { select: { active: true, role: true } },
        },
      });
      if (!membership) return { ok: false, message: "Membership not found." } as const;
      if (membership.active === input.active) {
        return { ok: true, entityId: membership.id, message: `The membership is already ${input.active ? "active" : "inactive"}.` } as const;
      }
      if (input.active && (!membership.lab.active || !membership.user.active)) {
        return { ok: false, message: "Activate the lab and user account before restoring this membership." } as const;
      }

      await tx.labMembership.update({
        where: { id: membership.id },
        data: { active: input.active },
      });
      await tx.user.update({
        where: { id: membership.userId },
        data: { authzVersion: { increment: 1 } },
      });
      await writeSecurityEvent(tx, {
        eventType: input.active ? "identity.lab_membership.activated" : "identity.lab_membership.deactivated",
        outcome: "succeeded",
        severity: "warning",
        actorId: actor.id,
        scopeLabId: membership.labId,
        correlationId: membership.id,
        dedupeKey: `identity.lab_membership.state:${membership.id}:${input.active ? "active" : "inactive"}:${randomUUID()}`,
        subjectType: "user",
        subjectId: membership.userId,
        source: "lab_administration",
        summary: `Lab membership ${membership.role}/${membership.active ? "active" : "inactive"} -> ${membership.role}/${input.active ? "active" : "inactive"}. Reason: ${input.reason.trim()}`,
      });
      return { ok: true, entityId: membership.id, message: `Membership ${input.active ? "activated" : "deactivated"}.` } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    const message = databaseFailure(error);
    if (message) return { ok: false, message };
    throw error;
  }
}

export function canAdministerLabMemberships(role: CanonicalUserRole) {
  return role === "facility_admin";
}
