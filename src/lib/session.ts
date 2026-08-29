import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import {
  actorHasCapability,
  getActorCapabilities,
  legacyCompatibilityRole,
  normalizeUserRole,
  type ActorMembership,
  type Capability,
} from "@/lib/capabilities";
import { prisma } from "@/lib/prisma";
import { getActiveFacilityDutiesAtDatabaseTime } from "@/lib/facility-duty-auth";
import { isElevatedAssurance, isElevatedIdentityContextCurrent, type AuthenticationMethod } from "@/lib/identity-assurance";
import type { CanonicalUserRole, FacilityDuty, IdentityAssuranceLevel, UserRole } from "@/lib/types";

export const ACTIVE_LAB_COOKIE = "mcm_active_lab";

export type ResolvedActor = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  databaseRole: UserRole;
  canonicalRole: CanonicalUserRole;
  authzVersion: number;
  authMethod?: AuthenticationMethod;
  assurance?: IdentityAssuranceLevel;
  authenticatedAt?: string;
  identityLinkId?: string | null;
  activeDuties?: FacilityDuty[];
  activeLabId: string | null;
  activeMembership: ActorMembership | null;
  memberships: ActorMembership[];
  capabilities: Capability[];
};

type ActorResolution = {
  hasSessionUser: boolean;
  actor: ResolvedActor | null;
};

const resolveActorRequest = cache(async (): Promise<ActorResolution> => {
  const session = await auth();

  if (!session?.user) {
    return { hasSessionUser: false, actor: null };
  }

  if (!session.user.id) {
    return { hasSessionUser: true, actor: null };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      authzVersion: true,
      labMemberships: {
        where: { active: true, lab: { active: true } },
        orderBy: [{ lab: { name: "asc" } }, { labId: "asc" }],
        select: {
          labId: true,
          role: true,
          lab: { select: { name: true, code: true } },
        },
      },
    },
  });

  if (!user?.active) {
    return { hasSessionUser: true, actor: null };
  }

  if (session.user.authzVersion !== user.authzVersion) {
    return { hasSessionUser: true, actor: null };
  }

  if (isElevatedAssurance(session.user.assurance) && !await isElevatedIdentityContextCurrent(prisma, {
    userId: user.id,
    identity: user.email,
    identityLinkId: session.user.identityLinkId,
    authenticationMethod: session.user.authMethod,
    assurance: session.user.assurance,
    authenticatedAt: session.user.authenticatedAt,
  })) {
    return { hasSessionUser: true, actor: null };
  }

  const canonicalRole = normalizeUserRole(user.role as UserRole);
  const activeDuties = canonicalRole === "it_head"
    ? []
    : await getActiveFacilityDutiesAtDatabaseTime(prisma, user.id);
  const memberships: ActorMembership[] = user.labMemberships.map((membership) => ({
    labId: membership.labId,
    labName: membership.lab.name,
    labCode: membership.lab.code,
    role: membership.role,
  }));
  const cookieStore = await cookies();
  const requestedLabId = cookieStore.get(ACTIVE_LAB_COOKIE)?.value;
  const activeMembership = canonicalRole === "lab_user"
    ? memberships.find((membership) => membership.labId === requestedLabId) ?? memberships[0] ?? null
    : null;
  const capabilityActor = { canonicalRole, activeMembership, activeDuties };

  return {
    hasSessionUser: true,
    actor: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: legacyCompatibilityRole(canonicalRole, activeMembership?.role),
      databaseRole: user.role as UserRole,
      canonicalRole,
      authzVersion: user.authzVersion,
      authMethod: session.user.authMethod ?? "password",
      assurance: session.user.assurance ?? "password",
      authenticatedAt: session.user.authenticatedAt ?? "",
      identityLinkId: session.user.identityLinkId ?? null,
      activeDuties,
      activeLabId: activeMembership?.labId ?? null,
      activeMembership,
      memberships,
      capabilities: [...getActorCapabilities(capabilityActor)],
    },
  };
});

export async function resolveCurrentActor(): Promise<ResolvedActor | null> {
  return (await resolveActorRequest()).actor;
}

export async function requireUser(options?: { capability?: Capability }) {
  const resolution = await resolveActorRequest();

  if (!resolution.hasSessionUser) {
    redirect("/login");
  }

  const actor = resolution.actor;

  if (!actor) {
    redirect("/access-denied?reason=inactive");
  }

  if (options?.capability && !actorHasCapability(actor, options.capability)) {
    redirect("/access-denied");
  }

  return actor;
}
