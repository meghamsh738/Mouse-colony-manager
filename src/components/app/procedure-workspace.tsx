"use client";

import { Ban, CheckCircle2, ClipboardPlus, PlayCircle } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import {
  cancelProcedurePlanAction,
  createProcedurePlanAction,
  recordProcedureOccurrenceAction,
} from "@/app/procedures/actions";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { FormFeedback } from "@/components/app/form-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";
import { formatDate } from "@/lib/utils";

type AssignmentOption = {
  id: string;
  version: number;
  experimentId: string;
  experimentVersion: number;
  labId: string;
  label: string;
  scheduledMin: string;
  scheduledMax: string | null;
};

type SopOption = {
  id: string;
  labId: string;
  label: string;
  sopId: string;
  sopVersionId: string;
  sopVersionNumber: number;
  sopContentHash: string;
};

type ProcedureRow = {
  id: string;
  labId: string;
  labCode: string;
  experimentCode: string;
  experimentTitle: string;
  projectCode: string;
  operationalContact: string | null;
  assignmentId: string;
  assignmentStatus: string;
  treatmentGroup: string | null;
  animalId: string;
  animalFacilityId: string;
  animalSex: string;
  strain: string;
  cageBarcode: string | null;
  roomNumber: string | null;
  rackNumber: string | null;
  cageNumber: string | null;
  procedureCode: string;
  title: string;
  scheduledAt: string;
  status: "planned" | "completed" | "cancelled";
  version: number;
  sopCode: string;
  sopTitle: string;
  sopVersionNumber: number;
  sopContentHash: string;
  occurrences: Array<{
    id: string;
    occurredAt: string;
    status: string;
    outcomeNote: string | null;
    animalFacilityId: string;
    cageBarcode: string | null;
    sopVersionNumber: number;
    sopContentHash: string;
    executedBy: string;
    correction: { requestId: string; appliedAt: string } | null;
  }>;
};

function datetimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function locationLabel(row: ProcedureRow) {
  const location = [row.roomNumber, row.rackNumber, row.cageNumber].filter(Boolean).join(" / ");
  return row.cageBarcode ? `${row.cageBarcode}${location ? ` · ${location}` : ""}` : "Unassigned";
}

function PlanForm({
  assignments,
  sops,
  nonce,
  planId,
  defaultScheduledAt,
}: {
  assignments: AssignmentOption[];
  sops: SopOption[];
  nonce: string;
  planId: string;
  defaultScheduledAt: string;
}) {
  const [state, action, pending] = useActionState(createProcedurePlanAction, initialFormActionState);
  const [assignmentId, setAssignmentId] = useState(assignments[0]?.id ?? "");
  const assignment = assignments.find((candidate) => candidate.id === assignmentId);
  const availableSops = sops.filter((candidate) => candidate.labId === assignment?.labId);
  const [sopAssignmentId, setSopAssignmentId] = useState(availableSops[0]?.id ?? "");
  const [procedureCode, setProcedureCode] = useState("");
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt);
  const selectedSop = availableSops.find((candidate) => candidate.id === sopAssignmentId);
  const commandKey = useMemo(() => JSON.stringify({
    nonce,
    planId,
    assignmentId,
    assignmentVersion: assignment?.version,
    experimentVersion: assignment?.experimentVersion,
    sopAssignmentId,
    procedureCode,
    title,
    scheduledAt,
  }), [assignment?.experimentVersion, assignment?.version, assignmentId, nonce, planId, procedureCode, scheduledAt, sopAssignmentId, title]);
  if (!assignments.length) return <p className="text-sm text-[var(--muted)]">No active experiment assignments are available for procedure planning.</p>;
  return (
    <form action={action} className="space-y-4" data-testid="procedure-plan-form">
      <input name="planId" type="hidden" value={planId} />
      <input name="labId" type="hidden" value={assignment?.labId ?? ""} />
      <input name="expectedAssignmentVersion" type="hidden" value={assignment?.version ?? 0} />
      <input name="expectedExperimentVersion" type="hidden" value={assignment?.experimentVersion ?? 0} />
      <input name="idempotencyKey" type="hidden" value={commandKey} />
      <input name="requestId" type="hidden" value={commandKey} />
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Experiment assignment</span>
          <select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3" name="assignmentId" value={assignmentId} onChange={(event) => {
            const nextAssignmentId = event.target.value;
            const nextLabId = assignments.find((candidate) => candidate.id === nextAssignmentId)?.labId;
            setAssignmentId(nextAssignmentId);
            setSopAssignmentId(sops.find((candidate) => candidate.labId === nextLabId)?.id ?? "");
          }}>
            {assignments.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Assigned SOP</span>
          <select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3" name="sopAssignmentId" value={selectedSop?.id ?? ""} onChange={(event) => setSopAssignmentId(event.target.value)}>
            {availableSops.length ? availableSops.map((option) => <option key={option.id} value={option.id}>{option.label}</option>) : <option value="">No current assigned SOP</option>}
          </select>
        </label>
        <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Procedure code</span><Input maxLength={80} name="procedureCode" required value={procedureCode} onChange={(event) => setProcedureCode(event.target.value)} placeholder="e.g. IP-INJ" /></label>
        <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Procedure</span><Input maxLength={160} name="title" required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Procedure title" /></label>
        <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Scheduled</span><Input min={assignment ? datetimeLocal(assignment.scheduledMin) : undefined} max={assignment?.scheduledMax ? datetimeLocal(assignment.scheduledMax) : undefined} name="scheduledAt" required type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>
        <div className="self-end text-xs text-[var(--muted)]">
          {selectedSop ? <span className="wrap-value">Exact SOP v{selectedSop.sopVersionNumber} · {selectedSop.sopContentHash.slice(0, 12)}…</span> : "Assign an approved SOP before planning."}
        </div>
      </div>
      <FormFeedback state={state} />
      <Button disabled={pending || state.status === "success" || !assignment || !selectedSop || !procedureCode.trim() || !title.trim() || !scheduledAt} type="submit"><ClipboardPlus size={16} />{pending ? "Scheduling..." : state.status === "success" ? "Scheduled" : "Schedule procedure"}</Button>
    </form>
  );
}

function CancelPlanForm({ row, nonce }: { row: ProcedureRow; nonce: string }) {
  const [state, action, pending] = useActionState(cancelProcedurePlanAction, initialFormActionState);
  const [reason, setReason] = useState("");
  const commandKey = `${nonce}:cancel:${row.id}:${row.version}:${reason}`;
  return (
    <form action={action} className="space-y-3 border-t border-[var(--line)] pt-3">
      <input name="planId" type="hidden" value={row.id} /><input name="labId" type="hidden" value={row.labId} /><input name="expectedVersion" type="hidden" value={row.version} /><input name="idempotencyKey" type="hidden" value={commandKey} /><input name="requestId" type="hidden" value={commandKey} />
      <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Cancellation reason</span><Input maxLength={400} name="reason" required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <FormFeedback state={state} /><Button disabled={pending || state.status === "success" || reason.trim().length < 3} type="submit" variant="danger"><Ban size={16} />{pending ? "Cancelling..." : "Cancel plan"}</Button>
    </form>
  );
}

function RecordOccurrenceForm({ row, nonce, defaultOccurredAt }: { row: ProcedureRow; nonce: string; defaultOccurredAt: string }) {
  const [state, action, pending] = useActionState(recordProcedureOccurrenceAction, initialFormActionState);
  const [status, setStatus] = useState<"completed" | "not_performed" | "aborted">("completed");
  const [occurredAt, setOccurredAt] = useState(defaultOccurredAt);
  const [outcomeNote, setOutcomeNote] = useState("");
  const occurrenceKey = `${nonce}:${row.id}:${row.version}`;
  const commandKey = JSON.stringify({ occurrenceKey, planId: row.id, planVersion: row.version, status, occurredAt, outcomeNote });
  return (
    <form action={action} className="space-y-3 border-t border-[var(--line)] pt-3" data-testid={`procedure-occurrence-${row.id}`}>
      <input name="planId" type="hidden" value={row.id} /><input name="labId" type="hidden" value={row.labId} /><input name="expectedVersion" type="hidden" value={row.version} /><input name="occurrenceKey" type="hidden" value={occurrenceKey} /><input name="idempotencyKey" type="hidden" value={commandKey} /><input name="requestId" type="hidden" value={commandKey} />
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Occurred</span><Input max={defaultOccurredAt} name="occurredAt" required type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
        <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Outcome</span><select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3" name="status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="completed">Completed</option><option value="not_performed">Not performed</option><option value="aborted">Aborted</option></select></label>
      </div>
      <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Outcome note {status === "completed" ? "(optional)" : ""}</span><textarea className="min-h-20 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2" maxLength={500} name="outcomeNote" required={status !== "completed"} value={outcomeNote} onChange={(event) => setOutcomeNote(event.target.value)} /></label>
      <FormFeedback state={state} /><Button disabled={pending || state.status === "success" || !occurredAt || (status !== "completed" && outcomeNote.trim().length < 3)} type="submit"><CheckCircle2 size={16} />{pending ? "Recording..." : state.status === "success" ? "Recorded" : "Record outcome"}</Button>
    </form>
  );
}

function ProcedureActions({ row, canPlan, canExecute, nonce, defaultOccurredAt }: { row: ProcedureRow; canPlan: boolean; canExecute: boolean; nonce: string; defaultOccurredAt: string }) {
  if (row.status !== "planned" || (!canPlan && !canExecute)) return null;
  return (
    <details className="mt-3 border-t border-[var(--line)] pt-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-emerald-800"><PlayCircle size={16} />Procedure actions</summary>
      <div className="grid gap-4 pt-3 lg:grid-cols-2">
        {canExecute ? <RecordOccurrenceForm defaultOccurredAt={defaultOccurredAt} nonce={nonce} row={row} /> : null}
        {canPlan ? <CancelPlanForm nonce={nonce} row={row} /> : null}
      </div>
    </details>
  );
}

export function ProcedureWorkspace({
  rows,
  assignments,
  sops,
  canPlan,
  canExecute,
  nonce,
  planId,
  defaultScheduledAt,
  defaultOccurredAt,
}: {
  rows: ProcedureRow[];
  assignments: AssignmentOption[];
  sops: SopOption[];
  canPlan: boolean;
  canExecute: boolean;
  nonce: string;
  planId: string;
  defaultScheduledAt: string;
  defaultOccurredAt: string;
}) {
  const actions: CompactActionItem[] = canPlan ? [{
    id: "plan-procedure",
    label: "Plan procedure",
    description: "Assignment + exact SOP",
    tone: "primary",
    icon: <ClipboardPlus size={16} />,
    panel: <PlanForm assignments={assignments} defaultScheduledAt={defaultScheduledAt} nonce={nonce} planId={planId} sops={sops} />,
  }] : [];
  return (
    <div className="space-y-5">
      {actions.length ? <CompactActionTray actions={actions} eyebrow="Procedure actions" summary={<span>{assignments.length} eligible assignments · {sops.length} current SOP assignments</span>} title="Schedule work" /> : null}
      <div className="record-list">
        {rows.length ? rows.map((row) => (
          <article className={`record-card ${row.status === "planned" && new Date(row.scheduledAt) <= new Date() ? "record-card-warning" : ""}`} key={row.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="wrap-value">{row.procedureCode}</strong><Badge variant={row.status === "planned" ? "warning" : row.status === "completed" ? "success" : "neutral"}>{row.status}</Badge></div><p className="mt-1 wrap-value text-sm">{row.title}</p></div>
              <div className="text-right text-sm"><strong>{formatDate(row.scheduledAt)}</strong><p className="text-xs text-[var(--muted)]">{row.labCode}</p></div>
            </div>
            <div className="metadata-grid mt-4">
              <div><span>Experiment</span><strong className="wrap-value">{row.experimentCode} · {row.experimentTitle}</strong></div>
              <div><span>Animal</span><strong>{row.animalFacilityId}</strong><small>{row.animalSex} · {row.strain}</small></div>
              <div><span>Cage</span><strong className="wrap-value">{locationLabel(row)}</strong></div>
              <div><span>Group</span><strong className="wrap-value">{row.treatmentGroup ?? "Not assigned"}</strong></div>
              <div><span>SOP</span><strong className="wrap-value">{row.sopCode} v{row.sopVersionNumber}</strong><small className="wrap-value">{row.sopContentHash.slice(0, 12)}…</small></div>
              <div><span>Contact</span><strong className="wrap-value">{row.operationalContact ?? "Not recorded"}</strong></div>
            </div>
            {row.occurrences.map((occurrence) => <div className="mt-4 border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3 text-sm" key={occurrence.id}><div className="flex flex-wrap justify-between gap-2"><strong>{occurrence.status.replaceAll("_", " ")}</strong><span>{formatDate(occurrence.occurredAt)} · {occurrence.executedBy}</span></div>{occurrence.outcomeNote ? <p className="mt-1 wrap-value">{occurrence.outcomeNote}</p> : null}<p className="mt-1 text-xs text-emerald-900">Exact SOP v{occurrence.sopVersionNumber} · {occurrence.sopContentHash.slice(0, 12)}…</p>{occurrence.correction ? <p className="mt-1 text-xs font-semibold text-emerald-900" data-testid={`procedure-correction-${occurrence.id}`}>Corrected metadata · request {occurrence.correction.requestId.slice(0, 12)}</p> : null}</div>)}
            <ProcedureActions canExecute={canExecute} canPlan={canPlan} defaultOccurredAt={defaultOccurredAt} nonce={nonce} row={row} />
          </article>
        )) : <div className="worksheet-empty">No procedure plans match this view.</div>}
      </div>
    </div>
  );
}
