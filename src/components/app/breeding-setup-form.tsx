"use client";

import { useActionState, useEffect, useRef } from "react";

import { createBreedingAction } from "@/app/breeding/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";

type BreedingSetupFormProps = {
  sireOptions: Array<{ id: string; label: string }>;
  damOptions: Array<{ id: string; label: string }>;
  allowOverride: boolean;
};

export function BreedingSetupForm({ sireOptions, damOptions, allowOverride }: BreedingSetupFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, formAction, pending] = useActionState(createBreedingAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.status]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4" data-testid="breeding-create-form" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Sire</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue=""
            name="sireId"
            required
            data-testid="breeding-create-sire"
          >
            <option value="">Choose sire</option>
            {sireOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Dam</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue=""
            name="damId"
            required
            data-testid="breeding-create-dam"
          >
            <option value="">Choose dam</option>
            {damOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Start date</span>
          <Input defaultValue="2026-04-08" name="startDate" required type="date" />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Target sex</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue="unknown"
            name="targetSex"
          >
            <option value="unknown">Either</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </label>
      </div>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Target genotype</span>
        <Input
          defaultValue="CreER ; tdTomato"
          name="targetGenotype"
          required
          data-testid="breeding-create-target-genotype"
        />
      </label>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Notes</span>
        <textarea
          className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          defaultValue="Pair entered into breeding from the planner workspace."
          name="notes"
        />
      </label>
      {allowOverride ? (
        <label
          className="relative isolate z-10 mt-2 flex scroll-mt-28 items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm"
          data-testid="breeding-create-override-row"
        >
          <input
            className="relative z-10 mt-0.5 h-6 w-6 shrink-0 rounded border-[var(--line)]"
            name="allowOverride"
            type="checkbox"
            data-testid="breeding-create-override"
          />
          <span className="leading-6 text-[var(--muted)]">
            Allow admin override for breeders that are already marked in another active setup. Critical age checks still block creation.
          </span>
        </label>
      ) : null}
      <FormFeedback state={state} />
      <div className="border-t border-[var(--line)] pt-4">
        <Button className="w-full sm:w-auto" disabled={pending} type="submit" data-testid="breeding-create-submit">
          {pending ? "Creating setup..." : "Start breeding"}
        </Button>
      </div>
    </form>
  );
}
