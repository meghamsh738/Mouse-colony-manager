"use client";

import { useActionState, useState } from "react";

import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";

type Action = (state: FormActionState | undefined, data: FormData) => Promise<FormActionState>;
const selectClass = "h-10 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]";

export function InvitationForm({ action, labs }: { action: Action; labs: Array<{ id: string; name: string; code: string }> }) {
  const [role, setRole] = useState("lab_user");
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const guard = useSubmitGuard(pending);
  return <form action={formAction} className="space-y-4" onSubmit={guard}>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="space-y-1 text-sm"><span>Email</span><Input autoComplete="off" name="email" required type="email" /></label>
      <label className="space-y-1 text-sm"><span>Name (optional)</span><Input name="name" /></label>
      <label className="space-y-1 text-sm"><span>Account type</span><select className={selectClass} name="targetRole" onChange={(event) => setRole(event.target.value)} value={role}><option value="lab_user">Lab User</option><option value="cmu_staff">CMU Staff</option></select></label>
      {role === "lab_user" ? <>
        <label className="space-y-1 text-sm"><span>Lab</span><select className={selectClass} name="labId" required><option value="">Choose lab</option>{labs.map((lab) => <option key={lab.id} value={lab.id}>{lab.name} ({lab.code})</option>)}</select></label>
        <label className="space-y-1 text-sm"><span>Lab role</span><select className={selectClass} defaultValue="staff" name="membershipRole"><option value="owner">Owner</option><option value="manager">Manager</option><option value="staff">Staff</option><option value="viewer">Viewer</option></select></label>
      </> : null}
    </div>
    <FormFeedback state={state} /><Button disabled={pending} type="submit">{pending ? "Creating…" : "Create invitation"}</Button>
  </form>;
}

export function RoleRequestForm({ action, users }: { action: Action; users: Array<{ id: string; name: string; email: string }> }) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const guard = useSubmitGuard(pending);
  return <form action={formAction} className="space-y-4" onSubmit={guard}>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="space-y-1 text-sm"><span>User</span><select className={selectClass} name="targetUserId" required><option value="">Choose user</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} — {user.email}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>Requested role</span><select className={selectClass} name="requestedRole"><option value="facility_admin">Facility Admin</option><option value="it_head">IT Head</option><option value="cmu_staff">CMU Staff</option><option value="lab_user">Lab User</option></select></label>
      <label className="space-y-1 text-sm md:col-span-2"><span>Reason</span><Input maxLength={350} minLength={5} name="reason" required /></label>
    </div>
    <FormFeedback state={state} /><Button disabled={pending || !users.length} type="submit" variant="secondary">{pending ? "Requesting…" : "Request role change"}</Button>
  </form>;
}

export function RoutineRoleForm({ action, users }: { action: Action; users: Array<{ id: string; name: string; email: string }> }) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const guard = useSubmitGuard(pending);
  return <form action={formAction} className="space-y-4" onSubmit={guard}>
    <div className="grid gap-3 md:grid-cols-3">
      <label className="space-y-1 text-sm"><span>User</span><select className={selectClass} name="targetUserId" required><option value="">Choose user</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} — {user.email}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>Role</span><select className={selectClass} name="requestedRole"><option value="lab_user">Lab User</option><option value="cmu_staff">CMU Staff</option></select></label>
      <label className="space-y-1 text-sm"><span>Reason</span><Input maxLength={350} minLength={5} name="reason" required /></label>
    </div>
    <FormFeedback state={state} /><Button disabled={pending || !users.length} type="submit" variant="secondary">{pending ? "Updating…" : "Update routine access"}</Button>
  </form>;
}

export function AccountStatusForm({ action, active, userId }: { action: Action; active: boolean; userId: string }) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const guard = useSubmitGuard(pending);
  return <form action={formAction} className="flex min-w-56 flex-wrap items-end gap-2" onSubmit={guard}>
    <input name="targetUserId" type="hidden" value={userId} />
    <input name="active" type="hidden" value={active ? "false" : "true"} />
    <label className="min-w-36 flex-1 space-y-1 text-xs"><span>Reason</span><Input maxLength={350} minLength={5} name="reason" required /></label>
    <Button disabled={pending} size="sm" type="submit" variant={active ? "danger" : "secondary"}>{pending ? "Saving…" : active ? "Deactivate" : "Activate"}</Button>
    <div className="w-full"><FormFeedback state={state} /></div>
  </form>;
}

export function RoleApprovalForm({ action, requestId }: { action: Action; requestId: string }) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const guard = useSubmitGuard(pending);
  return <form action={formAction} className="space-y-2" onSubmit={guard}>
    <input name="requestId" type="hidden" value={requestId} />
    <Button disabled={pending} size="sm" type="submit">{pending ? "Approving…" : "Approve"}</Button>
    <FormFeedback state={state} />
  </form>;
}

export function InvitationLifecycleActions({
  canRevoke = true,
  invitationId,
  resendAction,
  revokeAction,
}: {
  canRevoke?: boolean;
  invitationId: string;
  resendAction: Action;
  revokeAction: Action;
}) {
  const [resendState, resendFormAction, resendPending] = useActionState(resendAction, initialFormActionState);
  const [revokeState, revokeFormAction, revokePending] = useActionState(revokeAction, initialFormActionState);
  return <div className="min-w-56 space-y-2">
    <div className="action-row">
      <form action={resendFormAction}><input name="invitationId" type="hidden" value={invitationId} /><Button disabled={resendPending || revokePending} size="sm" type="submit" variant="secondary">{resendPending ? "Resending..." : "Resend"}</Button></form>
      {canRevoke ? <form action={revokeFormAction} className="space-y-2"><input name="invitationId" type="hidden" value={invitationId} /><label className="space-y-1 text-xs"><span>Revocation reason</span><Input maxLength={400} minLength={5} name="reason" required /></label><Button disabled={resendPending || revokePending} size="sm" type="submit" variant="danger">{revokePending ? "Revoking..." : "Revoke"}</Button></form> : null}
    </div>
    <FormFeedback state={resendState.status !== "idle" ? resendState : revokeState} />
  </div>;
}

export function RoleDecisionForm({
  approveAction,
  rejectAction,
  requestId,
}: {
  approveAction: Action;
  rejectAction: Action;
  requestId: string;
}) {
  const [approveState, approveFormAction, approvePending] = useActionState(approveAction, initialFormActionState);
  const [rejectState, rejectFormAction, rejectPending] = useActionState(rejectAction, initialFormActionState);
  const busy = approvePending || rejectPending;
  return <div className="min-w-64 space-y-3">
    <form action={approveFormAction}><input name="requestId" type="hidden" value={requestId} /><Button disabled={busy} size="sm" type="submit">{approvePending ? "Approving..." : "Approve"}</Button></form>
    <form action={rejectFormAction} className="space-y-2">
      <input name="requestId" type="hidden" value={requestId} />
      <label className="space-y-1 text-xs"><span>Rejection reason</span><Input maxLength={350} minLength={5} name="reason" required /></label>
      <Button disabled={busy} size="sm" type="submit" variant="danger">{rejectPending ? "Rejecting..." : "Reject"}</Button>
    </form>
    <FormFeedback state={approveState.status !== "idle" ? approveState : rejectState} />
  </div>;
}
