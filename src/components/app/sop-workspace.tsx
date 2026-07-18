"use client";

import {
  BookOpenCheck,
  Building2,
  FilePlus2,
  FlaskConical,
  History,
} from "lucide-react";
import {
  Fragment,
  useActionState,
  useState,
  type ReactNode,
} from "react";

import {
  acknowledgeSopAction,
  assignSopVersionAction,
  createSopAction,
  createSopVersionAction,
  decideSopVersionAction,
  revokeSopAssignmentAction,
} from "@/app/sops/actions";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { MobileWorksheetCard, RowActionMenu, WorksheetShell } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { FormActionState } from "@/lib/form-state";
import { initialFormActionState } from "@/lib/form-state";
import type { getSopWorkspace } from "@/lib/sop-read";
import { formatDate } from "@/lib/utils";

type SopWorkspaceView = Awaited<ReturnType<typeof getSopWorkspace>>;
type SopDocument = SopWorkspaceView["documents"][number];
type SopVersion = SopDocument["versions"][number];
type SopAssignment = SopDocument["assignments"][number];
type SopAction = (previousState: FormActionState, formData: FormData) => Promise<FormActionState>;

type CommandFormProps = {
  action: SopAction;
  children: ReactNode;
  className?: string;
  pendingLabel: string;
  submitLabel: string;
  testId: string;
  variant?: ButtonProps["variant"];
};

const controlClassName =
  "min-h-11 w-full min-w-0 rounded-md border border-[var(--line)] bg-white px-3 text-base text-[var(--ink)] outline-none focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm";
const textareaClassName = `${controlClassName} resize-y py-2.5`;
const labelClassName = "block min-w-0 space-y-1.5 text-sm";

function makeCommandIdentity() {
  return {
    idempotencyKey: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
  };
}

function CommandForm({
  action,
  children,
  className = "space-y-3",
  pendingLabel,
  submitLabel,
  testId,
  variant = "default",
}: CommandFormProps) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const [identity] = useState(makeCommandIdentity);
  const handleSubmit = useSubmitGuard(pending);

  return (
    <form
      action={formAction}
      className={className}
      data-testid={testId}
      onSubmit={handleSubmit}
    >
      <input name="idempotencyKey" type="hidden" value={identity.idempotencyKey} />
      <input name="requestId" type="hidden" value={identity.requestId} />
      {children}
      <FormFeedback state={state} />
      <Button className="min-h-11 w-full sm:w-auto" disabled={pending} type="submit" variant={variant}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}

function CreateSopForm({
  labId,
  scope,
}: {
  labId?: string;
  scope: "facility" | "lab";
}) {
  return (
    <CommandForm
      action={createSopAction}
      pendingLabel="Creating immutable version..."
      submitLabel="Create SOP version 1"
      testId={`create-${scope}-sop-form`}
    >
      <input name="scope" type="hidden" value={scope} />
      {labId ? <input name="labId" type="hidden" value={labId} /> : null}
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <label className={labelClassName}>
          <span className="text-[var(--muted)]">SOP code</span>
          <input className={controlClassName} maxLength={40} name="code" placeholder="SOP-101" required />
        </label>
        <label className={labelClassName}>
          <span className="text-[var(--muted)]">Category</span>
          <input className={controlClassName} maxLength={80} name="category" placeholder="Husbandry" required />
        </label>
      </div>
      <label className={labelClassName}>
        <span className="text-[var(--muted)]">Title</span>
        <input className={controlClassName} maxLength={160} name="title" placeholder="Routine cage change" required />
      </label>
      <label className={labelClassName}>
        <span className="text-[var(--muted)]">Version 1 content</span>
        <textarea
          className={textareaClassName}
          minLength={20}
          name="contentMarkdown"
          placeholder="Enter the exact controlled procedure content."
          required
          rows={8}
        />
      </label>
      <label className={labelClassName}>
        <span className="text-[var(--muted)]">Change summary</span>
        <textarea
          className={textareaClassName}
          maxLength={500}
          name="changeSummary"
          placeholder="Initial controlled version."
          required
          rows={3}
        />
      </label>
    </CommandForm>
  );
}

function CreateVersionForm({ document }: { document: SopDocument }) {
  const source = document.currentVersion ?? document.versions[0];

  return (
    <CommandForm
      action={createSopVersionAction}
      pendingLabel="Creating new version..."
      submitLabel="Create new immutable version"
      testId={`create-sop-version-${document.id}`}
    >
      <input name="sopId" type="hidden" value={document.id} />
      <input name="expectedVersion" type="hidden" value={document.version} />
      <p className="text-xs leading-5 text-[var(--muted)]">
        This creates a separate immutable version. The currently approved version remains in force until approval.
      </p>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <label className={labelClassName}>
          <span className="text-[var(--muted)]">Title</span>
          <input className={controlClassName} defaultValue={source?.title ?? document.title} maxLength={160} name="title" required />
        </label>
        <label className={labelClassName}>
          <span className="text-[var(--muted)]">Category</span>
          <input className={controlClassName} defaultValue={source?.category ?? document.category} maxLength={80} name="category" required />
        </label>
      </div>
      <label className={labelClassName}>
        <span className="text-[var(--muted)]">New version content</span>
        <textarea className={textareaClassName} defaultValue={source?.contentMarkdown} minLength={20} name="contentMarkdown" required rows={8} />
      </label>
      <label className={labelClassName}>
        <span className="text-[var(--muted)]">What changed</span>
        <textarea className={textareaClassName} maxLength={500} name="changeSummary" required rows={3} />
      </label>
    </CommandForm>
  );
}

function DecisionForm({ document, version }: { document: SopDocument; version: SopVersion }) {
  return (
    <CommandForm
      action={decideSopVersionAction}
      pendingLabel="Recording decision..."
      submitLabel={`Decide version ${version.versionNumber}`}
      testId={`decide-sop-version-${version.id}`}
      variant="subtle"
    >
      <input name="sopId" type="hidden" value={document.id} />
      <input name="versionId" type="hidden" value={version.id} />
      <input name="expectedVersion" type="hidden" value={document.version} />
      <p className="text-xs leading-5 text-[var(--muted)]">
        Decision applies only to immutable version {version.versionNumber}, hash {version.contentHash}.
      </p>
      <label className={labelClassName}>
        <span className="text-[var(--muted)]">Decision</span>
        <select className={controlClassName} defaultValue="approved" name="decision" required>
          <option value="approved">Approve exact version</option>
          <option value="rejected">Reject exact version</option>
        </select>
      </label>
      <label className={labelClassName}>
        <span className="text-[var(--muted)]">Decision note</span>
        <textarea className={textareaClassName} maxLength={500} name="note" required rows={3} />
      </label>
    </CommandForm>
  );
}

function AssignForm({ document, labOptions }: { document: SopDocument; labOptions: SopWorkspaceView["labOptions"] }) {
  if (!document.currentVersion) return null;

  return (
    <CommandForm
      action={assignSopVersionAction}
      pendingLabel="Assigning exact version..."
      submitLabel={`Assign approved version ${document.currentVersion.versionNumber}`}
      testId={`assign-sop-${document.id}`}
    >
      <input name="sopId" type="hidden" value={document.id} />
      <input name="versionId" type="hidden" value={document.currentVersion.id} />
      <input name="expectedVersion" type="hidden" value={document.version} />
      <p className="break-all text-xs leading-5 text-[var(--muted)]">
        Assignment is locked to version {document.currentVersion.versionNumber} · {document.currentVersion.contentHash}
      </p>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <label className={labelClassName}>
          <span className="text-[var(--muted)]">Lab</span>
          <select className={controlClassName} defaultValue={labOptions[0]?.id ?? ""} name="labId" required>
            <option disabled value="">Choose lab</option>
            {labOptions.map((lab) => (
              <option key={lab.id} value={lab.id}>{lab.code} · {lab.name}</option>
            ))}
          </select>
        </label>
        <label className={labelClassName}>
          <span className="text-[var(--muted)]">Due date</span>
          <input className={controlClassName} name="dueAt" type="date" />
        </label>
      </div>
      <label className={labelClassName}>
        <span className="text-[var(--muted)]">Assignment reason</span>
        <textarea className={textareaClassName} maxLength={500} name="reason" required rows={3} />
      </label>
    </CommandForm>
  );
}

function RevokeForm({ assignment }: { assignment: SopAssignment }) {
  return (
    <CommandForm
      action={revokeSopAssignmentAction}
      pendingLabel="Revoking assignment..."
      submitLabel="Revoke assignment"
      testId={`revoke-sop-assignment-${assignment.id}`}
      variant="danger"
    >
      <input name="assignmentId" type="hidden" value={assignment.id} />
      <input name="expectedVersion" type="hidden" value={assignment.version} />
      <label className={labelClassName}>
        <span className="text-[var(--muted)]">Revocation reason</span>
        <textarea className={textareaClassName} maxLength={500} name="reason" required rows={3} />
      </label>
    </CommandForm>
  );
}

function AcknowledgeForm({ assignment }: { assignment: SopAssignment }) {
  return (
    <CommandForm
      action={acknowledgeSopAction}
      pendingLabel="Recording acknowledgement..."
      submitLabel={`Acknowledge exact version ${assignment.versionNumber}`}
      testId={`acknowledge-sop-assignment-${assignment.id}`}
    >
      <input name="assignmentId" type="hidden" value={assignment.id} />
      <input name="expectedVersion" type="hidden" value={assignment.version} />
      <input name="sopVersionId" type="hidden" value={assignment.sopVersionId} />
      <input name="contentHash" type="hidden" value={assignment.contentHash} />
      <section className="min-w-0 border-y border-[var(--line)] py-3" aria-label="Exact assigned SOP version">
        <p className="font-semibold text-[var(--ink)]">{assignment.title}</p>
        <p className="mt-1 text-xs text-[var(--muted-strong)]">{assignment.category} · Version {assignment.versionNumber}</p>
        <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--ink)]">
          {assignment.contentMarkdown}
        </div>
        <p className="mt-3 break-all font-mono text-xs leading-5 text-[var(--muted)]">Content hash: {assignment.contentHash}</p>
      </section>
      <label className="flex min-h-11 items-start gap-3 text-sm leading-5 text-[var(--ink)]">
        <input className="mt-1 h-5 w-5 shrink-0" name="attestationConfirmed" required type="checkbox" />
        <span>I reviewed and understand this exact SOP version.</span>
      </label>
    </CommandForm>
  );
}

function VersionStatus({ decision }: { decision: SopVersion["decision"] }) {
  if (decision === "approved") return <Badge variant="success">Approved</Badge>;
  if (decision === "rejected") return <Badge variant="danger">Rejected</Badge>;
  return <Badge variant="warning">Pending approval</Badge>;
}

function ScopeBadge({ document }: { document: SopDocument }) {
  return (
    <Badge variant={document.scope === "facility" ? "info" : "neutral"}>
      {document.scope === "facility" ? "Facility" : document.lab?.code ?? "Lab"}
    </Badge>
  );
}

function AssignmentBadges({ assignment }: { assignment: SopAssignment }) {
  return (
    <span className="flex min-w-0 flex-wrap gap-1.5">
      {assignment.revokedAt ? <Badge variant="danger">Revoked</Badge> : <Badge variant="info">Active</Badge>}
      {assignment.dueAt && !assignment.revokedAt ? <Badge variant="warning">Due {formatDate(assignment.dueAt)}</Badge> : null}
      {assignment.acknowledgementCount ? (
        <Badge variant="success">{assignment.acknowledgementCount} acknowledged</Badge>
      ) : null}
      {assignment.acknowledgedByMe ? <Badge variant="success">Acknowledged by me</Badge> : null}
      {!assignment.revokedAt && !assignment.acknowledgedByMe && assignment.canAcknowledge ? (
        <Badge variant="warning">Acknowledgement due</Badge>
      ) : null}
    </span>
  );
}

function DocumentActions({ document, labOptions }: { document: SopDocument; labOptions: SopWorkspaceView["labOptions"] }) {
  const pendingVersions = document.versions.filter((version) => version.canDecide);
  if (!document.canCreateVersion && !document.canAssign && !pendingVersions.length) return null;

  return (
    <RowActionMenu label="Manage">
      {document.canCreateVersion ? (
        <details>
          <summary className="table-action min-h-11 w-full cursor-pointer justify-start">Create new version</summary>
          <div className="mt-3 border-l-2 border-[var(--line)] pl-3"><CreateVersionForm document={document} key={`${document.id}:${document.version}`} /></div>
        </details>
      ) : null}
      {pendingVersions.map((version) => (
        <details key={version.id}>
          <summary className="table-action min-h-11 w-full cursor-pointer justify-start">Decide version {version.versionNumber}</summary>
          <div className="mt-3 border-l-2 border-amber-300 pl-3"><DecisionForm document={document} key={`${version.id}:${document.version}`} version={version} /></div>
        </details>
      ))}
      {document.canAssign ? (
        <details>
          <summary className="table-action min-h-11 w-full cursor-pointer justify-start">Assign approved version</summary>
          <div className="mt-3 border-l-2 border-[var(--line)] pl-3"><AssignForm document={document} key={`${document.currentVersion?.id}:${document.version}`} labOptions={labOptions} /></div>
        </details>
      ) : null}
    </RowActionMenu>
  );
}

function AssignmentActions({ assignment }: { assignment: SopAssignment }) {
  if (!assignment.canAcknowledge && !assignment.canRevoke) return null;

  return (
    <RowActionMenu label="Assignment actions" tone={assignment.canRevoke ? "warning" : "default"}>
      {assignment.canAcknowledge ? <AcknowledgeForm assignment={assignment} key={`${assignment.id}:${assignment.acknowledgementCount}`} /> : null}
      {assignment.canRevoke ? (
        <details>
          <summary className="table-action min-h-11 w-full cursor-pointer justify-start text-[var(--danger)]">Revoke assignment</summary>
          <div className="mt-3 border-l-2 border-red-300 pl-3"><RevokeForm assignment={assignment} key={`${assignment.id}:${assignment.version}`} /></div>
        </details>
      ) : null}
    </RowActionMenu>
  );
}

function DocumentDetails({ document }: { document: SopDocument }) {
  return (
    <div className="min-w-0 divide-y divide-[var(--line)]">
      <section className="min-w-0 py-4 first:pt-0">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-[var(--ink)]">Current approved immutable version</h3>
          {document.currentVersion ? <Badge variant="success">Version {document.currentVersion.versionNumber} approved</Badge> : <Badge variant="warning">No approved version</Badge>}
        </div>
        {document.currentVersion ? (
          <div className="mt-3 min-w-0 space-y-3">
            <p className="break-all font-mono text-xs text-[var(--muted-strong)]">Content hash: {document.currentVersion.contentHash}</p>
            <pre className="max-w-full whitespace-pre-wrap break-words border-l-2 border-emerald-300 pl-3 font-sans text-sm leading-6 text-[var(--ink)]">
              {document.currentVersion.contentMarkdown}
            </pre>
          </div>
        ) : <p className="mt-2 text-sm text-[var(--muted)]">Pending and rejected versions do not replace the currently controlled SOP.</p>}
      </section>

      <section className="min-w-0 py-4">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-[var(--muted)]" aria-hidden="true" />
          <h3 className="font-semibold text-[var(--ink)]">Immutable version history</h3>
        </div>
        <div className="mt-2 min-w-0 divide-y divide-[var(--line)]">
          {document.versions.map((version) => (
            <article className="min-w-0 py-3" key={version.id}>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">Version {version.versionNumber} · {version.title}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">Created {formatDate(version.createdAt)}{version.createdBy ? ` by ${version.createdBy}` : ""}</p>
                </div>
                <VersionStatus decision={version.decision} />
              </div>
              <p className="mt-2 text-sm"><span className="text-[var(--muted)]">Change:</span> {version.changeSummary}</p>
              <p className="mt-2 break-all font-mono text-xs text-[var(--muted-strong)]">{version.contentHash}</p>
              {version.decision ? (
                <p className="mt-2 text-sm text-[var(--muted-strong)]">
                  {version.decision === "approved" ? "Approved" : "Rejected"} by {version.decidedBy ?? "Unknown user"}
                  {version.decidedAt ? ` on ${formatDate(version.decidedAt)}` : ""}
                  {version.decisionNote ? ` · ${version.decisionNote}` : ""}
                </p>
              ) : null}
              <details className="mt-2">
                <summary className="table-action min-h-11 cursor-pointer">Read exact version content</summary>
                <pre className="mt-2 max-w-full whitespace-pre-wrap break-words border-l-2 border-[var(--line)] pl-3 font-sans text-sm leading-6">{version.contentMarkdown}</pre>
              </details>
            </article>
          ))}
        </div>
      </section>

      <section className="min-w-0 py-4 last:pb-0">
        <h3 className="font-semibold text-[var(--ink)]">Assignments and acknowledgements</h3>
        {document.assignments.length ? (
          <div className="mt-2 min-w-0 divide-y divide-[var(--line)]">
            {document.assignments.map((assignment) => (
              <article className="min-w-0 py-3" key={assignment.id}>
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{assignment.lab.code} · {assignment.lab.name}</p>
                    <p className="mt-1 text-sm text-[var(--muted-strong)]">Exact version {assignment.versionNumber} assigned {formatDate(assignment.assignedAt)} by {assignment.assignedBy}</p>
                  </div>
                  <AssignmentBadges assignment={assignment} />
                </div>
                <p className="mt-2 text-sm"><span className="text-[var(--muted)]">Reason:</span> {assignment.reason}</p>
                <p className="mt-2 break-all font-mono text-xs text-[var(--muted-strong)]">Assigned hash: {assignment.contentHash}</p>
                {assignment.revokedAt ? (
                  <p className="mt-2 text-sm text-red-800">Revoked {formatDate(assignment.revokedAt)} by {assignment.revokedBy ?? "Unknown user"} · {assignment.revocationReason}</p>
                ) : null}
                <div className="mt-3 flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">{assignment.acknowledgementCount} acknowledgement{assignment.acknowledgementCount === 1 ? "" : "s"}</p>
                    {assignment.canViewAcknowledgementRoster && assignment.acknowledgements.length ? (
                      <ul className="mt-1 min-w-0 space-y-1 text-[var(--muted-strong)]">
                        {assignment.acknowledgements.map((acknowledgement) => (
                          <li className="break-words" key={acknowledgement.id}>{acknowledgement.userName} · {formatDate(acknowledgement.acknowledgedAt)}</li>
                        ))}
                      </ul>
                    ) : assignment.canViewAcknowledgementRoster ? (
                      <p className="mt-1 text-[var(--muted)]">No acknowledgements recorded.</p>
                    ) : (
                      <p className="mt-1 text-[var(--muted)]">{assignment.acknowledgedByMe ? "Your acknowledgement is recorded." : "Your acknowledgement is pending."}</p>
                    )}
                  </div>
                  <AssignmentActions assignment={assignment} />
                </div>
              </article>
            ))}
          </div>
        ) : <p className="mt-2 text-sm text-[var(--muted)]">No assignments recorded for this SOP.</p>}
      </section>
    </div>
  );
}

function MobileField({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "mobile-worksheet-field mobile-worksheet-field-wide" : "mobile-worksheet-field"}>
      <dt className="mobile-worksheet-label">{label}</dt>
      <dd className="mobile-worksheet-value">{value}</dd>
    </div>
  );
}

function DocumentDisclosure({ document, open = false }: { document: SopDocument; open?: boolean }) {
  return (
    <details className="min-w-0" open={open}>
      <summary className="table-action min-h-11 cursor-pointer">Open document details</summary>
      <div className="mt-3 min-w-0 border-t border-[var(--line)] pt-3"><DocumentDetails document={document} /></div>
    </details>
  );
}

export function SopWorkspace({ selectedSopId, workspace }: { selectedSopId?: string; workspace: SopWorkspaceView }) {
  const documents = selectedSopId
    ? [...workspace.documents].sort((left, right) => Number(right.id === selectedSopId) - Number(left.id === selectedSopId))
    : workspace.documents;
  const createActions: CompactActionItem[] = [];
  if (workspace.permissions.canCreateFacility) {
    createActions.push({
      id: "create-facility-sop",
      label: "Create facility SOP",
      description: "Create immutable version 1 for facility-wide approval.",
      icon: <Building2 className="h-4 w-4" aria-hidden="true" />,
      panel: <CreateSopForm key={`facility:${workspace.summary.documents}`} scope="facility" />,
      tone: "primary",
    });
  }
  if (workspace.permissions.canCreateLab) {
    createActions.push({
      id: "create-lab-sop",
      label: "Create lab SOP",
      description: "Create immutable version 1 for the active lab.",
      icon: <FlaskConical className="h-4 w-4" aria-hidden="true" />,
      panel: <CreateSopForm key={`lab:${workspace.summary.documents}`} labId={workspace.labOptions[0]?.id} scope="lab" />,
      tone: "primary",
    });
  }

  return (
    <div className="min-w-0 space-y-4 overflow-x-clip">
      {createActions.length ? (
        <CompactActionTray
          actions={createActions}
          eyebrow="Controlled creation"
          summary={<span>Version 1 remains pending until an authorized approver decides the exact content.</span>}
          title="SOP actions"
        />
      ) : null}

      <WorksheetShell
        eyebrow="Controlled documents"
        summary={
          <span>
            {workspace.summary.documents} documents · {workspace.summary.pendingApproval} pending · {workspace.summary.assignedToCurrentLab} assigned · {workspace.summary.awaitingMyAcknowledgement} awaiting my acknowledgement
          </span>
        }
        title="SOP worksheet"
      >
        {workspace.documents.length ? (
          <>
            <div className="worksheet-table-wrap hidden max-h-[calc(100vh-12rem)] md:block">
              <table className="worksheet-table min-w-[900px]" data-testid="sop-workspace-table">
                <thead className="!sticky !top-0 z-10">
                  <tr>
                    <th>Document</th>
                    <th>Scope</th>
                    <th>Controlled version</th>
                    <th>Approval queue</th>
                    <th>Assignments</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((document) => {
                    const pendingCount = document.versions.filter((version) => !version.decision).length;
                    const activeAssignments = document.assignments.filter((assignment) => !assignment.revokedAt).length;
                    return (
                      <Fragment key={document.id}>
                        <tr>
                          <td className="max-w-[18rem]">
                            <p className="worksheet-cell-strong">{document.code} · {document.title}</p>
                            <p className="mt-1 worksheet-cell-muted">{document.category}</p>
                          </td>
                          <td><ScopeBadge document={document} /></td>
                          <td>
                            {document.currentVersion ? (
                              <div className="space-y-1">
                                <Badge variant="success">Approved v{document.currentVersion.versionNumber}</Badge>
                                <p className="max-w-44 break-all font-mono text-xs text-[var(--muted)]">{document.currentVersion.contentHash}</p>
                              </div>
                            ) : <Badge variant="warning">None approved</Badge>}
                          </td>
                          <td>{pendingCount ? <Badge variant="warning">{pendingCount} pending</Badge> : <span className="worksheet-cell-muted">Clear</span>}</td>
                          <td>{activeAssignments ? <Badge variant="info">{activeAssignments} active</Badge> : <span className="worksheet-cell-muted">None active</span>}</td>
                          <td><DocumentActions document={document} labOptions={workspace.labOptions} /></td>
                        </tr>
                        <tr>
                          <td className="!p-0" colSpan={6}>
                            <div className="px-3 py-2"><DocumentDisclosure document={document} open={document.id === selectedSopId} /></div>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="worksheet-mobile-list md:hidden" data-testid="sop-workspace-mobile-list">
              {documents.map((document) => {
                const pendingCount = document.versions.filter((version) => !version.decision).length;
                return (
                  <MobileWorksheetCard
                    actions={<DocumentActions document={document} labOptions={workspace.labOptions} />}
                    key={document.id}
                    meta={<ScopeBadge document={document} />}
                    title={`${document.code} · ${document.title}`}
                  >
                    <MobileField label="Category" value={document.category} />
                    <MobileField label="Pending" value={pendingCount ? <Badge variant="warning">{pendingCount}</Badge> : "None"} />
                    <MobileField label="Controlled version" value={document.currentVersion ? <Badge variant="success">Approved v{document.currentVersion.versionNumber}</Badge> : <Badge variant="warning">None approved</Badge>} wide />
                    <MobileField label="Document" value={<DocumentDisclosure document={document} open={document.id === selectedSopId} />} wide />
                  </MobileWorksheetCard>
                );
              })}
            </div>
          </>
        ) : (
          <div className="px-4 py-10 text-center">
            <FilePlus2 className="mx-auto h-6 w-6 text-[var(--muted)]" aria-hidden="true" />
            <p className="mt-3 font-medium">No SOP documents are visible in this workspace.</p>
            <p className="mt-1 text-sm text-[var(--muted)]">Create version 1 when permitted, or switch to the relevant lab.</p>
          </div>
        )}
      </WorksheetShell>

      <p className="flex min-w-0 items-start gap-2 text-xs leading-5 text-[var(--muted)]">
        <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Approvals, assignments, and acknowledgements always refer to one exact immutable SOP version and content hash.
      </p>
    </div>
  );
}
