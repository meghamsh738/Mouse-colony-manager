"use client";

import { useActionState } from "react";

import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";

type Action = (state: FormActionState | undefined, data: FormData) => Promise<FormActionState>;

export function IdentityActivationForm({ action, defaultName, token }: { action: Action; defaultName: string; token: string }) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const guard = useSubmitGuard(pending);

  return (
    <form action={formAction} className="mt-6 space-y-4" onSubmit={guard}>
      <input name="token" type="hidden" value={token} />
      <label className="block space-y-2 text-sm">
        <span className="font-medium text-[var(--ink)]">Full name</span>
        <Input autoComplete="name" defaultValue={defaultName} maxLength={120} name="name" required />
      </label>
      <label className="block space-y-2 text-sm">
        <span className="font-medium text-[var(--ink)]">Password</span>
        <Input autoComplete="new-password" minLength={12} name="password" required type="password" />
        <span className="block text-xs text-[var(--muted)]">Use at least 12 characters.</span>
      </label>
      <FormFeedback state={state} />
      <Button className="w-full" disabled={pending} type="submit">
        {pending ? "Activating…" : "Activate account"}
      </Button>
    </form>
  );
}
