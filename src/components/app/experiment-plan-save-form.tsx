"use client";

import { useActionState } from "react";

import { planExperimentCohortAction } from "@/app/experiments/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ExperimentPlannerFilters } from "@/lib/types";
import { initialFormActionState } from "@/lib/form-state";

type Option = {
  id: string;
  label: string;
};

type ExperimentPlanSaveFormProps = {
  experimentOptions: Option[];
  filters: ExperimentPlannerFilters;
};

export function ExperimentPlanSaveForm({ experimentOptions, filters }: ExperimentPlanSaveFormProps) {
  const [state, formAction, pending] = useActionState(planExperimentCohortAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);

  return (
    <form className="space-y-4" action={formAction} data-testid="experiment-plan-save-form" onSubmit={handleSubmit}>
      <input type="hidden" name="desiredNumber" value={String(filters.desiredNumber)} />
      <input type="hidden" name="sex" value={filters.desiredSex} />
      <input type="hidden" name="minAgeDays" value={String(filters.minAgeDays)} />
      <input type="hidden" name="maxAgeDays" value={String(filters.maxAgeDays)} />
      <input type="hidden" name="genotypeKeyword" value={filters.genotypeKeyword} />
      <input type="hidden" name="strainId" value={filters.strainId ?? ""} />
      <input type="hidden" name="projectId" value={filters.projectId ?? ""} />
      <input type="hidden" name="includeReserved" value={String(filters.includeReserved)} />
      <input type="hidden" name="allowOverlap" value={String(filters.allowOverlap)} />
      <input type="hidden" name="balanceByCage" value={String(filters.balanceByCage)} />
      <input type="hidden" name="avoidSiblingClustering" value={String(filters.avoidSiblingClustering)} />
      <input type="hidden" name="groupCount" value={String(filters.groupCount)} />
      <input type="hidden" name="randomSeed" value={filters.randomSeed} />
      <input type="hidden" name="blockBySex" value={String(filters.blockBySex)} />
      <input type="hidden" name="blockBySiblingGroup" value={String(filters.blockBySiblingGroup)} />
      <input type="hidden" name="balanceByAge" value={String(filters.balanceByAge)} />
      <input type="hidden" name="maxSameCagePerGroup" value={String(filters.maxSameCagePerGroup)} />

      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Target experiment</span>
        <select
          className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
          name="experimentId"
          defaultValue={experimentOptions[0]?.id ?? ""}
          data-testid="planner-save-experiment"
        >
          {experimentOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Planned start</span>
          <Input name="startDate" type="date" defaultValue="2026-04-15" data-testid="planner-save-start-date" required />
        </label>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--ink)]">
          <span className="text-[var(--muted)]">Planner snapshot</span>
          <p className="mt-1 font-medium">
            {filters.desiredNumber} selected target · {filters.groupCount} groups · seed {filters.randomSeed}
          </p>
        </div>
      </div>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Planning note</span>
        <textarea
          className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          name="notes"
          placeholder="Saved from the distribution helper with seeded treatment-group randomization."
          data-testid="planner-save-notes"
        />
      </label>
      <FormFeedback state={state} />
      <div className="border-t border-[var(--line)] pt-4">
        <Button className="relative z-10 w-full sm:w-auto" disabled={pending} type="submit" data-testid="planner-save-submit">
          {pending ? "Saving cohort..." : "Save cohort plan"}
        </Button>
      </div>
    </form>
  );
}
