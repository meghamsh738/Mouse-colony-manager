import { AppShell } from "@/components/app/app-shell";
import {
  DutyDecisionForm,
  DutyGrantRequestForm,
  DutyRevokeRequestForm,
} from "@/components/app/facility-duty-forms";
import { PageHeader } from "@/components/app/page-header";
import { StatStrip } from "@/components/app/stat-strip";
import { MobileWorksheetCard, WorksheetShell } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import { facilityDutyLabel } from "@/lib/capabilities";
import { getFacilityDutyWorkspace } from "@/lib/facility-duty-governance";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

import {
  decideDutyRequestAction,
  requestDutyGrantAction,
  requestDutyRevokeAction,
} from "./actions";

export default async function FacilityDutiesPage() {
  const actor = await requireUser({ capability: "duties:manage" });
  const workspace = await getFacilityDutyWorkspace(actor);
  const now = new Date();
  const activeAssignments = workspace.assignments.filter((assignment) => (
    !assignment.revokedAt && assignment.validFrom <= now && assignment.validUntil > now
  ));
  const users = workspace.users.map(({ id, name, email }) => ({ id, name, email }));

  return <AppShell currentPath="/administration/duties" role={actor.role} userName={actor.name ?? actor.email}>
    <div className="space-y-5">
      <PageHeader eyebrow="Identity governance" title="Facility duties" />
      {actor.assurance === "synthetic_mfa" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" data-testid="synthetic-assurance-notice">
          <Badge variant="warning">Synthetic assurance</Badge>
          This local QA session is using guarded synthetic MFA. It is not a production identity provider.
        </div>
      ) : null}
      <StatStrip stats={[
        { label: "Active duties", value: activeAssignments.length, emphasis: activeAssignments.length ? "info" : "neutral" },
        { label: "Pending decisions", value: workspace.pendingRequests.length, emphasis: workspace.pendingRequests.length ? "warning" : "success" },
        { label: "Eligible users", value: users.length, emphasis: "neutral" },
      ]} />

      <WorksheetShell eyebrow="Maker-checker request" summary={<span>Fresh MFA required</span>} title="Request a duty grant">
        <div className="p-4 md:p-5"><DutyGrantRequestForm action={requestDutyGrantAction} users={users} /></div>
      </WorksheetShell>

      <WorksheetShell eyebrow="Independent review" summary={<span>{workspace.pendingRequests.length} pending</span>} title="Duty requests">
        {workspace.pendingRequests.length ? <div className="divide-y divide-[var(--line)]">{workspace.pendingRequests.map((request) => {
          const canDecide = request.requestedById !== actor.id && request.targetUserId !== actor.id;
          return <article className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,.45fr)]" id={`duty-request-${request.id}`} key={request.id}>
            <div className="min-w-0">
              <p className="wrap-value font-semibold">{request.requestType === "grant" ? "Grant" : "Revoke"} {facilityDutyLabel(request.duty)} · {request.targetUser.name}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Requested by {request.requestedBy.name} · expires {formatDate(request.expiresAt)}</p>
              {request.requestType === "grant" ? <p className="mt-1 text-xs text-[var(--muted)]">{formatDate(request.requestedValidFrom!)} to {formatDate(request.requestedValidUntil!)}</p> : null}
              <p className="mt-2 wrap-value text-sm">{request.reason}</p>
            </div>
            {canDecide ? <DutyDecisionForm action={decideDutyRequestAction} requestId={request.id} requestVersion={request.version} /> : <p className="text-sm text-[var(--muted)]">A different Facility Admin must decide this request.</p>}
          </article>;
        })}</div> : <div className="worksheet-empty"><strong>Queue clear</strong><p>No duty decisions are waiting.</p></div>}
      </WorksheetShell>

      <WorksheetShell eyebrow="Time-bounded authority" summary={<span>{workspace.assignments.length} recorded</span>} title="Duty assignments">
        {workspace.assignments.length ? <><div className="data-table-wrap hidden md:block"><table className="data-table compact-table min-w-[920px]"><thead><tr><th>Duty holder</th><th>Duty</th><th>Valid from</th><th>Valid until</th><th>Status</th><th>Action</th></tr></thead><tbody>{workspace.assignments.map((assignment) => {
          const active = !assignment.revokedAt && assignment.validFrom <= now && assignment.validUntil > now;
          const future = !assignment.revokedAt && assignment.validFrom > now;
          return <tr key={assignment.id}>
            <td><strong>{assignment.user.name}</strong><br /><span className="text-xs text-[var(--muted)]">{assignment.user.email}</span></td>
            <td>{facilityDutyLabel(assignment.duty)}</td>
            <td>{formatDate(assignment.validFrom)}</td>
            <td>{formatDate(assignment.validUntil)}</td>
            <td><Badge variant={active ? "success" : future ? "info" : assignment.revokedAt ? "danger" : "warning"}>{active ? "active" : future ? "scheduled" : assignment.revokedAt ? "revoked" : "expired"}</Badge></td>
            <td>{active || future ? <DutyRevokeRequestForm action={requestDutyRevokeAction} assignmentId={assignment.id} assignmentVersion={assignment.version} /> : <span className="text-xs text-[var(--muted)]">No action</span>}</td>
          </tr>;
        })}</tbody></table></div><div className="worksheet-mobile-list md:hidden">{workspace.assignments.map((assignment) => {
          const active = !assignment.revokedAt && assignment.validFrom <= now && assignment.validUntil > now;
          const future = !assignment.revokedAt && assignment.validFrom > now;
          return <MobileWorksheetCard
            actions={active || future ? <DutyRevokeRequestForm action={requestDutyRevokeAction} assignmentId={assignment.id} assignmentVersion={assignment.version} /> : undefined}
            key={assignment.id}
            meta={<Badge variant={active ? "success" : future ? "info" : assignment.revokedAt ? "danger" : "warning"}>{active ? "active" : future ? "scheduled" : assignment.revokedAt ? "revoked" : "expired"}</Badge>}
            title={assignment.user.name}
          >
            <div className="mobile-worksheet-field mobile-worksheet-field-wide"><span className="mobile-worksheet-label">Duty</span><span className="mobile-worksheet-value">{facilityDutyLabel(assignment.duty)}</span></div>
            <div className="mobile-worksheet-field"><span className="mobile-worksheet-label">From</span><span className="mobile-worksheet-value">{formatDate(assignment.validFrom)}</span></div>
            <div className="mobile-worksheet-field"><span className="mobile-worksheet-label">Until</span><span className="mobile-worksheet-value">{formatDate(assignment.validUntil)}</span></div>
          </MobileWorksheetCard>;
        })}</div></> : <div className="worksheet-empty"><strong>No assignments</strong><p>Approved duty grants will appear here.</p></div>}
      </WorksheetShell>
    </div>
  </AppShell>;
}
