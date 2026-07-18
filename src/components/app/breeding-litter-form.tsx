"use client";

import { useActionState, useState } from "react";

import { recordLitterAction } from "@/app/breeding/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";

type BreedingLitterFormProps = {
  breedingSetupId: string;
  breedingSetupVersion: number;
  defaultBirthDate: string;
};

export function BreedingLitterForm({ breedingSetupId, breedingSetupVersion, defaultBirthDate }: BreedingLitterFormProps) {
  const [state, formAction, pending] = useActionState(recordLitterAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);
  const [birthDate, setBirthDate] = useState(defaultBirthDate);
  const [litterSizeBirth, setLitterSizeBirth] = useState("6");
  const [notes, setNotes] = useState("Observed during breeding room round.");
  const commandKey = ["record-litter", breedingSetupId, breedingSetupVersion, birthDate, litterSizeBirth, notes].join(":");

  return (
    <form
      action={formAction}
      className="space-y-3"
      data-testid={`litter-create-form-${breedingSetupId}`}
      onSubmit={handleSubmit}
    >
      <input name="breedingSetupId" type="hidden" value={breedingSetupId} />
      <input name="expectedVersion" type="hidden" value={breedingSetupVersion} />
      <input name="idempotencyKey" type="hidden" value={commandKey} />
      <input name="requestId" type="hidden" value={commandKey} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,11rem)_minmax(0,9rem)_minmax(0,1fr)]">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Birth date</span>
          <Input
            max={defaultBirthDate}
            name="birthDate"
            required
            type="date"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
            data-testid="litter-create-birth-date"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Pups at birth</span>
          <Input
            min={1}
            max={24}
            name="litterSizeBirth"
            required
            type="number"
            value={litterSizeBirth}
            onChange={(event) => setLitterSizeBirth(event.target.value)}
            data-testid="litter-create-size"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Notes</span>
          <Input
            name="notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
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
