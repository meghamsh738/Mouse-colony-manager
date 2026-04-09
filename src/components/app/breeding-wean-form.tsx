"use client";

import { useActionState, useEffect, useRef } from "react";

import { weanLitterAction } from "@/app/breeding/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";

type BreedingWeanFormProps = {
  litterId: string;
  defaultWeanDate: string;
  cageOptions: Array<{ id: string; label: string }>;
  strainOptions: Array<{ id: string; label: string }>;
};

export function BreedingWeanForm({
  litterId,
  defaultWeanDate,
  cageOptions,
  strainOptions,
}: BreedingWeanFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, formAction, pending] = useActionState(weanLitterAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);
  const femaleDefaultCage = cageOptions.find((option) => option.id === "cage-a101-003")?.id ?? cageOptions[0]?.id ?? "";
  const maleDefaultCage = cageOptions.find((option) => option.id === "cage-a101-002")?.id ?? cageOptions[0]?.id ?? "";

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
      data-testid={`wean-create-form-${litterId}`}
      onSubmit={handleSubmit}
    >
      <input name="litterId" type="hidden" value={litterId} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,10rem)_minmax(0,11rem)_minmax(0,11rem)]">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Wean date</span>
          <Input
            defaultValue={defaultWeanDate}
            name="weanDate"
            required
            type="date"
            data-testid="wean-create-date"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Female pups</span>
          <Input
            defaultValue="2"
            min={0}
            max={24}
            name="femaleCount"
            required
            type="number"
            data-testid="wean-create-female-count"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Male pups</span>
          <Input
            defaultValue="3"
            min={0}
            max={24}
            name="maleCount"
            required
            type="number"
            data-testid="wean-create-male-count"
          />
        </label>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Progeny strain</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue={strainOptions.find((option) => option.id === "strain-creer-tdt")?.id ?? strainOptions[0]?.id}
            name="strainId"
            data-testid="wean-create-strain"
          >
            {strainOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Female cage</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue={femaleDefaultCage}
            name="femaleCageId"
            data-testid="wean-create-female-cage"
          >
            {cageOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Male cage</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue={maleDefaultCage}
            name="maleCageId"
            data-testid="wean-create-male-cage"
          >
            {cageOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <FormFeedback state={state} />
      <div className="flex justify-end pt-1">
        <Button className="w-full sm:w-auto" disabled={pending} type="submit" data-testid="wean-create-submit">
          {pending ? "Saving weaning..." : "Wean and assign pups"}
        </Button>
      </div>
    </form>
  );
}
