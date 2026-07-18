import { actorHasCapability } from "@/lib/capabilities";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";

export type ApprovalInboxItem = {
  category: "access" | "transfer" | "quarantine" | "cryostorage" | "sop";
  detail: string;
  href: string;
  id: string;
  requestedAt: Date;
  scope: string;
  stage: string;
  title: string;
  tone: "info" | "warning" | "danger";
};

export async function getSupplementalApprovalInbox(actor: ResolvedActor): Promise<ApprovalInboxItem[]> {
  if (!actorHasCapability(actor, "approvals:read")) return [];

  const canOperateFacilityQueue = actor.canonicalRole === "facility_admin" || actor.canonicalRole === "cmu_staff";
  const canApproveSops = actorHasCapability(actor, "sops:approve");
  const sopWhere = !canApproveSops
    ? { id: "__none__" }
    : actor.canonicalRole === "facility_admin"
      ? { approval: null, createdById: { not: actor.id }, sop: { scope: "facility" as const } }
      : actor.canonicalRole === "lab_user" && actor.activeLabId
        ? { approval: null, createdById: { not: actor.id }, sop: { scope: "lab" as const, labId: actor.activeLabId } }
        : { id: "__none__" };

  const [quarantineCases, cryostorageRequests, sopVersions] = await Promise.all([
    canOperateFacilityQueue
      ? prisma.quarantineCase.findMany({
          where: { status: "release_requested" },
          orderBy: [{ releaseRequestedAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            releaseRequestedAt: true,
            releaseRequestReason: true,
            cage: { select: { barcode: true } },
            lab: { select: { code: true, name: true } },
          },
        })
      : Promise.resolve([]),
    canOperateFacilityQueue
      ? prisma.cryostorageRequest.findMany({
          where: { status: "submitted" },
          orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            requestType: true,
            sampleLabel: true,
            materialType: true,
            requestedAt: true,
            requestedFor: true,
            lab: { select: { code: true, name: true } },
          },
        })
      : Promise.resolve([]),
    canApproveSops
      ? prisma.sopVersion.findMany({
          where: sopWhere,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            sopId: true,
            versionNumber: true,
            title: true,
            changeSummary: true,
            createdAt: true,
            sop: { select: { code: true, scope: true, lab: { select: { code: true, name: true } } } },
          },
        })
      : Promise.resolve([]),
  ]);

  return [
    ...quarantineCases.map((item) => ({
      id: `quarantine:${item.id}`,
      category: "quarantine" as const,
      title: `Release ${item.cage.barcode}`,
      detail: item.releaseRequestReason ?? "Review holding requirements and destination cages.",
      scope: `${item.lab.code} · ${item.lab.name}`,
      stage: "Release finalization",
      requestedAt: item.releaseRequestedAt ?? new Date(0),
      href: `/quarantine?caseId=${item.id}`,
      tone: "warning" as const,
    })),
    ...cryostorageRequests.map((item) => ({
      id: `cryostorage:${item.id}`,
      category: "cryostorage" as const,
      title: item.sampleLabel ?? item.materialType ?? `${item.requestType} request`,
      detail: `${item.requestType.replaceAll("_", " ")} requested for ${item.requestedFor.toISOString().slice(0, 10)}.`,
      scope: `${item.lab.code} · ${item.lab.name}`,
      stage: "CMU processing",
      requestedAt: item.requestedAt,
      href: `/cryostorage#request-${item.id}`,
      tone: "info" as const,
    })),
    ...sopVersions.map((item) => ({
      id: `sop:${item.id}`,
      category: "sop" as const,
      title: `${item.sop.code} v${item.versionNumber} · ${item.title}`,
      detail: item.changeSummary,
      scope: item.sop.scope === "facility" ? "Facility SOP" : `${item.sop.lab?.code ?? "Lab"} · ${item.sop.lab?.name ?? "Private SOP"}`,
      stage: "Version approval",
      requestedAt: item.createdAt,
      href: `/sops?sopId=${encodeURIComponent(item.sopId)}`,
      tone: "warning" as const,
    })),
  ].sort((left, right) => left.requestedAt.getTime() - right.requestedAt.getTime() || left.id.localeCompare(right.id));
}
