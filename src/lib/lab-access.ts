import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { normalizeUserRole } from "@/lib/capabilities";
import type { LabMembershipRole, UserRole } from "@/lib/types";

export type LabActor = {
  id: string;
  role: UserRole;
  activeLabId?: string | null;
};

export type ActorLabAccess = {
  canViewAll: boolean;
  memberLabIds: string[];
  manageableLabIds: string[];
  membershipByLabId: Map<string, LabMembershipRole>;
};

const MANAGE_LAB_ROLES = new Set<LabMembershipRole>(["owner", "manager", "staff"]);

export function isGlobalLabActor(role: UserRole) {
  const canonicalRole = normalizeUserRole(role);
  return canonicalRole === "facility_admin" || canonicalRole === "cmu_staff";
}

export function canTransferAcrossLabs(role: UserRole) {
  return isGlobalLabActor(role);
}

export async function getActorLabAccess(
  actor: LabActor,
  database: Pick<Prisma.TransactionClient, "labMembership"> = prisma,
): Promise<ActorLabAccess> {
  if (isGlobalLabActor(actor.role)) {
    return {
      canViewAll: true,
      memberLabIds: [],
      manageableLabIds: [],
      membershipByLabId: new Map(),
    };
  }

  const memberships = await database.labMembership.findMany({
    where: {
      userId: actor.id,
      active: true,
      lab: { active: true },
    },
    select: {
      labId: true,
      role: true,
    },
  });

  const activeMemberships = actor.activeLabId
    ? memberships.filter((membership) => membership.labId === actor.activeLabId)
    : memberships.length === 1
      ? memberships
      : [];
  const membershipByLabId = new Map(activeMemberships.map((membership) => [membership.labId, membership.role]));

  return {
    canViewAll: false,
    memberLabIds: activeMemberships.map((membership) => membership.labId),
    manageableLabIds: activeMemberships
      .filter((membership) => MANAGE_LAB_ROLES.has(membership.role))
      .map((membership) => membership.labId),
    membershipByLabId,
  };
}

export async function getActorLabScope(actor: LabActor, requestedLabId?: string) {
  const access = await getActorLabAccess(actor);
  const labs = await prisma.lab.findMany({
    where: {
      active: true,
      ...(access.canViewAll ? {} : { id: { in: access.memberLabIds } }),
    },
    orderBy: [{ name: "asc" }, { code: "asc" }],
    select: { id: true, name: true, code: true },
  });
  const selectedLabId = access.canViewAll && labs.some((lab) => lab.id === requestedLabId)
    ? requestedLabId
    : undefined;

  return {
    access,
    labs,
    selectedLabId,
    labIds: selectedLabId ? [selectedLabId] : access.canViewAll ? undefined : access.memberLabIds,
  };
}

export function canViewLab(access: ActorLabAccess, labId?: string | null) {
  if (access.canViewAll) {
    return true;
  }

  return Boolean(labId && access.memberLabIds.includes(labId));
}

export function canManageLab(access: ActorLabAccess, labId?: string | null) {
  if (access.canViewAll) {
    return true;
  }

  return Boolean(labId && access.manageableLabIds.includes(labId));
}

export function labScopedWhere(access: ActorLabAccess, field: "labId" | "owningLabId" = "labId") {
  if (access.canViewAll) {
    return {};
  }

  return {
    [field]: {
      in: access.memberLabIds,
    },
  };
}
