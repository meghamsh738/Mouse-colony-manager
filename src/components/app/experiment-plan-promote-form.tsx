"use client";

import { useActionState } from "react";

import { promotePlannedCohortAction } from "@/app/experiments/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { initialFormActionState } from "@/lib/form-state";

type ExperimentPlanPromoteFormProps = {
  experimentId: string;
  plannedCount: number;
};

export function ExperimentPlanPromoteForm({ experimentId, plannedCount }: ExperimentPlanPromoteFormProps) {
  const [state, formAction, pending] = useActionState(promotePlannedCohortAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);

  return (
    <form action={formAction} className="space-y-3" data-testid={`experiment-promote-form-${experimentId}`} onSubmit={handleSubmit}>
      <input type="hidden" name="experimentId" value={experimentId} />
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--ink)]">
        <span className="text-[var(--muted)]">Queued planned assignments</span>
        <p className="mt-1 font-medium">{plannedCount} waiting to promote</p>
      </div>
      <FormFeedback state={state} />
      <Button className="relative z-10 w-full sm:w-auto" disabled={pending} type="submit" data-testid={`experiment-promote-submit-${experimentId}`}>
        {pending ? "Promoting cohort..." : "Promote planned cohort"}
      </Button>
    </form>
  );
}
