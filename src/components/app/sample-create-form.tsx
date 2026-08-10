"use client";

import { useActionState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";

import { recordSampleAction } from "@/app/samples/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";

type Option = {
  id: string;
  label: string;
};

type SampleCreateFormProps = {
  animalOptions: Option[];
  projectOptions: Option[];
  experimentOptions: Option[];
  defaultAnimalId?: string;
  animalSelectDisabled?: boolean;
  defaultCollectedAt: string;
  defaultProjectId?: string | null;
  defaultExperimentId?: string | null;
};

const statusOptions = [
  { value: "stored", label: "Stored" },
  { value: "collected", label: "Collected" },
  { value: "allocated", label: "Allocated" },
  { value: "consumed", label: "Consumed" },
  { value: "discarded", label: "Discarded" },
] as const;

export function SampleCreateForm({
  animalOptions,
  projectOptions,
  experimentOptions,
  defaultAnimalId,
  animalSelectDisabled = false,
  defaultCollectedAt,
  defaultProjectId,
  defaultExperimentId,
}: SampleCreateFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, formAction, pending] = useActionState(recordSampleAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);
  const selectedAnimalLabel = useMemo(
    () => animalOptions.find((option) => option.id === defaultAnimalId)?.label ?? "Animal record",
    [animalOptions, defaultAnimalId],
  );

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      router.refresh();
    }
  }, [router, state.status]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4" data-testid="sample-record-form" onSubmit={handleSubmit}>
      {animalSelectDisabled && defaultAnimalId ? (
        <>
          <input name="animalId" type="hidden" value={defaultAnimalId} />
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--ink)]">
            <span className="text-[var(--muted)]">Animal</span>
            <p className="mt-1 font-medium">{selectedAnimalLabel}</p>
          </div>
        </>
      ) : (
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Animal</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue={defaultAnimalId ?? animalOptions[0]?.id ?? ""}
            name="animalId"
            data-testid="sample-record-animal"
          >
            {animalOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Sample label</span>
          <Input name="sampleLabel" placeholder="DNA-26004-B" required data-testid="sample-record-label" />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Sample type</span>
          <Input name="sampleType" placeholder="Tail DNA" required data-testid="sample-record-type" />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Status</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue="stored"
            name="status"
            data-testid="sample-record-status"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Collected at</span>
          <Input
            defaultValue={defaultCollectedAt}
            name="collectedAt"
            required
            type="date"
            data-testid="sample-record-collected-at"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Project</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue={defaultProjectId ?? ""}
            name="projectId"
            data-testid="sample-record-project"
          >
            <option value="">No project linked</option>
            {projectOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Experiment</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue={defaultExperimentId ?? ""}
            name="experimentId"
            data-testid="sample-record-experiment"
          >
            <option value="">No experiment linked</option>
            {experimentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Storage location</span>
          <Input
            name="storageLocation"
            placeholder="Freezer 2 / Box D / D04"
            data-testid="sample-record-storage"
          />
        </label>
        <label className="space-y-2 text-sm md:col-span-2">
          <span className="text-[var(--muted)]">Quantity or units</span>
          <Input name="quantityLabel" placeholder="1 x 40 uL" data-testid="sample-record-quantity" />
        </label>
      </div>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Notes</span>
        <textarea
          className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          name="notes"
          placeholder="Reserved for histology and backup genotyping."
          data-testid="sample-record-notes"
        />
      </label>
      <FormFeedback state={state} />
      <div className="border-t border-[var(--line)] pt-4">
        <Button className="relative z-10 w-full sm:w-auto" disabled={pending} type="submit" data-testid="sample-record-submit">
          {pending ? "Saving sample..." : "Record sample"}
        </Button>
      </div>
    </form>
  );
}
