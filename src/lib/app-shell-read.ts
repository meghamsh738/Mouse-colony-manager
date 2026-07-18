import { prisma } from "@/lib/prisma";
import { getActorLabAccess } from "@/lib/lab-access";
import type { ResolvedActor } from "@/lib/session";

export async function getAppShellStatusView(actor: ResolvedActor | null) {
  if (!actor || actor.canonicalRole === "it_head") {
    return { degraded: false, openAlerts: 0 };
  }

  try {
    const access = await getActorLabAccess(actor);
    const openAlerts = await prisma.alert.count({
      where: {
        status: "open",
        ...(access.canViewAll ? {} : { labId: { in: access.memberLabIds } }),
      },
    });

    return { degraded: false, openAlerts };
  } catch (error) {
    console.error("[app-shell] alert count unavailable", error);

    return { degraded: true, openAlerts: 0 };
  }
}
