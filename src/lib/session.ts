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
import type { CanonicalUserRole, UserRole } from "@/lib/types";

export const ACTIVE_LAB_COOKIE = "mcm_active_lab";

export type ResolvedActor = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  databaseRole: UserRole;
  canonicalRole: CanonicalUserRole;
  authzVersion: number;
  activeLabId: string | null;
  activeMembership: ActorMembership | null;
  memberships: ActorMembership[];
  capabilities: Capability[];
};

export async function resolveCurrentActor(): Promise<ResolvedActor | null> {
  const session = await auth();

  if (!session?.user?.id) {
    return null;
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
    return null;
  }

  if (session.user.authzVersion !== user.authzVersion) {
    return null;
  }

  const canonicalRole = normalizeUserRole(user.role as UserRole);
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
  const capabilityActor = { canonicalRole, activeMembership };

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: legacyCompatibilityRole(canonicalRole, activeMembership?.role),
    databaseRole: user.role as UserRole,
    canonicalRole,
    authzVersion: user.authzVersion,
    activeLabId: activeMembership?.labId ?? null,
    activeMembership,
    memberships,
    capabilities: [...getActorCapabilities(capabilityActor)],
  };
}

export async function requireUser(options?: { capability?: Capability }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const actor = await resolveCurrentActor();

  if (!actor) {
    redirect("/access-denied?reason=inactive");
  }

  if (options?.capability && !actorHasCapability(actor, options.capability)) {
    redirect("/access-denied");
  }

  return actor;
}
