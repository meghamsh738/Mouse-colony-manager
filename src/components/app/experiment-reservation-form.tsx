"use client";

import { useActionState, useEffect, useRef } from "react";

import { reserveAnimalAction } from "@/app/animals/[animalId]/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";

type ExperimentReservationFormProps = {
  animalId: string;
  experimentOptions: Array<{ id: string; label: string }>;
};

export function ExperimentReservationForm({ animalId, experimentOptions }: ExperimentReservationFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, formAction, pending] = useActionState(reserveAnimalAction, initialFormActionState);
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
      className="space-y-4"
      data-testid="experiment-reservation-form"
      onSubmit={handleSubmit}
    >
      <input name="animalId" type="hidden" value={animalId} />
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Experiment</span>
        <select
          className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
          defaultValue={experimentOptions[0]?.id}
          name="experimentId"
          data-testid="reservation-experiment"
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
          <Input defaultValue="2026-04-08" name="startDate" required type="date" />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Treatment group</span>
          <Input defaultValue="LPS low dose" name="treatmentGroup" />
        </label>
      </div>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Reservation note</span>
        <textarea
          className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          defaultValue="Hold for the next balanced induction block."
          name="notes"
        />
      </label>
      <FormFeedback state={state} />
      <div className="border-t border-[var(--line)] pt-4">
        <Button
          className="relative z-10 w-full sm:w-auto"
          disabled={pending}
          type="submit"
          data-testid="reservation-submit"
        >
          {pending ? "Saving reservation..." : "Reserve animal"}
        </Button>
      </div>
    </form>
  );
}
