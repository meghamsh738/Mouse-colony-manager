"use client";

import { useActionState } from "react";

import { updateSampleInventoryAction } from "@/app/samples/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";
import type { SampleInventoryItem } from "@/lib/types";

type SampleInlineEditFormProps = {
  sample: SampleInventoryItem;
  experimentOptions: Array<{ id: string; label: string }>;
};

export function SampleInlineEditForm({ sample, experimentOptions }: SampleInlineEditFormProps) {
  const [state, formAction, pending] = useActionState(updateSampleInventoryAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);

  return (
    <form action={formAction} className="grid min-w-0 gap-3" data-testid={`sample-inline-edit-${sample.id}`} onSubmit={handleSubmit}>
      <input type="hidden" name="sampleId" value={sample.id} />
      <input type="hidden" name="expectedVersion" value={sample.version} />
      <div className="worksheet-filter-grid">
        <label>
          <span className="metadata-label">Status</span>
          <select className="worksheet-input" defaultValue={sample.status} name="status">
            <option value="collected">Collected</option>
            <option value="stored">Stored</option>
            <option value="allocated">Allocated</option>
            <option value="consumed">Consumed</option>
            <option value="discarded">Discarded</option>
          </select>
        </label>
        <label>
          <span className="metadata-label">Storage</span>
          <Input defaultValue={sample.storageLocation ?? ""} name="storageLocation" placeholder="Freezer / box / slot" />
        </label>
        <label>
          <span className="metadata-label">Quantity</span>
          <Input defaultValue={sample.quantityLabel ?? ""} name="quantityLabel" placeholder="1 x 40 uL" />
        </label>
        <label>
          <span className="metadata-label">Experiment</span>
          <select className="worksheet-input" defaultValue={sample.experimentId ?? ""} name="experimentId">
            <option value="">No experiment linked</option>
            {experimentOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-2 text-sm">
        <span className="metadata-label">Notes</span>
        <textarea
          className="min-h-20 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          defaultValue={sample.notes ?? ""}
          name="notes"
          placeholder="Optional sample note"
        />
      </label>
      <FormFeedback state={state} />
      <Button className="relative z-10 w-full sm:w-auto" disabled={pending} type="submit">
        {pending ? "Saving..." : "Save row"}
      </Button>
    </form>
  );
}
