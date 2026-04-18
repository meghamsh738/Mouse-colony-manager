"use client";

import { useActionState, useEffect, useRef } from "react";

import { recordCryostorageAction } from "@/app/cryostorage/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";

type Option = {
  id: string;
  label: string;
};

type CryostorageCreateFormProps = {
  strainOptions: Option[];
  projectOptions: Option[];
  defaultStoredAt: string;
};

const statusOptions = [
  { value: "stored", label: "Stored" },
  { value: "reserved", label: "Reserved" },
  { value: "recovered", label: "Recovered" },
  { value: "depleted", label: "Depleted" },
  { value: "discarded", label: "Discarded" },
] as const;

export function CryostorageCreateForm({
  strainOptions,
  projectOptions,
  defaultStoredAt,
}: CryostorageCreateFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, formAction, pending] = useActionState(recordCryostorageAction, initialFormActionState);
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
      data-testid="cryostorage-record-form"
      onSubmit={handleSubmit}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Strain</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue={strainOptions[0]?.id ?? ""}
            name="strainId"
            data-testid="cryostorage-record-strain"
          >
            {strainOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Project</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue=""
            name="projectId"
            data-testid="cryostorage-record-project"
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
          <span className="text-[var(--muted)]">Cryostorage label</span>
          <Input
            name="sampleLabel"
            placeholder="CRYO-CREER-2026-03"
            required
            data-testid="cryostorage-record-label"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Material type</span>
          <Input
            name="materialType"
            placeholder="Frozen sperm"
            required
            data-testid="cryostorage-record-material"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Status</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue="stored"
            name="status"
            data-testid="cryostorage-record-status"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Stored at</span>
          <Input
            defaultValue={defaultStoredAt}
            name="storedAt"
            required
            type="date"
            data-testid="cryostorage-record-stored-at"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Storage location</span>
          <Input
            name="storageLocation"
            placeholder="LN2 Tank A / Cane 3 / Goblet 2"
            data-testid="cryostorage-record-location"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Quantity or units</span>
          <Input name="quantityLabel" placeholder="6 straws" data-testid="cryostorage-record-quantity" />
        </label>
      </div>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Recovery notes</span>
        <textarea
          className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          name="recoveryNotes"
          placeholder="Recovery planned for the next line-refresh cycle."
          data-testid="cryostorage-record-recovery-notes"
        />
      </label>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Notes</span>
        <textarea
          className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          name="notes"
          placeholder="Keep as a backup line while the live breeders remain active."
          data-testid="cryostorage-record-notes"
        />
      </label>
      <FormFeedback state={state} />
      <div className="border-t border-[var(--line)] pt-4">
        <Button
          className="relative z-10 w-full sm:w-auto"
          disabled={pending}
          type="submit"
          data-testid="cryostorage-record-submit"
        >
          {pending ? "Saving cryostorage record..." : "Record cryostorage item"}
        </Button>
      </div>
    </form>
  );
}
