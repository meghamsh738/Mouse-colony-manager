"use client";

import { useActionState, useState, type ReactNode } from "react";

import { FormFeedback } from "@/components/app/form-feedback";
import { StatStrip } from "@/components/app/stat-strip";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { WorksheetShell } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { formatDate, titleCase } from "@/lib/utils";

type Action = (state: FormActionState, data: FormData) => Promise<FormActionState>;
type ProtocolStatus = "draft" | "active" | "suspended" | "expired" | "revoked" | "legacy_unverified";
type CompetencyStatus = "current" | "expired" | "revoked";

type ProtocolRow = {
  id: string;
  labId: string;
  protocolCode: string;
  title: string;
  status: ProtocolStatus;
  version: number;
  createdById: string;
  lab: { name: string; code: string };
  createdBy: { name: string };
  currentVersion: null | {
    versionNumber: number;
    validFrom: string;
    validUntil: string;
    approvedAnimalCount: number;
    summary: string;
  };
};

type CompetencyRow = {
  id: string;
  labId: string;
  userId: string;
  procedureCode: string;
  status: CompetencyStatus;
  version: number;
  lab: { name: string; code: string };
  user: { name: string; email: string };
  currentVersion: null | {
    evidenceType: string;
    validFrom: string;
    validUntil: string;
    note: string | null;
  };
};

type DraftOptions = null | {
  lab: { id: string; name: string; code: string } | null;
  projects: Array<{ id: string; projectCode: string; title: string }>;
  experiments: Array<{ id: string; experimentCode: string; title: string }>;
  strains: Array<{ id: string; name: string }>;
  personnel: Array<{ id: string; name: string; email: string }>;
};

type MembershipOption = {
  labId: string;
  userId: string;
  lab: { name: string; code: string };
  user: { name: string; email: string };
};

type CommandFormProps = {
  action: Action;
  children: ReactNode;
  className?: string;
  pendingLabel: string;
  submitLabel: string;
  testId: string;
  variant?: ButtonProps["variant"];
};

const controlClass = "h-11 w-full min-w-0 rounded-md border border-[var(--line)] bg-white px-3 text-base text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)] md:h-10 md:text-sm";
const textareaClass = `${controlClass} min-h-24 resize-y py-2.5`;
const labelClass = "block min-w-0 space-y-1.5 text-sm";

function commandIdentity() {
  return { idempotencyKey: crypto.randomUUID(), requestId: crypto.randomUUID() };
}

function CommandForm({ action, children, className = "space-y-3", pendingLabel, submitLabel, testId, variant }: CommandFormProps) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const [identity] = useState(commandIdentity);
  const guard = useSubmitGuard(pending);
  return <form action={formAction} className={className} data-testid={testId} onSubmit={guard}>
    <input name="idempotencyKey" type="hidden" value={identity.idempotencyKey} />
    <input name="requestId" type="hidden" value={identity.requestId} />
    {children}
    <FormFeedback state={state} />
    <Button className="min-h-11 w-full sm:w-auto" disabled={pending} type="submit" variant={variant}>{pending ? pendingLabel : submitLabel}</Button>
  </form>;
}

function ProtocolDraftForm({ action, options }: { action: Action; options: NonNullable<DraftOptions> }) {
  return <CommandForm action={action} pendingLabel="Preparing draft…" submitLabel="Prepare private draft" testId="protocol-draft-form">
    <p className="text-sm text-[var(--muted)]">Active lab: <strong className="text-[var(--ink)]">{options.lab?.name ?? "Unavailable"}</strong>. Drafts remain private until a different protocol reviewer activates them.</p>
    <div className="grid gap-3 md:grid-cols-2">
      <label className={labelClass}><span>Protocol code</span><Input maxLength={60} name="protocolCode" required /></label>
      <label className={labelClass}><span>Title</span><Input maxLength={200} name="title" required /></label>
      <label className={labelClass}><span>Valid from</span><Input name="validFrom" required type="datetime-local" /></label>
      <label className={labelClass}><span>Valid until</span><Input name="validUntil" required type="datetime-local" /></label>
      <label className={labelClass}><span>Approved animal count</span><Input min={0} name="approvedAnimalCount" required type="number" /></label>
      <label className={labelClass}><span>Project</span><select className={controlClass} name="projectId" required><option value="">Choose project</option>{options.projects.map((project) => <option key={project.id} value={project.id}>{project.projectCode} — {project.title}</option>)}</select></label>
      <label className={labelClass}><span>Experiment (optional)</span><select className={controlClass} name="experimentId"><option value="">No experiment binding</option>{options.experiments.map((experiment) => <option key={experiment.id} value={experiment.id}>{experiment.experimentCode} — {experiment.title}</option>)}</select></label>
      <label className={labelClass}><span>Strain</span><select className={controlClass} name="strainId" required><option value="">Choose strain</option>{options.strains.map((strain) => <option key={strain.id} value={strain.id}>{strain.name}</option>)}</select></label>
      <label className={labelClass}><span>Procedure codes</span><Input maxLength={1_000} name="procedureCodes" placeholder="animal-use, injection" required /><span className="block text-xs text-[var(--muted)]">Separate multiple codes with commas.</span></label>
      <label className={labelClass}><span>Named person</span><select className={controlClass} name="personnelUserId" required><option value="">Choose active lab member</option>{options.personnel.map((person) => <option key={person.id} value={person.id}>{person.name} — {person.email}</option>)}</select></label>
      <label className={labelClass}><span>Protocol role</span><select className={controlClass} name="personnelRole" required>{["principal_investigator", "named_researcher", "procedure_operator", "breeding_operator", "intake_operator", "transfer_coordinator"].map((role) => <option key={role} value={role}>{titleCase(role)}</option>)}</select></label>
      <label className={`${labelClass} md:col-span-2`}><span>Scope summary</span><textarea className={textareaClass} maxLength={2_000} name="summary" required /></label>
    </div>
  </CommandForm>;
}

function nextProtocolStatuses(status: ProtocolStatus) {
  if (status === "draft") return ["active", "revoked"] as const;
  if (status === "active") return ["suspended", "expired", "revoked"] as const;
  if (status === "suspended") return ["active", "expired", "revoked"] as const;
  if (status === "legacy_unverified") return ["revoked"] as const;
  return [] as const;
}

function statusTone(status: ProtocolStatus | CompetencyStatus) {
  if (status === "active" || status === "current") return "success" as const;
  if (status === "draft" || status === "suspended" || status === "legacy_unverified") return "warning" as const;
  return "danger" as const;
}

function ProtocolDecisionForm({ action, protocol }: { action: Action; protocol: ProtocolRow }) {
  const nextStatuses = nextProtocolStatuses(protocol.status);
  if (!nextStatuses.length) return <p className="text-xs text-[var(--muted)]">No further status transition is available.</p>;
  return <CommandForm action={action} pendingLabel="Recording…" submitLabel="Record decision" testId={`protocol-decision-${protocol.id}`}>
    <input name="authorizationId" type="hidden" value={protocol.id} />
    <input name="labId" type="hidden" value={protocol.labId} />
    <input name="expectedVersion" type="hidden" value={protocol.version} />
    <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <label className={labelClass}><span>Decision</span><select className={controlClass} name="status">{nextStatuses.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}</select></label>
      <label className={labelClass}><span>Decision reason</span><Input maxLength={500} minLength={3} name="reason" required /></label>
    </div>
  </CommandForm>;
}

function CompetencyIssueForm({ action, memberships }: { action: Action; memberships: MembershipOption[] }) {
  return <CommandForm action={action} pendingLabel="Issuing…" submitLabel="Issue competency evidence" testId="competency-issue-form">
    <p className="text-sm text-[var(--muted)]">Evidence can be issued only to an active lab member, and a training administrator cannot issue their own record.</p>
    <div className="grid gap-3 md:grid-cols-2">
      <label className={`${labelClass} md:col-span-2`}><span>Lab member</span><select className={controlClass} name="membershipKey" required><option value="">Choose active member</option>{memberships.map((membership) => <option key={`${membership.labId}-${membership.userId}`} value={`${membership.labId}|${membership.userId}`}>{membership.lab.code} · {membership.user.name} — {membership.user.email}</option>)}</select></label>
      <label className={labelClass}><span>Procedure code</span><Input maxLength={100} name="procedureCode" required /></label>
      <label className={labelClass}><span>Evidence type</span><Input maxLength={120} name="evidenceType" placeholder="Observed practical assessment" required /></label>
      <label className={labelClass}><span>Valid from</span><Input name="validFrom" required type="datetime-local" /></label>
      <label className={labelClass}><span>Valid until</span><Input name="validUntil" required type="datetime-local" /></label>
      <label className={`${labelClass} md:col-span-2`}><span>Evidence note (optional)</span><Input maxLength={500} name="note" /></label>
    </div>
  </CommandForm>;
}

function CompetencyRenewForm({ action, record }: { action: Action; record: CompetencyRow }) {
  return <CommandForm action={action} pendingLabel="Renewing…" submitLabel="Renew evidence" testId={`competency-renew-${record.id}`}>
    <input name="membershipKey" type="hidden" value={`${record.labId}|${record.userId}`} />
    <input name="procedureCode" type="hidden" value={record.procedureCode} />
    <input name="expectedVersion" type="hidden" value={record.version} />
    {record.status === "revoked" ? <input name="renewRevoked" type="hidden" value="on" /> : null}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={labelClass}><span>Evidence type</span><Input defaultValue={record.currentVersion?.evidenceType} maxLength={120} name="evidenceType" required /></label>
      <label className={labelClass}><span>Evidence note</span><Input defaultValue={record.currentVersion?.note ?? ""} maxLength={500} name="note" /></label>
      <label className={labelClass}><span>New valid from</span><Input name="validFrom" required type="datetime-local" /></label>
      <label className={labelClass}><span>New valid until</span><Input name="validUntil" required type="datetime-local" /></label>
    </div>
  </CommandForm>;
}

function CompetencyTransitionForm({ action, record }: { action: Action; record: CompetencyRow }) {
  if (record.status !== "current") return null;
  return <CommandForm action={action} pendingLabel="Recording…" submitLabel="Change status" testId={`competency-transition-${record.id}`} variant="warning">
    <input name="evidenceId" type="hidden" value={record.id} />
    <input name="labId" type="hidden" value={record.labId} />
    <input name="expectedVersion" type="hidden" value={record.version} />
    <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <label className={labelClass}><span>Status</span><select className={controlClass} name="status"><option value="expired">Expired</option><option value="revoked">Revoked</option></select></label>
      <label className={labelClass}><span>Reason</span><Input maxLength={500} minLength={3} name="reason" required /></label>
    </div>
  </CommandForm>;
}

export function ComplianceAdminWorkspace({
  actions,
  actorId,
  canDraft,
  canManageCompetencies,
  canReviewProtocols,
  competencies,
  draftOptions,
  protocols,
  trainingMemberships,
}: {
  actions: { createProtocol: Action; transitionProtocol: Action; upsertCompetency: Action; transitionCompetency: Action };
  actorId: string;
  canDraft: boolean;
  canManageCompetencies: boolean;
  canReviewProtocols: boolean;
  competencies: CompetencyRow[];
  draftOptions: DraftOptions;
  protocols: ProtocolRow[];
  trainingMemberships: MembershipOption[];
}) {
  const pendingProtocols = protocols.filter((protocol) => protocol.status === "draft" || protocol.status === "suspended").length;
  const currentCompetencies = competencies.filter((record) => record.status === "current").length;
  const hasAdministrationRole = canDraft || canReviewProtocols || canManageCompetencies;

  return <div className="space-y-5" data-testid="compliance-admin-workspace">
    <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" data-testid="synthetic-compliance-boundary">
      <div className="flex flex-wrap items-center gap-2"><Badge variant="warning">Synthetic policy</Badge><strong>Local qualification only</strong></div>
      <p className="mt-1">This workspace does not replace institutional protocol approval or training records. It shows governance metadata only—never animal-level records, cage locations, health notes, or project-sensitive details.</p>
    </div>
    <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950" data-testid="maker-checker-notice">
      <strong>Independent review is enforced.</strong> A draft creator cannot approve their own protocol, and a training administrator cannot issue or decide their own competency evidence. Fresh multi-factor identity assurance and a current duty assignment are required for decisions.
    </div>

    <StatStrip stats={[
      { label: "Protocols in view", value: protocols.length, emphasis: "info" },
      { label: "Awaiting review", value: pendingProtocols, emphasis: pendingProtocols ? "warning" : "success" },
      { label: "Current competencies", value: currentCompetencies, emphasis: "success" },
    ]} />

    {!hasAdministrationRole ? <WorksheetShell eyebrow="Role boundary" title="No administration duty assigned"><div className="worksheet-empty"><strong>Read-only policy notice</strong><p>Your current role cannot prepare protocol drafts or govern competency evidence. Ask a Facility Admin to arrange the appropriate lab role or independently approved duty.</p></div></WorksheetShell> : null}

    {canDraft ? <WorksheetShell eyebrow="Lab owner or manager" summary={<span>Private until independent activation</span>} title="Prepare a protocol draft"><div className="p-4 md:p-5">{draftOptions?.lab && draftOptions.projects.length && draftOptions.strains.length && draftOptions.personnel.length ? <ProtocolDraftForm action={actions.createProtocol} options={draftOptions} /> : <div className="worksheet-empty"><strong>Draft prerequisites are incomplete</strong><p>The active lab needs a project, strain, and active member before a protocol draft can be prepared.</p></div>}</div></WorksheetShell> : null}

    {(canDraft || canReviewProtocols) ? <WorksheetShell eyebrow={canReviewProtocols ? "Independent protocol reviewer" : "Active lab scope"} summary={<span>{protocols.length} authorization records</span>} title="Protocol authorization register">
      {protocols.length ? <div className="grid gap-3 p-4 xl:grid-cols-2">{protocols.map((protocol) => <article className="min-w-0 rounded-md border border-[var(--line)] bg-white p-4" key={protocol.id}>
        <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="wrap-value font-semibold">{protocol.protocolCode} · {protocol.title}</p><p className="mt-1 text-xs text-[var(--muted)]">{protocol.lab.code} · version {protocol.currentVersion?.versionNumber ?? "unsealed"} · prepared by {protocol.createdBy.name}</p></div><Badge variant={statusTone(protocol.status)}>{titleCase(protocol.status)}</Badge></div>
        {protocol.currentVersion ? <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><p><span className="metadata-label block">Valid</span>{formatDate(protocol.currentVersion.validFrom)}–{formatDate(protocol.currentVersion.validUntil)}</p><p><span className="metadata-label block">Approved count</span>{protocol.currentVersion.approvedAnimalCount}</p><p className="sm:col-span-3"><span className="metadata-label block">Scope summary</span><span className="wrap-value">{protocol.currentVersion.summary}</span></p></div> : null}
        {canReviewProtocols ? <div className="mt-4 border-t border-[var(--line)] pt-4">{protocol.createdById === actorId ? <p className="text-sm text-amber-800">A different protocol reviewer must decide this authorization.</p> : <ProtocolDecisionForm action={actions.transitionProtocol} protocol={protocol} />}</div> : null}
      </article>)}</div> : <div className="worksheet-empty"><strong>No protocol authorizations</strong><p>Prepared drafts and their immutable status history will appear here.</p></div>}
    </WorksheetShell> : null}

    {canManageCompetencies ? <WorksheetShell eyebrow="Independent training administrator" summary={<span>Current duty and fresh MFA required</span>} title="Issue competency evidence"><div className="p-4 md:p-5"><CompetencyIssueForm action={actions.upsertCompetency} memberships={trainingMemberships.filter((membership) => membership.userId !== actorId)} /></div></WorksheetShell> : null}

    {canManageCompetencies ? <WorksheetShell eyebrow="Training evidence register" summary={<span>{competencies.length} governed records</span>} title="Renew or close competency evidence">
      {competencies.length ? <div className="grid gap-3 p-4 xl:grid-cols-2">{competencies.map((record) => <article className="min-w-0 rounded-md border border-[var(--line)] bg-white p-4" key={record.id}>
        <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="wrap-value font-semibold">{record.user.name} · {record.procedureCode}</p><p className="mt-1 text-xs text-[var(--muted)]">{record.lab.code} · {record.currentVersion?.evidenceType ?? "No current evidence version"}</p></div><Badge variant={statusTone(record.status)}>{titleCase(record.status)}</Badge></div>
        {record.currentVersion ? <p className="mt-3 text-sm"><span className="metadata-label block">Evidence validity</span>{formatDate(record.currentVersion.validFrom)}–{formatDate(record.currentVersion.validUntil)}</p> : null}
        {record.userId === actorId ? <p className="mt-4 text-sm text-amber-800">A different training administrator must govern your evidence.</p> : <div className="mt-4 space-y-4 border-t border-[var(--line)] pt-4"><details><summary className="cursor-pointer text-sm font-semibold">Renew evidence</summary><div className="mt-3"><CompetencyRenewForm action={actions.upsertCompetency} record={record} /></div></details><CompetencyTransitionForm action={actions.transitionCompetency} record={record} /></div>}
      </article>)}</div> : <div className="worksheet-empty"><strong>No competency evidence</strong><p>Issued competency records will appear here without exposing operational animal data.</p></div>}
    </WorksheetShell> : null}
  </div>;
}
