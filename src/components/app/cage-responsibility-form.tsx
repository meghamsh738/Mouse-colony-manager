"use client";

import { Save, UserRoundCheck } from "lucide-react";
import { useActionState } from "react";

import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";

type ServerAction = (state: FormActionState | undefined, formData: FormData) => Promise<FormActionState>;

type ResponsibilityUser = {
  userId: string;
  name: string;
  email: string;
  membershipRole: string;
};

export function CageResponsibilityForm({
  action,
  cage,
  assignments,
  options,
  nonce,
}: {
  action: ServerAction;
  cage: { id: string; labId: string | null; barcode: string; version: number };
  assignments: Array<ResponsibilityUser & { assignedAt: string; reason: string; active: boolean }>;
  options: ResponsibilityUser[];
  nonce: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);
  const assignedUserIds = new Set(assignments.map((assignment) => assignment.userId));

  if (!cage.labId) {
    return <p className="text-sm text-[var(--muted)]">Assign the cage to a lab before adding responsible users.</p>;
  }

  return (
    <form action={formAction} className="space-y-4" onSubmit={handleSubmit}>
      <input name="cageId" type="hidden" value={cage.id} />
      <input name="labId" type="hidden" value={cage.labId} />
      <input name="barcode" type="hidden" value={cage.barcode} />
      <input name="expectedVersion" type="hidden" value={cage.version} />
      <input name="idempotencyKey" type="hidden" value={`${nonce}:cage-responsibility:${cage.id}:${cage.version}`} />
      <input name="requestId" type="hidden" value={`${nonce}:responsibility-request`} />

      {assignments.length ? (
        <div className="flex flex-wrap gap-2" aria-label="Current responsible users">
          {assignments.map((assignment) => (
            <span className="value-chip" key={assignment.userId}>
              <UserRoundCheck aria-hidden="true" size={14} />
              {assignment.name}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">No responsible user is assigned.</p>
      )}

      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium text-[var(--ink)]">Responsible lab members</legend>
        {options.map((option) => (
          <label
            className="flex min-h-11 min-w-0 items-center gap-3 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm"
            key={option.userId}
          >
            <input
              className="h-5 w-5 shrink-0 accent-[var(--accent)]"
              defaultChecked={assignedUserIds.has(option.userId)}
              name="responsibleUserId"
              type="checkbox"
              value={option.userId}
            />
            <span className="min-w-0">
              <span className="wrap-value block font-medium text-[var(--ink)]">{option.name}</span>
              <span className="wrap-value block text-xs text-[var(--muted)]">{option.email} · {option.membershipRole}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {!options.length ? <p className="text-sm text-amber-800">This lab has no active owner, manager, or staff member to assign.</p> : null}

      <label className="block space-y-2 text-sm">
        <span className="text-[var(--muted)]">Reason</span>
        <Input defaultValue="Routine cage responsibility update" maxLength={500} minLength={3} name="reason" required />
      </label>
      <FormFeedback state={state} />
      <Button disabled={pending} type="submit">
        <Save aria-hidden="true" size={16} />
        {pending ? "Saving..." : "Save responsibility"}
      </Button>
    </form>
  );
}
