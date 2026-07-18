"use client";

import { useActionState } from "react";

import { updateCryostorageInventoryAction } from "@/app/cryostorage/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";
import type { CryostorageInventoryItem } from "@/lib/types";

type CryostorageInlineEditFormProps = {
  record: CryostorageInventoryItem;
};

export function CryostorageInlineEditForm({ record }: CryostorageInlineEditFormProps) {
  const [state, formAction, pending] = useActionState(updateCryostorageInventoryAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);

  return (
    <form action={formAction} className="grid min-w-0 gap-3" data-testid={`cryostorage-inline-edit-${record.id}`} onSubmit={handleSubmit}>
      <input type="hidden" name="recordId" value={record.id} />
      <input type="hidden" name="expectedVersion" value={record.version} />
      <div className="worksheet-filter-grid">
        <label>
          <span className="metadata-label">Status</span>
          <select className="worksheet-input" defaultValue={record.status} name="status">
            <option value="stored">Stored</option>
            <option value="reserved">Reserved</option>
            <option value="recovered">Recovered</option>
            <option value="depleted">Depleted</option>
            <option value="discarded">Discarded</option>
          </select>
        </label>
        <label>
          <span className="metadata-label">Storage</span>
          <Input defaultValue={record.storageLocation ?? ""} name="storageLocation" placeholder="LN2 / cane / goblet" />
        </label>
        <label>
          <span className="metadata-label">Quantity</span>
          <Input defaultValue={record.quantityLabel ?? ""} name="quantityLabel" placeholder="6 straws" />
        </label>
      </div>
      <label className="grid gap-2 text-sm">
        <span className="metadata-label">Recovery</span>
        <textarea
          className="min-h-20 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          defaultValue={record.recoveryNotes ?? ""}
          name="recoveryNotes"
          placeholder="Optional recovery note"
        />
      </label>
      <label className="grid gap-2 text-sm">
        <span className="metadata-label">Notes</span>
        <textarea
          className="min-h-20 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          defaultValue={record.notes ?? ""}
          name="notes"
          placeholder="Optional storage note"
        />
      </label>
      <FormFeedback state={state} />
      <Button className="relative z-10 w-full sm:w-auto" disabled={pending} type="submit">
        {pending ? "Saving..." : "Save row"}
      </Button>
    </form>
  );
}
