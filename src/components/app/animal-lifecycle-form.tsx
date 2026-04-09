"use client";

import { useActionState, useEffect, useRef } from "react";

import { updateAnimalLifecycleAction } from "@/app/animals/[animalId]/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";

type AnimalLifecycleFormProps = {
  animalId: string;
  allowedActions: Array<{ value: "euthanized" | "dead" | "transferred_out" | "archived"; label: string }>;
  defaultDate: string;
};

const defaultReasons: Record<AnimalLifecycleFormProps["allowedActions"][number]["value"], string> = {
  euthanized: "Terminal tissue collection completed.",
  dead: "Found dead during routine welfare round.",
  transferred_out: "Transferred to an external holding or collaborating facility.",
  archived: "Archived after terminal disposition review.",
};

export function AnimalLifecycleForm({ animalId, allowedActions, defaultDate }: AnimalLifecycleFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, formAction, pending] = useActionState(updateAnimalLifecycleAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);
  const defaultAction = allowedActions[0]?.value ?? "euthanized";

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.status]);

  if (!allowedActions.length) {
    return <p className="text-sm text-[var(--muted)]">This animal is already archived and cannot move to another lifecycle state.</p>;
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-4"
      data-testid="animal-lifecycle-form"
      onSubmit={handleSubmit}
    >
      <input name="animalId" type="hidden" value={animalId} />
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Lifecycle action</span>
        <select
          className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
          defaultValue={defaultAction}
          name="targetStatus"
          data-testid="animal-lifecycle-target"
        >
          {allowedActions.map((action) => (
            <option key={action.value} value={action.value}>
              {action.label}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Lifecycle date</span>
        <Input defaultValue={defaultDate} name="happenedAt" required type="date" data-testid="animal-lifecycle-date" />
      </label>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Reason</span>
        <textarea
          className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          defaultValue={defaultReasons[defaultAction]}
          name="reason"
          data-testid="animal-lifecycle-reason"
        />
      </label>
      <FormFeedback state={state} />
      <div className="border-t border-[var(--line)] pt-4">
        <Button
          className="relative z-10 w-full sm:w-auto"
          disabled={pending}
          type="submit"
          data-testid="animal-lifecycle-submit"
        >
          {pending ? "Saving lifecycle..." : "Save lifecycle change"}
        </Button>
      </div>
    </form>
  );
}
