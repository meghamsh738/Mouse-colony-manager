import { randomUUID } from "node:crypto";

import { approveRoleAction, rejectRoleAction } from "@/app/administration/users/actions";
import { decideDutyRequestAction } from "@/app/administration/duties/actions";
import { ApprovalInbox } from "@/components/app/approval-inbox";
import { AppShell } from "@/components/app/app-shell";
import { RoleDecisionForm } from "@/components/app/identity-admin-forms";
import { DutyDecisionForm } from "@/components/app/facility-duty-forms";
import { LabTransferWorkspace } from "@/components/app/lab-transfer-workflow";
import { PageHeader } from "@/components/app/page-header";
import { StatStrip } from "@/components/app/stat-strip";
import { WorksheetShell } from "@/components/app/worksheet-shell";
import { getSupplementalApprovalInbox, type ApprovalInboxItem } from "@/lib/approval-inbox-read";
import { canonicalRoleLabel, facilityDutyLabel, normalizeUserRole } from "@/lib/capabilities";
import { getFacilityDutyApprovalQueue } from "@/lib/facility-duty-governance";
import { getPrivilegedRoleApprovalQueue } from "@/lib/identity-governance";
import { getLabTransferRequestOptions, getLabTransferWorkspace } from "@/lib/lab-transfer-read";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

export default async function ApprovalsPage() {
  const user = await requireUser({ capability: "approvals:read" });
  const [workspace, options, roleRequests, dutyRequests, supplementalInbox] = await Promise.all([
    getLabTransferWorkspace(user),
    getLabTransferRequestOptions(user),
    getPrivilegedRoleApprovalQueue(user),
    getFacilityDutyApprovalQueue(user),
    getSupplementalApprovalInbox(user),
  ]);
  const transferInbox = workspace.requests.flatMap((request): ApprovalInboxItem[] => {
    if (request.status === "requested" && request.actions.canDecide) return [{
      id: `transfer:${request.id}`,
      category: "transfer",
      title: `${request.sourceLab.code} → ${request.destinationLab.code}`,
      detail: request.reason,
      scope: request.subjectType === "cage" ? request.sourceCage?.barcode ?? "Cage transfer" : `${request.animalCount} animals`,
      stage: "Destination decision",
      requestedAt: request.requestedAt,
      href: `#transfer-${request.id}`,
      tone: "warning",
    }];
    if (request.status === "destination_accepted" && request.actions.canFinalize) return [{
      id: `transfer:${request.id}`,
      category: "transfer",
      title: `${request.sourceLab.code} → ${request.destinationLab.code}`,
      detail: request.reason,
      scope: request.subjectType === "cage" ? request.sourceCage?.barcode ?? "Cage transfer" : `${request.animalCount} animals`,
      stage: "CMU finalization",
      requestedAt: request.requestedAt,
      href: `#transfer-${request.id}`,
      tone: "danger",
    }];
    return [];
  });
  const decisionInbox: ApprovalInboxItem[] = [
    ...roleRequests.filter((request) => request.requestedBy.id !== user.id && request.targetUser.id !== user.id).map((request) => ({
      id: `access:${request.id}`,
      category: "access" as const,
      title: request.requestedActive === null
        ? `${request.targetUser.name} · ${canonicalRoleLabel(normalizeUserRole(request.requestedRole))}`
        : `${request.targetUser.name} · ${request.requestedActive ? "Activate" : "Deactivate"}`,
      detail: request.reason,
      scope: "Identity governance",
      stage: "Independent administrator decision",
      requestedAt: request.createdAt,
      href: `#access-${request.id}`,
      tone: "danger" as const,
    })),
    ...dutyRequests.filter((request) => request.requestedBy.id !== user.id && request.targetUser.id !== user.id).map((request) => ({
      id: `duty:${request.id}`,
      category: "access" as const,
      title: `${request.requestType === "grant" ? "Grant" : "Revoke"} ${facilityDutyLabel(request.duty)} · ${request.targetUser.name}`,
      detail: request.reason,
      scope: "Facility duty governance",
      stage: "Independent administrator decision",
      requestedAt: request.createdAt,
      href: `#duty-${request.id}`,
      tone: "danger" as const,
    })),
    ...transferInbox,
    ...supplementalInbox,
  ].sort((left, right) => left.requestedAt.getTime() - right.requestedAt.getTime() || left.id.localeCompare(right.id));

  return (
    <AppShell currentPath="/approvals" role={user.role} userName={user.name ?? user.email}>
      <div className="space-y-5">
        <PageHeader eyebrow="Work queue" title="Approvals" />
        <ApprovalInbox items={decisionInbox} />
        <StatStrip
          stats={[
            { label: "Action required", value: decisionInbox.length, emphasis: decisionInbox.length ? "warning" : "success" },
            { label: "Transfers", value: decisionInbox.filter((item) => item.category === "transfer").length, emphasis: transferInbox.length ? "warning" : "neutral" },
            { label: "Facility operations", value: decisionInbox.filter((item) => item.category === "quarantine" || item.category === "cryostorage").length, emphasis: "info" },
            { label: "SOP decisions", value: decisionInbox.filter((item) => item.category === "sop").length, emphasis: "neutral" },
            { label: "Transfer blockers", value: workspace.counts.blocked, emphasis: workspace.counts.blocked ? "danger" : "success" },
          ]}
        />
        {user.canonicalRole === "facility_admin" ? <WorksheetShell
          eyebrow="Identity governance"
          summary={<span>{roleRequests.length} awaiting an independent administrator</span>}
          title="Privileged access"
        >
          {roleRequests.length ? <div className="divide-y divide-[var(--line)]">{roleRequests.map((request) => <article className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,.45fr)]" id={`access-${request.id}`} key={request.id}>
            <div className="min-w-0"><p className="wrap-value font-semibold">{request.targetUser.name} · {request.requestedActive === null ? canonicalRoleLabel(normalizeUserRole(request.requestedRole)) : request.requestedActive ? "Activate privileged account" : "Deactivate privileged account"}</p><p className="mt-1 text-sm text-[var(--muted)]">{request.targetUser.email} · requested by {request.requestedBy.name} · expires {formatDate(request.expiresAt)}</p><p className="mt-2 wrap-value text-sm">{request.reason}</p></div>
            {request.requestedBy.id === user.id || request.targetUser.id === user.id ? <p className="text-sm text-[var(--muted)]">A different Facility Admin must decide this request.</p> : <RoleDecisionForm approveAction={approveRoleAction} rejectAction={rejectRoleAction} requestId={request.id} />}
          </article>)}</div> : <p className="px-4 py-5 text-sm text-[var(--muted)]">No privileged access decisions are waiting.</p>}
        </WorksheetShell> : null}
        {user.canonicalRole === "facility_admin" ? <WorksheetShell
          eyebrow="Facility duty governance"
          summary={<span>{dutyRequests.length} awaiting an independent administrator</span>}
          title="Time-bounded duties"
        >
          {dutyRequests.length ? <div className="divide-y divide-[var(--line)]">{dutyRequests.map((request) => <article className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,.45fr)]" id={`duty-${request.id}`} key={request.id}>
            <div className="min-w-0"><p className="wrap-value font-semibold">{request.requestType === "grant" ? "Grant" : "Revoke"} {facilityDutyLabel(request.duty)} · {request.targetUser.name}</p><p className="mt-1 text-sm text-[var(--muted)]">{request.targetUser.email} · requested by {request.requestedBy.name} · expires {formatDate(request.expiresAt)}</p><p className="mt-2 wrap-value text-sm">{request.reason}</p></div>
            {request.requestedBy.id === user.id || request.targetUser.id === user.id ? <p className="text-sm text-[var(--muted)]">A different Facility Admin must decide this request.</p> : <DutyDecisionForm action={decideDutyRequestAction} requestId={request.id} requestVersion={request.version} />}
          </article>)}</div> : <p className="px-4 py-5 text-sm text-[var(--muted)]">No facility duty decisions are waiting.</p>}
        </WorksheetShell> : null}
        <section className="worksheet-shell p-5 md:p-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line)] pb-4">
            <div><p className="eyebrow">Cross-lab transfers</p><h2 className="text-xl font-semibold">Request, accept, finalize</h2></div>
            <span className="text-sm text-[var(--muted)]">{workspace.requests.length} visible requests</span>
          </div>
          <LabTransferWorkspace
            destinationLabs={options.canRequest ? options.destinationLabs : []}
            nonce={randomUUID()}
            requests={workspace.requests}
          />
        </section>
      </div>
    </AppShell>
  );
}
