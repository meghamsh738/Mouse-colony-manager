"use client";

import { useActionState } from "react";

import { demoteReservedCohortAction } from "@/app/experiments/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { initialFormActionState } from "@/lib/form-state";

type ExperimentPlanDemoteFormProps = {
  experimentId: string;
  reservedCount: number;
};

export function ExperimentPlanDemoteForm({ experimentId, reservedCount }: ExperimentPlanDemoteFormProps) {
  const [state, formAction, pending] = useActionState(demoteReservedCohortAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);

  return (
    <form action={formAction} className="space-y-3" data-testid={`experiment-demote-form-${experimentId}`} onSubmit={handleSubmit}>
      <input type="hidden" name="experimentId" value={experimentId} />
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--ink)]">
        <span className="text-[var(--muted)]">Reserved cohort assignments</span>
        <p className="mt-1 font-medium">{reservedCount} can be returned to planned</p>
      </div>
      <FormFeedback state={state} />
      <Button className="relative z-10 w-full sm:w-auto" disabled={pending} type="submit" variant="subtle" data-testid={`experiment-demote-submit-${experimentId}`}>
        {pending ? "Rolling back cohort..." : "Return reserved cohort to planned"}
      </Button>
    </form>
  );
}
