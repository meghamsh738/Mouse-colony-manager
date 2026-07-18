"use client";

import { ArrowLeft, CheckCircle2, ClipboardCheck, LogIn, Send } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import type { QuarantineCaseStatus, QuarantineObservationResult } from "@prisma/client";

import {
  admitQuarantineCaseAction,
  recordQuarantineObservationAction,
  requestQuarantineReleaseAction,
  finalizeQuarantineReleaseAction,
} from "@/app/quarantine/actions";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { FormFeedback } from "@/components/app/form-feedback";
import { WorkflowImpact, WorkflowSteps } from "@/components/app/workflow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";

type QuarantineCageOption = { id: string; label: string; version: number };
type SelectedCase = {
  id: string;
  version: number;
  status: QuarantineCaseStatus;
  cageLabel: string;
  minimumReleaseAt: string;
  latestObservationResult: QuarantineObservationResult | null;
  openFollowupCount: number;
  occupants: Array<{ id: string; animalId: string; sex: string; strain: string }>;
};
type ReleaseDestination = { id: string; labId: string; barcode: string; label: string; occupantCount: number; effectiveCapacity: number; remainingCapacity: number; sexes: string[] };

function AdmissionForm({ cages, nonce, today, holdDays }: { cages: QuarantineCageOption[]; nonce: string; today: string; holdDays: number }) {
  const [state, action, pending] = useActionState(admitQuarantineCaseAction, initialFormActionState);
  const [cageId, setCageId] = useState(cages[0]?.id ?? "");
  const [admittedAt, setAdmittedAt] = useState(today);
  const [minimumHoldDays, setMinimumHoldDays] = useState(String(holdDays));
  const [reason, setReason] = useState("Facility quarantine admission.");
  const cage = cages.find((candidate) => candidate.id === cageId);
  const commandKey = useMemo(() => `${nonce}:admit:${cageId}:${admittedAt}:${minimumHoldDays}:${reason}`, [admittedAt, cageId, minimumHoldDays, nonce, reason]);
  if (!cages.length) return <p className="text-sm text-[var(--muted)]">Every visible quarantine cage already has an open case.</p>;
  return (
    <form action={action} className="space-y-4" data-testid="quarantine-admission-form">
      <input name="expectedCageVersion" type="hidden" value={cage?.version ?? 0} />
      <input name="idempotencyKey" type="hidden" value={commandKey} />
      <input name="requestId" type="hidden" value={commandKey} />
      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Quarantine cage</span><select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3" data-testid="quarantine-admission-cage" name="cageId" value={cageId} onChange={(event) => setCageId(event.target.value)}>{cages.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Admission date</span><Input data-testid="quarantine-admission-date" max={today} name="admittedAt" required type="date" value={admittedAt} onChange={(event) => setAdmittedAt(event.target.value)} /></label>
        <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Minimum hold</span><Input data-testid="quarantine-admission-hold" max={180} min={1} name="minimumHoldDays" required type="number" value={minimumHoldDays} onChange={(event) => setMinimumHoldDays(event.target.value)} /></label>
      </div>
      <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Reason</span><textarea className="min-h-20 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2" name="reason" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <FormFeedback state={state} />
      <Button data-testid="quarantine-admission-submit" disabled={pending || !cage} type="submit"><LogIn size={16} />{pending ? "Admitting..." : "Admit cage"}</Button>
    </form>
  );
}

function ObservationForm({ selectedCase, nonce, today }: { selectedCase: SelectedCase; nonce: string; today: string }) {
  const [state, action, pending] = useActionState(recordQuarantineObservationAction, initialFormActionState);
  const [observedAt, setObservedAt] = useState(today);
  const [result, setResult] = useState<"clear" | "monitor" | "exception" | "exception_resolved">(selectedCase.status === "exception_open" ? "exception_resolved" : "monitor");
  const [severity, setSeverity] = useState<"info" | "warning" | "critical">("info");
  const [note, setNote] = useState("Routine quarantine observation completed.");
  const commandKey = useMemo(() => `${nonce}:observe:${selectedCase.id}:${selectedCase.version}:${observedAt}:${result}:${severity}:${note}`, [nonce, note, observedAt, result, selectedCase.id, selectedCase.version, severity]);
  return (
    <form action={action} className="space-y-4" data-testid="quarantine-observation-form">
      <input name="caseId" type="hidden" value={selectedCase.id} /><input name="expectedVersion" type="hidden" value={selectedCase.version} /><input name="idempotencyKey" type="hidden" value={commandKey} /><input name="requestId" type="hidden" value={commandKey} />
      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Date</span><Input max={today} name="observedAt" required type="date" value={observedAt} onChange={(event) => setObservedAt(event.target.value)} /></label>
        <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Result</span><select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3" data-testid="quarantine-observation-result" name="result" value={result} onChange={(event) => { const value = event.target.value as typeof result; setResult(value); if (value === "exception" && severity === "info") setSeverity("warning"); }}><option value="clear">Clear</option><option value="monitor">Continue monitoring</option><option value="exception">Open exception</option>{selectedCase.status === "exception_open" ? <option value="exception_resolved">Resolve exception</option> : null}</select></label>
        <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Severity</span><select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3" name="severity" value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label>
      </div>
      <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Observation</span><textarea className="min-h-20 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2" name="note" value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input name="followupRequired" type="checkbox" />Follow-up required</label>
      <FormFeedback state={state} />
      <Button data-testid="quarantine-observation-submit" disabled={pending || selectedCase.status === "release_requested"} type="submit"><ClipboardCheck size={16} />{pending ? "Recording..." : "Record observation"}</Button>
    </form>
  );
}

function ReleaseRequestForm({ selectedCase, nonce, today }: { selectedCase: SelectedCase; nonce: string; today: string }) {
  const [state, action, pending] = useActionState(requestQuarantineReleaseAction, initialFormActionState);
  const [reason, setReason] = useState("Minimum hold completed and latest observation is clear.");
  const commandKey = `${nonce}:release-request:${selectedCase.id}:${selectedCase.version}:${today}:${reason}`;
  const eligibleObservation = (selectedCase.latestObservationResult === "clear" || selectedCase.latestObservationResult === "exception_resolved") && selectedCase.openFollowupCount === 0;
  return (
    <form action={action} className="space-y-4" data-testid="quarantine-release-request-form">
      <input name="caseId" type="hidden" value={selectedCase.id} /><input name="expectedVersion" type="hidden" value={selectedCase.version} /><input name="requestedAt" type="hidden" value={today} /><input name="idempotencyKey" type="hidden" value={commandKey} /><input name="requestId" type="hidden" value={commandKey} />
      <div className="metadata-grid"><div><span>Minimum release</span><strong>{selectedCase.minimumReleaseAt.slice(0, 10)}</strong></div><div><span>Latest observation</span><strong>{selectedCase.latestObservationResult?.replaceAll("_", " ") ?? "None"}</strong></div></div>
      <label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Release request reason</span><textarea className="min-h-20 w-full rounded-md border border-[var(--line)] bg-white px-3 py-2" name="reason" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {!eligibleObservation ? <p className="text-sm font-medium text-amber-800">Record a clear observation and resolve every welfare follow-up before requesting release.</p> : null}
      <FormFeedback state={state} />
      <Button data-testid="quarantine-release-request-submit" disabled={pending || !eligibleObservation || selectedCase.status !== "under_observation"} type="submit"><Send size={16} />{pending ? "Requesting..." : "Request release"}</Button>
    </form>
  );
}

function ReleaseFinalizationForm({ selectedCase, destinations, nonce, today }: { selectedCase: SelectedCase; destinations: ReleaseDestination[]; nonce: string; today: string }) {
  const [formState, action, pending] = useActionState(finalizeQuarantineReleaseAction, initialFormActionState);
  const [step, setStep] = useState<"details" | "review">("details");
  const [releasedAt, setReleasedAt] = useState(today);
  const [reason, setReason] = useState("Quarantine hold completed and release approved.");
  const [assignments, setAssignments] = useState<Record<string, string>>(() => Object.fromEntries(selectedCase.occupants.map((animal) => [animal.id, ""])));
  const [acknowledged, setAcknowledged] = useState(false);
  const proposedByDestination = Object.values(assignments).reduce<Record<string, number>>((counts, destinationId) => {
    if (destinationId) counts[destinationId] = (counts[destinationId] ?? 0) + 1;
    return counts;
  }, {});
  const overCapacityDestinations = destinations.filter((destination) => (proposedByDestination[destination.id] ?? 0) > destination.remainingCapacity);
  const assignmentRows = selectedCase.occupants.map((animal) => ({ animalId: animal.id, toCageId: assignments[animal.id] ?? "" }));
  const assignmentsJson = JSON.stringify(assignmentRows);
  const commandKey = `${nonce}:finalize:${selectedCase.id}:${selectedCase.version}:${releasedAt}:${reason}:${assignmentsJson}`;
  const canReview = Boolean(releasedAt && reason.trim().length >= 3 && selectedCase.occupants.every((animal) => assignments[animal.id]))
    && overCapacityDestinations.length === 0;
  return (
    <form action={action} className="space-y-4" data-testid="quarantine-finalize-form">
      <input name="caseId" type="hidden" value={selectedCase.id} /><input name="expectedVersion" type="hidden" value={selectedCase.version} /><input name="releasedAt" type="hidden" value={releasedAt} /><input name="reason" type="hidden" value={reason} /><input name="assignmentsJson" type="hidden" value={assignmentsJson} /><input name="workflowDraftId" type="hidden" value={nonce} /><input name="idempotencyKey" type="hidden" value={commandKey} /><input name="requestId" type="hidden" value={commandKey} />
      <WorkflowSteps currentStep={step} steps={[{ id: "details", label: "Destinations" }, { id: "review", label: "Review release" }]} />
      {step === "details" ? (
        <>
          <div className="grid gap-4 md:grid-cols-2"><label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Release date</span><Input max={today} required type="date" value={releasedAt} onChange={(event) => setReleasedAt(event.target.value)} /></label><label className="space-y-2 text-sm"><span className="text-[var(--muted)]">Reason</span><Input required value={reason} onChange={(event) => setReason(event.target.value)} /></label></div>
          <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {selectedCase.occupants.length ? selectedCase.occupants.map((animal) => (
              <div className="grid gap-2 py-3 md:grid-cols-[minmax(12rem,0.7fr)_minmax(14rem,1.3fr)] md:items-center" key={animal.id}>
                <div><strong className="wrap-value text-sm">{animal.animalId}</strong><p className="text-xs text-[var(--muted)]">{animal.sex} · {animal.strain}</p></div>
                <select aria-label={`Destination for ${animal.animalId}`} className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3" data-testid={`quarantine-finalize-destination-${animal.id}`} value={assignments[animal.id] ?? ""} onChange={(event) => setAssignments((current) => ({ ...current, [animal.id]: event.target.value }))}><option value="">Choose destination</option>{destinations.map((destination) => { const proposed = proposedByDestination[destination.id] ?? 0; return <option disabled={destination.remainingCapacity < 1 && assignments[animal.id] !== destination.id} key={destination.id} value={destination.id}>{destination.label} · {destination.occupantCount + proposed}/{destination.effectiveCapacity} proposed · {destination.sexes.join("/") || "empty"}</option>; })}</select>
              </div>
            )) : <p className="py-4 text-sm text-[var(--muted)]">No live occupants; the case can be closed without animal movements.</p>}
          </div>
          {overCapacityDestinations.length ? <div className="capacity-error"><strong>Destination capacity exceeded</strong>{overCapacityDestinations.map((destination) => <span key={destination.id}>{destination.label}: {destination.occupantCount + (proposedByDestination[destination.id] ?? 0)} proposed / {destination.effectiveCapacity} capacity</span>)}</div> : null}
          <div className="flex justify-end"><Button data-testid="quarantine-finalize-review" disabled={!canReview} onClick={() => setStep("review")} type="button" variant="danger">Review release</Button></div>
        </>
      ) : (
        <>
          <WorkflowImpact title="This ends quarantine and moves every listed animal."><p>The reviewed assignment plan is immutable after submission.</p></WorkflowImpact>
          <div className="metadata-grid"><div><span>Quarantine cage</span><strong>{selectedCase.cageLabel}</strong></div><div><span>Release date</span><strong>{releasedAt}</strong></div><div className="md:col-span-2"><span>Reason</span><strong className="wrap-value">{reason}</strong></div></div>
          <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{selectedCase.occupants.map((animal) => { const destination = destinations.find((candidate) => candidate.id === assignments[animal.id]); return <div className="flex flex-wrap justify-between gap-3 py-3 text-sm" key={animal.id}><strong>{animal.animalId}</strong><span className="wrap-value">{destination?.label ?? "Missing destination"} · {destination ? `${destination.occupantCount}/${destination.effectiveCapacity} occupied before release` : "capacity unavailable"}</span></div>; })}</div>
          <label className="flex min-h-11 items-start gap-3 border border-red-300 bg-red-50/80 px-4 py-3 text-sm text-red-950"><input checked={acknowledged} className="mt-1 size-4" onChange={(event) => setAcknowledged(event.target.checked)} required type="checkbox" /><span>I reviewed the release date, reason, every destination, and available cage capacity.</span></label>
          <FormFeedback state={formState} />
          <div className="flex flex-wrap justify-between gap-3"><Button disabled={pending || formState.status === "success"} onClick={() => { setAcknowledged(false); setStep("details"); }} type="button" variant="ghost"><ArrowLeft size={16} />Back</Button><Button data-testid="quarantine-finalize-submit" disabled={!acknowledged || pending || formState.status === "success"} type="submit" variant="danger"><CheckCircle2 size={16} />{pending ? "Releasing..." : formState.status === "success" ? "Release completed" : `Release ${selectedCase.occupants.length} ${selectedCase.occupants.length === 1 ? "mouse" : "mice"} from quarantine`}</Button></div>
        </>
      )}
    </form>
  );
}

export function QuarantineReleaseWorkflow({ selectedCase, destinations, nonce, today }: { selectedCase: SelectedCase; destinations: ReleaseDestination[]; nonce: string; today: string }) {
  return <ReleaseFinalizationForm selectedCase={selectedCase} destinations={destinations} nonce={nonce} today={today} />;
}

export function QuarantineOperations({ cages, selectedCase, canFinalize, nonce, today, holdDays }: { cages: QuarantineCageOption[]; selectedCase: SelectedCase | null; canFinalize: boolean; nonce: string; today: string; holdDays: number }) {
  const actions: CompactActionItem[] = [
    { id: "admit", label: "Admit cage", description: "Start quarantine case", tone: "primary", icon: <LogIn size={16} />, panel: <AdmissionForm cages={cages} nonce={nonce} today={today} holdDays={holdDays} /> },
    ...(selectedCase && selectedCase.status !== "release_requested" ? [{ id: "observe", label: "Record check", description: selectedCase.cageLabel, icon: <ClipboardCheck size={16} />, panel: <ObservationForm selectedCase={selectedCase} nonce={nonce} today={today} /> }] satisfies CompactActionItem[] : []),
    ...(selectedCase ? [{ id: "release", label: selectedCase.status === "release_requested" ? "Release quarantine animals" : "Request release", description: selectedCase.cageLabel, tone: selectedCase.status === "release_requested" ? "danger" as const : "warning" as const, icon: <Send size={16} />, href: selectedCase.status === "release_requested" && canFinalize ? `/quarantine?caseId=${selectedCase.id}&action=release` : undefined, panel: selectedCase.status === "release_requested" ? canFinalize ? undefined : <p className="text-sm text-[var(--muted)]">Awaiting CMU or Facility Admin finalization.</p> : <ReleaseRequestForm selectedCase={selectedCase} nonce={nonce} today={today} /> }] : []),
  ];
  return <CompactActionTray actions={actions} eyebrow="Quarantine actions" summary={<span>{selectedCase ? `${selectedCase.cageLabel} · ${selectedCase.status.replaceAll("_", " ")}` : "Select a case to record work"}</span>} title="Case work" />;
}
