"use client";

import { useActionState, useState, type ReactNode } from "react";

import { initialFormActionState, type FormActionState } from "@/lib/form-state";

const field = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

type WelfareSubjectOption = {
  id: string;
  label: string;
  type: "animal" | "cage";
  version: number;
};

export function WelfareCommandForm({
  action,
  children,
  label,
  tone = "primary",
}: {
  action: (state: FormActionState, formData: FormData) => Promise<FormActionState>;
  children: ReactNode;
  label: string;
  tone?: "primary" | "secondary" | "danger";
}) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const [identity] = useState(() => ({ idempotencyKey: crypto.randomUUID(), requestId: crypto.randomUUID() }));
  const buttonClass = tone === "danger" ? "btn-danger" : tone === "secondary" ? "btn-secondary" : "btn-primary";
  return (
    <form action={formAction} className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
      <input name="idempotencyKey" type="hidden" value={identity.idempotencyKey} />
      <input name="requestId" type="hidden" value={identity.requestId} />
      {children}
      <button className={buttonClass} disabled={pending} type="submit">{pending ? "Saving…" : label}</button>
      {state.message ? <p aria-live="polite" className={state.status === "error" ? "text-sm text-red-700" : "text-sm text-emerald-700"}>{state.message}</p> : null}
    </form>
  );
}

export function WelfareOpenCaseForm({
  action,
  subjects,
}: {
  action: (state: FormActionState, formData: FormData) => Promise<FormActionState>;
  subjects: WelfareSubjectOption[];
}) {
  const [selection, setSelection] = useState<WelfareSubjectOption | null>(() => subjects[0] ?? null);
  const [openedAt] = useState(() => new Date().toISOString());

  return (
    <div data-testid="welfare-open-form">
      <WelfareCommandForm action={action} label="Open welfare case">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium md:col-span-2">
            Subject
            <select
              className={field}
              data-testid="welfare-subject-picker"
              disabled={subjects.length === 0}
              onChange={(event) => {
                setSelection(subjects.find((subject) => `${subject.type}:${subject.id}` === event.target.value) ?? null);
              }}
              required
              value={selection ? `${selection.type}:${selection.id}` : ""}
            >
              {subjects.length === 0 ? <option value="">No eligible subjects</option> : null}
              {subjects.map((subject) => (
                <option key={`${subject.type}:${subject.id}`} value={`${subject.type}:${subject.id}`}>
                  {subject.label}
                </option>
              ))}
            </select>
          </label>
          <input name="subjectType" type="hidden" value={selection?.type ?? ""} />
          <input name="subjectId" type="hidden" value={selection?.id ?? ""} />
          <input name="expectedSubjectVersion" type="hidden" value={selection?.version ?? ""} />
          <label className="text-sm font-medium">
            Urgency
            <select className={field} name="severity" defaultValue="warning">
              <option value="info">Information</option>
              <option value="warning">Concern</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="text-sm font-medium md:col-span-2">
            Operational summary
            <input className={field} name="operationalSummary" maxLength={160} required />
          </label>
          <label className="text-sm font-medium md:col-span-2">
            Private clinical context
            <textarea className={field} name="privateClinicalSummary" maxLength={2000} required />
          </label>
          <input name="openedAt" type="hidden" value={openedAt} />
        </div>
      </WelfareCommandForm>
    </div>
  );
}
