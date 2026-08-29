"use client";

import { useActionState } from "react";

import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FACILITY_DUTIES, facilityDutyLabel } from "@/lib/capabilities";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";

type Action = (state: FormActionState | undefined, data: FormData) => Promise<FormActionState>;
const selectClass = "h-10 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]";

export function DutyGrantRequestForm({
  action,
  users,
}: {
  action: Action;
  users: Array<{ id: string; name: string; email: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const guard = useSubmitGuard(pending);
  return <form action={formAction} className="space-y-4" onSubmit={guard}>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="space-y-1 text-sm"><span>Duty holder</span><select className={selectClass} name="targetUserId" required><option value="">Choose user</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} — {user.email}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>Facility duty</span><select className={selectClass} name="duty">{FACILITY_DUTIES.map((duty) => <option key={duty} value={duty}>{facilityDutyLabel(duty)}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>Valid from</span><Input name="validFrom" required type="datetime-local" /></label>
      <label className="space-y-1 text-sm"><span>Valid until</span><Input name="validUntil" required type="datetime-local" /></label>
      <label className="space-y-1 text-sm md:col-span-2"><span>Reason</span><Input maxLength={500} minLength={5} name="reason" required /></label>
    </div>
    <FormFeedback state={state} />
    <Button disabled={pending || users.length === 0} type="submit">{pending ? "Requesting…" : "Request duty grant"}</Button>
  </form>;
}

export function DutyRevokeRequestForm({
  action,
  assignmentId,
  assignmentVersion,
}: {
  action: Action;
  assignmentId: string;
  assignmentVersion: number;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const guard = useSubmitGuard(pending);
  return <form action={formAction} className="min-w-56 space-y-2" onSubmit={guard}>
    <input name="assignmentId" type="hidden" value={assignmentId} />
    <input name="assignmentVersion" type="hidden" value={assignmentVersion} />
    <label className="space-y-1 text-xs"><span>Revocation reason</span><Input maxLength={500} minLength={5} name="reason" required /></label>
    <Button disabled={pending} size="sm" type="submit" variant="danger">{pending ? "Requesting…" : "Request revoke"}</Button>
    <FormFeedback state={state} />
  </form>;
}

export function DutyDecisionForm({
  action,
  requestId,
  requestVersion,
}: {
  action: Action;
  requestId: string;
  requestVersion: number;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const guard = useSubmitGuard(pending);
  return <div className="min-w-64 space-y-2">
    <form action={formAction} onSubmit={guard}>
      <input name="requestId" type="hidden" value={requestId} />
      <input name="expectedVersion" type="hidden" value={requestVersion} />
      <input name="decision" type="hidden" value="approve" />
      <Button disabled={pending} size="sm" type="submit">{pending ? "Saving…" : "Approve"}</Button>
    </form>
    <form action={formAction} className="space-y-2" onSubmit={guard}>
      <input name="requestId" type="hidden" value={requestId} />
      <input name="expectedVersion" type="hidden" value={requestVersion} />
      <input name="decision" type="hidden" value="reject" />
      <label className="space-y-1 text-xs"><span>Rejection reason</span><Input maxLength={500} minLength={5} name="reason" required /></label>
      <Button disabled={pending} size="sm" type="submit" variant="danger">{pending ? "Saving…" : "Reject"}</Button>
    </form>
    <FormFeedback state={state} />
  </div>;
}
