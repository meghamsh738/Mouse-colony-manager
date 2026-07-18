import type { Prisma } from "@prisma/client";

import { actorHasCapability } from "@/lib/capabilities";
import { canViewLab, getActorLabAccess } from "@/lib/lab-access";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";
import { assertSopGovernanceDatabaseReady } from "@/lib/sop-database-contract";

function documentVisibilityWhere(actor: ResolvedActor): Prisma.SopDocumentWhereInput {
  if (!actorHasCapability(actor, "sops:read")) return { id: "__none__" };
  if (actor.canonicalRole === "lab_user") {
    const controlled = { currentVersionId: { not: null } } satisfies Prisma.SopDocumentWhereInput;
    return actor.activeLabId
      ? {
          OR: [
            { scope: "facility", ...controlled },
            {
              scope: "lab",
              labId: actor.activeLabId,
              ...(isActiveLabManager(actor) ? {} : controlled),
            },
          ],
        }
      : { scope: "facility", ...controlled };
  }
  if (actor.canonicalRole === "facility_admin" || actor.canonicalRole === "cmu_staff") {
    return { scope: "facility" };
  }
  return { id: "__none__" };
}

function assignmentVisibilityWhere(actor: ResolvedActor): Prisma.SopAssignmentWhereInput {
  if (actor.canonicalRole === "lab_user") {
    return actor.activeLabId ? { labId: actor.activeLabId } : { id: "__none__" };
  }
  return {};
}

function isActiveLabManager(actor: ResolvedActor) {
  return actor.canonicalRole === "lab_user"
    && Boolean(actor.activeLabId)
    && (actor.activeMembership?.role === "owner" || actor.activeMembership?.role === "manager");
}

export async function getSopWorkspace(actor: ResolvedActor) {
  if (!actorHasCapability(actor, "sops:read")) {
    return {
      documents: [],
      labOptions: [],
      summary: { documents: 0, pendingApproval: 0, assignedToCurrentLab: 0, awaitingMyAcknowledgement: 0 },
      permissions: {
        canCreateFacility: false,
        canCreateLab: false,
        canApproveFacility: false,
        canApproveLab: false,
      },
    };
  }

  await assertSopGovernanceDatabaseReady(prisma);

  const canManage = actorHasCapability(actor, "sops:manage");
  const canApprove = actorHasCapability(actor, "sops:approve");
  const canViewAcknowledgementRoster = actor.canonicalRole === "facility_admin"
    || actor.canonicalRole === "cmu_staff"
    || isActiveLabManager(actor);
  const [documents, labOptions] = await Promise.all([
    prisma.sopDocument.findMany({
      where: documentVisibilityWhere(actor),
      orderBy: [{ scope: "asc" }, { code: "asc" }, { id: "asc" }],
      include: {
        lab: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        currentVersion: {
          include: {
            approval: {
              include: { decidedBy: { select: { id: true, name: true } } },
            },
          },
        },
        versions: {
          orderBy: { versionNumber: "desc" },
          include: {
            createdBy: { select: { id: true, name: true } },
            approval: {
              include: { decidedBy: { select: { id: true, name: true } } },
            },
          },
        },
        assignments: {
          where: assignmentVisibilityWhere(actor),
          orderBy: [{ revokedAt: "asc" }, { assignedAt: "desc" }],
          include: {
            lab: { select: { id: true, code: true, name: true } },
            assignedBy: { select: { id: true, name: true } },
            revokedBy: { select: { id: true, name: true } },
            sopVersion: {
              select: {
                id: true,
                versionNumber: true,
                title: true,
                category: true,
                contentMarkdown: true,
                contentHash: true,
              },
            },
            acknowledgements: {
              where: canViewAcknowledgementRoster ? {} : { userId: actor.id },
              orderBy: { acknowledgedAt: "asc" },
              include: { user: { select: { id: true, name: true } } },
            },
            _count: { select: { acknowledgements: true } },
          },
        },
      },
    }),
    actor.canonicalRole === "facility_admin" || actor.canonicalRole === "cmu_staff"
      ? prisma.lab.findMany({
          where: { active: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: { id: true, code: true, name: true },
        })
      : actor.activeLabId
        ? prisma.lab.findMany({
            where: { id: actor.activeLabId, active: true },
            select: { id: true, code: true, name: true },
          })
        : [],
  ]);

  const mappedDocuments = documents.map((document) => {
    const canViewGovernance = (document.scope === "facility"
      && (actor.canonicalRole === "facility_admin" || actor.canonicalRole === "cmu_staff"))
      || (document.scope === "lab" && isActiveLabManager(actor) && document.labId === actor.activeLabId);
    const visibleVersionIds = new Set([
      ...(document.currentVersionId ? [document.currentVersionId] : []),
      ...document.assignments.map((assignment) => assignment.sopVersionId),
    ]);
    return ({
    id: document.id,
    scope: document.scope,
    lab: document.lab,
    code: document.code,
    title: document.title,
    category: document.category,
    active: document.active,
    version: document.version,
    createdBy: canViewGovernance ? document.createdBy : null,
    createdAt: document.createdAt.toISOString(),
    currentVersion: document.currentVersion ? {
      id: document.currentVersion.id,
      versionNumber: document.currentVersion.versionNumber,
      title: document.currentVersion.title,
      category: document.currentVersion.category,
      contentMarkdown: document.currentVersion.contentMarkdown,
      contentHash: document.currentVersion.contentHash,
      changeSummary: document.currentVersion.changeSummary,
      createdAt: document.currentVersion.createdAt.toISOString(),
      decision: document.currentVersion.approval?.decision ?? null,
      decidedAt: canViewGovernance ? document.currentVersion.approval?.decidedAt.toISOString() ?? null : null,
      decidedBy: canViewGovernance ? document.currentVersion.approval?.decidedBy.name ?? null : null,
    } : null,
    versions: document.versions.filter((version) => canViewGovernance || visibleVersionIds.has(version.id)).map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      title: version.title,
      category: version.category,
      contentMarkdown: version.contentMarkdown,
      contentHash: version.contentHash,
      changeSummary: version.changeSummary,
      createdById: canViewGovernance ? version.createdById : null,
      createdBy: canViewGovernance ? version.createdBy.name : null,
      createdAt: version.createdAt.toISOString(),
      decision: version.approval?.decision ?? null,
      decisionNote: canViewGovernance ? version.approval?.note ?? null : null,
      decidedAt: canViewGovernance ? version.approval?.decidedAt.toISOString() ?? null : null,
      decidedBy: canViewGovernance ? version.approval?.decidedBy.name ?? null : null,
      canDecide: canApprove && !version.approval && (
        (document.scope === "facility" && actor.canonicalRole === "facility_admin" && version.createdById !== actor.id)
        || (document.scope === "lab" && isActiveLabManager(actor) && document.labId === actor.activeLabId && version.createdById !== actor.id)
      ),
    })),
    assignments: document.assignments.map((assignment) => ({
      id: assignment.id,
      version: assignment.version,
      lab: assignment.lab,
      sopVersionId: assignment.sopVersionId,
      versionNumber: assignment.sopVersion.versionNumber,
      title: assignment.sopVersion.title,
      category: assignment.sopVersion.category,
      contentMarkdown: assignment.sopVersion.contentMarkdown,
      contentHash: assignment.sopVersion.contentHash,
      assignedAt: assignment.assignedAt.toISOString(),
      assignedBy: assignment.assignedBy.name,
      dueAt: assignment.dueAt?.toISOString() ?? null,
      reason: assignment.reason,
      revokedAt: assignment.revokedAt?.toISOString() ?? null,
      revokedBy: assignment.revokedBy?.name ?? null,
      revocationReason: assignment.revocationReason,
      acknowledgements: assignment.acknowledgements.map((acknowledgement) => ({
        id: acknowledgement.id,
        userId: acknowledgement.userId,
        userName: acknowledgement.user.name,
        acknowledgedAt: acknowledgement.acknowledgedAt.toISOString(),
        contentHash: acknowledgement.contentHash,
      })),
      acknowledgementCount: assignment._count.acknowledgements,
      canViewAcknowledgementRoster,
      acknowledgedByMe: assignment.acknowledgements.some((acknowledgement) => acknowledgement.userId === actor.id),
      canAcknowledge: actor.canonicalRole === "lab_user"
        && actor.activeLabId === assignment.labId
        && !assignment.revokedAt
        && !assignment.acknowledgements.some((acknowledgement) => acknowledgement.userId === actor.id),
      canRevoke: canManage && !assignment.revokedAt && (
        (document.scope === "facility" && (actor.canonicalRole === "facility_admin" || actor.canonicalRole === "cmu_staff"))
        || (document.scope === "lab" && isActiveLabManager(actor) && assignment.labId === actor.activeLabId)
      ),
    })),
    canCreateVersion: canManage && (
      (document.scope === "facility" && (actor.canonicalRole === "facility_admin" || actor.canonicalRole === "cmu_staff"))
      || (document.scope === "lab" && isActiveLabManager(actor) && document.labId === actor.activeLabId)
    ),
    canAssign: canManage && Boolean(document.currentVersion) && (
      (document.scope === "facility" && (actor.canonicalRole === "facility_admin" || actor.canonicalRole === "cmu_staff"))
      || (document.scope === "lab" && isActiveLabManager(actor) && document.labId === actor.activeLabId)
    ),
    });
  });

  const activeAssignments = mappedDocuments.flatMap((document) => document.assignments).filter((assignment) => !assignment.revokedAt);
  return {
    documents: mappedDocuments,
    labOptions,
    summary: {
      documents: mappedDocuments.length,
      pendingApproval: mappedDocuments.reduce((sum, document) => sum + document.versions.filter((version) => !version.decision).length, 0),
      assignedToCurrentLab: actor.activeLabId
        ? activeAssignments.filter((assignment) => assignment.lab.id === actor.activeLabId).length
        : activeAssignments.length,
      awaitingMyAcknowledgement: activeAssignments.filter((assignment) => assignment.canAcknowledge).length,
    },
    permissions: {
      canCreateFacility: canManage && (actor.canonicalRole === "facility_admin" || actor.canonicalRole === "cmu_staff"),
      canCreateLab: canManage && isActiveLabManager(actor),
      canApproveFacility: canApprove && actor.canonicalRole === "facility_admin",
      canApproveLab: canApprove && isActiveLabManager(actor),
    },
  };
}

export async function getCurrentOperationalSopOptions(actor: ResolvedActor, labId: string) {
  if (!actorHasCapability(actor, "sops:read")) return [];
  const access = await getActorLabAccess(actor);
  if (!canViewLab(access, labId)) return [];

  const assignments = await prisma.sopAssignment.findMany({
    where: {
      labId,
      revokedAt: null,
      sop: { active: true },
      sopVersion: { approval: { decision: "approved" } },
    },
    orderBy: [{ sop: { code: "asc" } }, { assignedAt: "desc" }],
    select: {
      id: true,
      sopVersionId: true,
      sop: { select: { code: true, title: true, currentVersionId: true } },
      sopVersion: { select: { versionNumber: true } },
    },
  });

  return assignments
    .filter((assignment) => assignment.sop.currentVersionId === assignment.sopVersionId)
    .map((assignment) => ({
      id: assignment.id,
      label: `${assignment.sop.code} v${assignment.sopVersion.versionNumber} · ${assignment.sop.title}`,
    }));
}
