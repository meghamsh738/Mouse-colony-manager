"use client";

import { useActionState, useEffect, useRef } from "react";

import { recordLitterAction } from "@/app/breeding/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";

type BreedingLitterFormProps = {
  breedingSetupId: string;
  defaultBirthDate: string;
};

export function BreedingLitterForm({ breedingSetupId, defaultBirthDate }: BreedingLitterFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, formAction, pending] = useActionState(recordLitterAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.status]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-3"
      data-testid={`litter-create-form-${breedingSetupId}`}
      onSubmit={handleSubmit}
    >
      <input name="breedingSetupId" type="hidden" value={breedingSetupId} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,11rem)_minmax(0,9rem)_minmax(0,1fr)]">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Birth date</span>
          <Input
            defaultValue={defaultBirthDate}
            name="birthDate"
            required
            type="date"
            data-testid="litter-create-birth-date"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Pups at birth</span>
          <Input
            defaultValue="6"
            min={1}
            max={24}
            name="litterSizeBirth"
            required
            type="number"
            data-testid="litter-create-size"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Notes</span>
          <Input
            defaultValue="Observed during breeding room round."
            name="notes"
            data-testid="litter-create-notes"
          />
        </label>
      </div>
      <FormFeedback state={state} />
      <div className="flex justify-end pt-1">
        <Button className="w-full sm:w-auto" disabled={pending} type="submit" data-testid="litter-create-submit">
          {pending ? "Saving litter..." : "Save litter"}
        </Button>
      </div>
    </form>
  );
}
