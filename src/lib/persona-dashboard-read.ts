import { getSupplementalApprovalInbox } from "@/lib/approval-inbox-read";
import { actorHasCapability } from "@/lib/capabilities";
import { getActorLabAccess } from "@/lib/lab-access";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";

export type PersonaQueueItem = {
  count: number;
  href: string;
  id: string;
  label: string;
  tone: "neutral" | "info" | "warning" | "danger";
};

export type OnboardingStep = {
  complete: boolean;
  href: string;
  id: string;
  label: string;
};

export async function getPersonaDashboardView(actor: ResolvedActor) {
  if (actor.canonicalRole === "it_head") {
    return { queue: [] as PersonaQueueItem[], onboarding: [] as OnboardingStep[] };
  }

  const access = await getActorLabAccess(actor);
  const labWhere = access.canViewAll ? {} : { labId: { in: access.memberLabIds } };
  const animalWhere = access.canViewAll ? {} : { owningLabId: { in: access.memberLabIds } };
  const mayRunFacilityOperations = actor.canonicalRole === "facility_admin" || actor.canonicalRole === "cmu_staff";
  const destinationTransferWhere = actor.canonicalRole === "lab_user"
    && actor.activeLabId
    && actorHasCapability(actor, "transfers:approve")
    ? { destinationLabId: actor.activeLabId, status: "requested" as const }
    : { id: "__none__" };
  const finalizationTransferWhere = mayRunFacilityOperations
    ? { status: "destination_accepted" as const }
    : { id: "__none__" };
  const [counts, supplementalApprovals] = await Promise.all([
    prisma.$transaction([
      actor.canonicalRole === "facility_admin"
        ? prisma.privilegedRoleChangeRequest.count({ where: { status: "pending", expiresAt: { gt: new Date() }, requestedById: { not: actor.id }, targetUserId: { not: actor.id } } })
        : prisma.privilegedRoleChangeRequest.count({ where: { id: "__none__" } }),
      prisma.labTransferRequest.count({ where: destinationTransferWhere }),
      prisma.labTransferRequest.count({ where: finalizationTransferWhere }),
      actorHasCapability(actor, "billing:finalize") ? prisma.invoice.count({ where: { ...labWhere, status: "draft" } }) : prisma.invoice.count({ where: { id: "__none__" } }),
      actor.canonicalRole === "facility_admin" ? prisma.lab.count({ where: { active: true } }) : prisma.lab.count({ where: { id: "__none__" } }),
      actor.canonicalRole === "facility_admin"
        ? prisma.user.count({
            where: {
              active: true,
              role: { in: ["lab_user", "animal_staff", "researcher", "read_only"] },
              labMemberships: { some: { active: true, lab: { active: true } } },
            },
          })
        : prisma.user.count({ where: { id: "__none__" } }),
      actor.canonicalRole === "facility_admin" ? prisma.ruleConfig.count() : prisma.ruleConfig.count({ where: { id: "__none__" } }),
      prisma.cage.count({ where: { ...labWhere, active: true } }),
      prisma.animal.count({ where: { ...animalWhere, outcomeStatus: "alive" } }),
    ]),
    getSupplementalApprovalInbox(actor),
  ]);
  const [
    accessDecisions,
    destinationReviews,
    cmuFinalizations,
    draftInvoices,
    labs,
    labUsers,
    rules,
    cages,
    animals,
  ] = counts;
  const quarantineReleases = supplementalApprovals.filter((item) => item.category === "quarantine").length;
  const cryostorageRequests = supplementalApprovals.filter((item) => item.category === "cryostorage").length;
  const sopDecisions = supplementalApprovals.filter((item) => item.category === "sop").length;

  const queue: PersonaQueueItem[] = actor.canonicalRole === "facility_admin"
    ? [
        { id: "access", label: "Access decisions", count: accessDecisions, href: "/approvals", tone: accessDecisions ? "warning" : "neutral" },
        { id: "finalization", label: "CMU finalization", count: cmuFinalizations, href: "/approvals", tone: cmuFinalizations ? "danger" : "neutral" },
        { id: "quarantine", label: "Release requests", count: quarantineReleases, href: "/approvals", tone: quarantineReleases ? "warning" : "neutral" },
        { id: "cryostorage", label: "Cryostorage requests", count: cryostorageRequests, href: "/approvals", tone: cryostorageRequests ? "warning" : "neutral" },
        { id: "sops", label: "SOP decisions", count: sopDecisions, href: "/approvals", tone: sopDecisions ? "warning" : "neutral" },
        { id: "billing", label: "Draft invoices", count: draftInvoices, href: "/billing/invoices", tone: draftInvoices ? "info" : "neutral" },
      ]
    : actor.canonicalRole === "cmu_staff"
      ? [
          { id: "finalization", label: "Transfers to finalize", count: cmuFinalizations, href: "/approvals", tone: cmuFinalizations ? "danger" : "neutral" },
          { id: "quarantine", label: "Release requests", count: quarantineReleases, href: "/quarantine", tone: quarantineReleases ? "warning" : "neutral" },
          { id: "cryostorage", label: "Cryostorage requests", count: cryostorageRequests, href: "/cryostorage", tone: cryostorageRequests ? "warning" : "neutral" },
          { id: "billing", label: "Draft invoices", count: draftInvoices, href: "/billing/invoices", tone: draftInvoices ? "info" : "neutral" },
        ]
      : actorHasCapability(actor, "approvals:read")
        ? [
            { id: "destination", label: "Transfer reviews", count: destinationReviews, href: "/approvals", tone: destinationReviews ? "warning" as const : "neutral" as const },
            { id: "sops", label: "SOP decisions", count: sopDecisions, href: "/approvals", tone: sopDecisions ? "warning" as const : "neutral" as const },
          ]
        : [];

  const onboarding: OnboardingStep[] = actor.canonicalRole === "facility_admin"
    ? [
        { id: "labs", label: "Create the first lab", complete: labs > 0, href: "/administration/labs" },
        { id: "users", label: "Invite the first lab user", complete: labUsers > 0, href: "/administration/users" },
        { id: "rules", label: "Review facility rules", complete: rules > 0, href: "/settings" },
        { id: "cages", label: "Create the first cage", complete: cages > 0, href: "/cages/intake?mode=new" },
        { id: "intake", label: "Receive or assign the first mice", complete: animals > 0, href: "/cages/intake?mode=purchase" },
      ]
    : [];

  return { queue, onboarding };
}
