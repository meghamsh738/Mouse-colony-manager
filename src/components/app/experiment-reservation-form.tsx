"use client";

import { useActionState, useState } from "react";

import { reserveAnimalAction } from "@/app/animals/[animalId]/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";

type ExperimentReservationFormProps = {
  animalId: string;
  animalVersion: number;
  commandNonce: string;
  defaultDate: string;
  experimentOptions: Array<{ id: string; label: string; version: number }>;
};

export function ExperimentReservationForm({
  animalId,
  animalVersion,
  commandNonce,
  defaultDate,
  experimentOptions,
}: ExperimentReservationFormProps) {
  const [state, formAction, pending] = useActionState(reserveAnimalAction, initialFormActionState);
  const [experimentId, setExperimentId] = useState(experimentOptions[0]?.id ?? "");
  const [startDate, setStartDate] = useState(defaultDate);
  const [treatmentGroup, setTreatmentGroup] = useState("");
  const [notes, setNotes] = useState("");
  const handleSubmit = useSubmitGuard(pending);
  const expectedExperimentVersion = experimentOptions.find((option) => option.id === experimentId)?.version ?? 0;
  const commandIdentity = JSON.stringify({
    commandNonce,
    animalId,
    animalVersion,
    experimentId,
    expectedExperimentVersion,
    startDate,
    treatmentGroup,
    notes,
  });

  return (
    <form
      action={formAction}
      className="space-y-4"
      data-testid="experiment-reservation-form"
      onSubmit={handleSubmit}
    >
      <input name="animalId" type="hidden" value={animalId} />
      <input name="expectedAnimalVersion" type="hidden" value={animalVersion} />
      <input name="expectedExperimentVersion" type="hidden" value={expectedExperimentVersion} />
      <input name="idempotencyKey" type="hidden" value={commandIdentity} />
      <input name="requestId" type="hidden" value={commandIdentity} />
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Experiment</span>
        <select
          className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
          name="experimentId"
          data-testid="reservation-experiment"
          value={experimentId}
          onChange={(event) => setExperimentId(event.target.value)}
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
          <Input name="startDate" required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Treatment group</span>
          <Input maxLength={80} name="treatmentGroup" value={treatmentGroup} onChange={(event) => setTreatmentGroup(event.target.value)} />
        </label>
      </div>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Reservation note</span>
        <textarea
          className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          maxLength={400}
          name="notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <FormFeedback state={state} />
      <div className="border-t border-[var(--line)] pt-4">
        <Button
          className="relative z-10 w-full sm:w-auto"
          disabled={pending || !experimentId || expectedExperimentVersion < 1}
          type="submit"
          data-testid="reservation-submit"
        >
          {pending ? "Saving reservation..." : "Reserve animal"}
        </Button>
      </div>
    </form>
  );
}
