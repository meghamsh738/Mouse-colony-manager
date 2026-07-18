"use client";

import { useActionState } from "react";

import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";

type Action = (state: FormActionState | undefined, data: FormData) => Promise<FormActionState>;
type LabOption = { id: string; name: string; code: string };
type UserOption = { id: string; name: string; email: string };

const controlClass = "h-11 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)] md:h-10";
const textareaClass = "min-h-24 w-full resize-y rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus)]";

export function CreateLabForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const guard = useSubmitGuard(pending);
  return <form action={formAction} className="space-y-4" onSubmit={guard}>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="space-y-1 text-sm"><span>Name</span><Input maxLength={120} minLength={2} name="name" required /></label>
      <label className="space-y-1 text-sm"><span>Code</span><Input autoCapitalize="characters" maxLength={20} minLength={2} name="code" placeholder="LAB-3" required /></label>
      <label className="space-y-1 text-sm md:col-span-2"><span>Billing contact</span><Input maxLength={254} name="billingContact" placeholder="Name or institutional email" /></label>
      <label className="space-y-1 text-sm md:col-span-2"><span>Notes</span><textarea className={textareaClass} maxLength={2_000} name="notes" rows={3} /></label>
    </div>
    <FormFeedback state={state} />
    <Button disabled={pending} type="submit">{pending ? "Creating..." : "Create lab"}</Button>
  </form>;
}

export function AssignLabMembershipForm({ action, labs, users }: { action: Action; labs: LabOption[]; users: UserOption[] }) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const guard = useSubmitGuard(pending);
  return <form action={formAction} className="space-y-4" onSubmit={guard}>
    <div className="grid gap-3 md:grid-cols-3">
      <label className="space-y-1 text-sm"><span>Lab</span><select className={controlClass} name="labId" required><option value="">Choose lab</option>{labs.map((lab) => <option key={lab.id} value={lab.id}>{lab.code} · {lab.name}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>User</span><select className={controlClass} name="userId" required><option value="">Choose user</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>Membership role</span><select className={controlClass} defaultValue="staff" name="role"><option value="owner">Owner</option><option value="manager">Manager</option><option value="staff">Staff</option><option value="viewer">Viewer</option></select></label>
      <label className="space-y-1 text-sm md:col-span-3"><span>Reason</span><Input maxLength={350} minLength={5} name="reason" required /></label>
    </div>
    <FormFeedback state={state} />
    <Button disabled={pending || !labs.length || !users.length} type="submit">{pending ? "Saving..." : "Save membership"}</Button>
  </form>;
}

export function UpdateLabDetailsForm({
  action,
  lab,
}: {
  action: Action;
  lab: { id: string; name: string; billingContact: string | null; notes: string | null };
}) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const guard = useSubmitGuard(pending);
  return <form action={formAction} className="space-y-3" onSubmit={guard}>
    <input name="labId" type="hidden" value={lab.id} />
    <div className="grid gap-3 md:grid-cols-2">
      <label className="space-y-1 text-sm"><span>Name</span><Input defaultValue={lab.name} maxLength={120} minLength={2} name="name" required /></label>
      <label className="space-y-1 text-sm"><span>Billing contact</span><Input defaultValue={lab.billingContact ?? ""} maxLength={254} name="billingContact" /></label>
      <label className="space-y-1 text-sm md:col-span-2"><span>Notes</span><textarea className={textareaClass} defaultValue={lab.notes ?? ""} maxLength={2_000} name="notes" rows={2} /></label>
    </div>
    <FormFeedback state={state} />
    <Button disabled={pending} size="sm" type="submit" variant="secondary">{pending ? "Saving..." : "Save details"}</Button>
  </form>;
}

export function LabActiveStateForm({ action, active, labId }: { action: Action; active: boolean; labId: string }) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const guard = useSubmitGuard(pending);
  return <form action={formAction} className="space-y-2" onSubmit={guard}>
    <input name="labId" type="hidden" value={labId} />
    <input name="active" type="hidden" value={active ? "false" : "true"} />
    <label className="space-y-1 text-xs"><span>Reason</span><Input maxLength={350} minLength={5} name="reason" required /></label>
    <Button disabled={pending} size="sm" type="submit" variant={active ? "danger" : "secondary"}>{pending ? "Saving..." : active ? "Deactivate lab" : "Activate lab"}</Button>
    <FormFeedback state={state} />
  </form>;
}

export function LabMembershipActiveStateForm({
  action,
  active,
  membershipId,
}: {
  action: Action;
  active: boolean;
  membershipId: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const guard = useSubmitGuard(pending);
  return <form action={formAction} className="min-w-56 space-y-2" onSubmit={guard}>
    <input name="membershipId" type="hidden" value={membershipId} />
    <input name="active" type="hidden" value={active ? "false" : "true"} />
    <label className="space-y-1 text-xs"><span>Reason</span><Input maxLength={350} minLength={5} name="reason" required /></label>
    <Button disabled={pending} size="sm" type="submit" variant={active ? "warning" : "secondary"}>{pending ? "Saving..." : active ? "Deactivate" : "Activate"}</Button>
    <FormFeedback state={state} />
  </form>;
}
