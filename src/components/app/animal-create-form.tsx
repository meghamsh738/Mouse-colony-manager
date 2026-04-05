"use client";

import { useActionState, useEffect, useRef } from "react";

import { createAnimalAction } from "@/app/animals/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";

type AnimalCreateFormProps = {
  cageOptions: Array<{ id: string; label: string }>;
  projectOptions: Array<{ id: string; label: string }>;
  strainOptions: Array<{ id: string; label: string }>;
};

export function AnimalCreateForm({ cageOptions, projectOptions, strainOptions }: AnimalCreateFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, formAction, pending] = useActionState(createAnimalAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.status]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4" data-testid="animal-create-form" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Animal ID</span>
          <Input name="animalId" placeholder="CM-26021" required data-testid="animal-create-id" />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Lab ID</span>
          <Input name="labId" placeholder="MC-2026-021" required data-testid="animal-create-lab-id" />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Sex</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue="female"
            name="sex"
          >
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Date of birth</span>
          <Input defaultValue="2026-03-12" name="dob" required type="date" />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Strain</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue={strainOptions[0]?.id}
            name="strainId"
          >
            {strainOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Cage</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue={cageOptions[0]?.id}
            name="cageId"
          >
            {cageOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm md:col-span-2">
          <span className="text-[var(--muted)]">Project attribution</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue=""
            name="projectId"
          >
            <option value="">None yet</option>
            {projectOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Notes</span>
        <textarea
          className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          name="notes"
          placeholder="Weaned into holding after litter split."
        />
      </label>
      <FormFeedback state={state} />
      <div className="border-t border-[var(--line)] pt-4">
        <Button
          className="relative z-10 w-full sm:w-auto"
          disabled={pending}
          type="submit"
          data-testid="animal-create-submit"
        >
          {pending ? "Saving animal..." : "Add animal"}
        </Button>
      </div>
    </form>
  );
}
