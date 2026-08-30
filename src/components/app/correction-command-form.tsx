"use client";

import type { CorrectionDomain } from "@prisma/client";
import { useActionState, useState } from "react";

import { CORRECTION_DOMAIN_LABELS, CORRECTION_PROPOSAL_EXAMPLES } from "@/lib/correction-state-machine";
import type { CorrectionTargetOption } from "@/lib/correction-read";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";

const field = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const domains = Object.keys(CORRECTION_DOMAIN_LABELS) as CorrectionDomain[];

function IdentityFields() {
  const [identity] = useState(() => ({ idempotencyKey: crypto.randomUUID(), requestId: crypto.randomUUID() }));
  return <><input name="idempotencyKey" type="hidden" value={identity.idempotencyKey} /><input name="requestId" type="hidden" value={identity.requestId} /></>;
}

export function CorrectionRequestForm({ action, labs, targetOptions }: {
  action: (state: FormActionState, formData: FormData) => Promise<FormActionState>;
  labs: Array<{ id: string; code: string; name: string }>;
  targetOptions: CorrectionTargetOption[];
}) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const [domain, setDomain] = useState<CorrectionDomain>("animal_move");
  const [labId, setLabId] = useState(labs[0]?.id ?? "");
  const [targetKey, setTargetKey] = useState("");
  const availableTargets = targetOptions.filter((target) => target.domain === domain && target.labId === labId);
  const selectedTarget = availableTargets.find((target) => target.key === targetKey) ?? availableTargets[0] ?? null;
  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" data-testid="correction-request-form">
      <IdentityFields />
      <input name="labId" type="hidden" value={selectedTarget?.labId ?? labId} />
      <input name="domain" type="hidden" value={domain} />
      <input name="targetEntityId" type="hidden" value={selectedTarget?.targetEntityId ?? ""} />
      <input name="sourceEventAt" type="hidden" value={selectedTarget?.sourceEventAt ?? ""} />
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium">Lab<select className={field} data-testid="correction-lab-picker" onChange={(event) => { setLabId(event.target.value); setTargetKey(""); }} value={labId}>{labs.map((lab) => <option key={lab.id} value={lab.id}>{lab.code} · {lab.name}</option>)}</select></label>
        <label className="text-sm font-medium">Record type<select className={field} data-testid="correction-domain-picker" onChange={(event) => { setDomain(event.target.value as CorrectionDomain); setTargetKey(""); }} value={domain}>{domains.map((value) => <option key={value} value={value}>{CORRECTION_DOMAIN_LABELS[value]}</option>)}</select></label>
        <label className="text-sm font-medium md:col-span-2">Authorized source record<select className={field} data-testid="correction-target-picker" disabled={availableTargets.length === 0} onChange={(event) => setTargetKey(event.target.value)} value={selectedTarget?.key ?? ""}>{availableTargets.length === 0 ? <option value="">No eligible records in this lab</option> : availableTargets.map((target) => <option key={target.key} value={target.key}>{target.label} · {new Date(target.sourceEventAt).toLocaleString()} · {target.targetVersion === null ? "event" : `v${target.targetVersion}`}</option>)}</select></label>
        <label className="text-sm font-medium md:col-span-2">Reason<textarea className={field} name="reason" minLength={8} maxLength={2000} required /></label>
        <label className="text-sm font-medium md:col-span-2">Corrected values (JSON)<textarea className={`${field} min-h-28 font-mono`} key={domain} name="proposedCorrection" defaultValue={CORRECTION_PROPOSAL_EXAMPLES[domain]} required /></label>
      </div>
      <p className="text-xs text-slate-600">The selected record supplies the authoritative lab, event time, and current version; the server reloads its evidence before saving. Only controlled metadata supersession is available. Physical moves, custody, generated weaning records, euthanasia/status reversals, and other structural changes are recorded as blocked—not applied.</p>
      <button className="btn-primary" disabled={pending || !selectedTarget} type="submit">{pending ? "Submitting…" : "Submit correction request"}</button>
      {state.message ? <p aria-live="polite" className={state.status === "error" ? "text-sm text-red-700" : "text-sm text-emerald-700"}>{state.message}</p> : null}
    </form>
  );
}

export function CorrectionDecisionForm({ action, correctionId, expectedVersion, allowApprove }: {
  action: (state: FormActionState, formData: FormData) => Promise<FormActionState>;
  correctionId: string;
  expectedVersion: number;
  allowApprove: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  return (
    <form action={formAction} className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
      <IdentityFields />
      <input name="correctionId" type="hidden" value={correctionId} /><input name="expectedVersion" type="hidden" value={expectedVersion} />
      <label className="text-sm font-medium">Decision reason<textarea className={field} name="decisionReason" minLength={8} maxLength={2000} required /></label>
      <div className="flex flex-wrap items-end gap-2"><button className="btn-primary" disabled={pending || !allowApprove} name="decision" type="submit" value="approve">Apply metadata supersession</button><button className="btn-secondary" disabled={pending} name="decision" type="submit" value="reject">Reject</button></div>
      {state.message ? <p aria-live="polite" className={`text-sm md:col-span-2 ${state.status === "error" ? "text-red-700" : "text-emerald-700"}`}>{state.message}</p> : null}
    </form>
  );
}
