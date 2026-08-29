import { AppShell } from "@/components/app/app-shell";
import { ComplianceAdminWorkspace } from "@/components/app/compliance-admin-workspace";
import { PageHeader } from "@/components/app/page-header";
import { actorHasCapability } from "@/lib/capabilities";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

import {
  createProtocolDraftAction,
  transitionCompetencyAction,
  transitionProtocolAction,
  upsertCompetencyAction,
} from "./actions";

export default async function ComplianceAdministrationPage() {
  const actor = await requireUser({ capability: "dashboard:view" });
  const canDraft = Boolean(actor.activeLabId) && actorHasCapability(actor, "protocols:draft");
  const canReviewProtocols = actorHasCapability(actor, "protocols:approve");
  const canManageCompetencies = actorHasCapability(actor, "competencies:manage");
  const mayReadProtocols = canDraft || canReviewProtocols || actorHasCapability(actor, "protocols:read");
  const mayReadCompetencies = canManageCompetencies || actorHasCapability(actor, "competencies:read");
  const labScope = canReviewProtocols ? undefined : actor.activeLabId ?? "__no_lab__";

  const [protocols, competencies, draftContext, trainingMemberships] = await Promise.all([
    mayReadProtocols ? prisma.protocolAuthorization.findMany({
      where: labScope ? { labId: labScope } : undefined,
      orderBy: [{ updatedAt: "desc" }, { protocolCode: "asc" }],
      select: {
        id: true,
        labId: true,
        protocolCode: true,
        title: true,
        status: true,
        version: true,
        createdById: true,
        lab: { select: { name: true, code: true } },
        createdBy: { select: { name: true } },
        currentVersion: { select: { versionNumber: true, validFrom: true, validUntil: true, approvedAnimalCount: true, summary: true } },
      },
      take: 100,
    }) : Promise.resolve([]),
    mayReadCompetencies ? prisma.competencyEvidence.findMany({
      orderBy: [{ updatedAt: "desc" }, { procedureCode: "asc" }],
      select: {
        id: true,
        labId: true,
        userId: true,
        procedureCode: true,
        status: true,
        version: true,
        lab: { select: { name: true, code: true } },
        user: { select: { name: true, email: true } },
        currentVersion: { select: { evidenceType: true, validFrom: true, validUntil: true, note: true } },
      },
      take: 150,
    }) : Promise.resolve([]),
    canDraft && actor.activeLabId ? Promise.all([
      prisma.lab.findUnique({ where: { id: actor.activeLabId }, select: { id: true, name: true, code: true } }),
      prisma.project.findMany({ where: { labId: actor.activeLabId }, orderBy: { projectCode: "asc" }, select: { id: true, projectCode: true, title: true } }),
      prisma.experiment.findMany({ where: { labId: actor.activeLabId }, orderBy: { experimentCode: "asc" }, select: { id: true, experimentCode: true, title: true } }),
      prisma.strain.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.labMembership.findMany({
        where: { labId: actor.activeLabId, active: true, user: { active: true, role: { not: "it_head" } } },
        orderBy: { user: { name: "asc" } },
        select: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]) : Promise.resolve(null),
    canManageCompetencies ? prisma.labMembership.findMany({
      where: { active: true, lab: { active: true }, user: { active: true, role: { not: "it_head" } } },
      orderBy: [{ lab: { name: "asc" } }, { user: { name: "asc" } }],
      select: {
        labId: true,
        userId: true,
        lab: { select: { name: true, code: true } },
        user: { select: { name: true, email: true } },
      },
    }) : Promise.resolve([]),
  ]);

  const draftOptions = draftContext ? {
    lab: draftContext[0],
    projects: draftContext[1],
    experiments: draftContext[2],
    strains: draftContext[3],
    personnel: draftContext[4].map(({ user }) => user),
  } : null;

  return (
    <AppShell currentPath="/administration/compliance" role={actor.role} userName={actor.name ?? actor.email}>
      <div className="min-w-0 space-y-5">
        <PageHeader
          eyebrow="Verified animal-use governance"
          title="Protocol and competency administration"
          description="Prepare lab-scoped protocol drafts, record independent protocol decisions, and govern competency evidence without exposing animal-level records."
        />
        <ComplianceAdminWorkspace
          actions={{
            createProtocol: createProtocolDraftAction,
            transitionProtocol: transitionProtocolAction,
            upsertCompetency: upsertCompetencyAction,
            transitionCompetency: transitionCompetencyAction,
          }}
          actorId={actor.id}
          canDraft={canDraft}
          canManageCompetencies={canManageCompetencies}
          canReviewProtocols={canReviewProtocols}
          competencies={competencies.map((record) => ({
            ...record,
            currentVersion: record.currentVersion ? {
              ...record.currentVersion,
              validFrom: record.currentVersion.validFrom.toISOString(),
              validUntil: record.currentVersion.validUntil.toISOString(),
            } : null,
          }))}
          draftOptions={draftOptions}
          protocols={protocols.map((protocol) => ({
            ...protocol,
            currentVersion: protocol.currentVersion ? {
              ...protocol.currentVersion,
              validFrom: protocol.currentVersion.validFrom.toISOString(),
              validUntil: protocol.currentVersion.validUntil.toISOString(),
            } : null,
          }))}
          trainingMemberships={trainingMemberships}
        />
      </div>
    </AppShell>
  );
}
