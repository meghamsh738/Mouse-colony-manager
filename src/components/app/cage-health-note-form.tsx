"use client";

import { useActionState, useEffect, useRef } from "react";

import { addCageHealthNoteAction } from "@/app/scan/[barcode]/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";

type CageHealthNoteFormProps = {
  barcode: string;
  cageId: string;
};

export function CageHealthNoteForm({ barcode, cageId }: CageHealthNoteFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const action = addCageHealthNoteAction.bind(null, barcode);
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.status]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4" data-testid="cage-health-note-form" onSubmit={handleSubmit}>
      <input name="cageId" type="hidden" value={cageId} />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Note type</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue="routine_welfare"
            name="noteType"
            data-testid="health-note-type"
          >
            <option value="routine_welfare">Routine welfare</option>
            <option value="adverse_effect">Adverse effect</option>
            <option value="veterinary_concern">Veterinary concern</option>
            <option value="breeding_concern">Breeding concern</option>
            <option value="grooming_issue">Grooming issue</option>
            <option value="aggression">Aggression</option>
            <option value="post_procedure_monitoring">Post-procedure monitoring</option>
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Severity</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue="warning"
            name="severity"
            data-testid="health-note-severity"
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </label>
      </div>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Observed note</span>
        <textarea
          className="min-h-28 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          defaultValue="Wet bedding noted during morning room round."
          name="note"
          required
          data-testid="health-note-text"
        />
      </label>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Action taken</span>
        <Input defaultValue="Flagged for cage change after scan review." name="actionTaken" />
      </label>
      <label className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
        <input defaultChecked name="followupRequired" type="checkbox" data-testid="health-note-followup" />
        Follow-up required
      </label>
      <FormFeedback state={state} />
      <div className="border-t border-[var(--line)] pt-4">
        <Button
          className="relative z-10 w-full sm:w-auto"
          disabled={pending}
          type="submit"
          data-testid="health-note-submit"
        >
          {pending ? "Saving note..." : "Save health note"}
        </Button>
      </div>
    </form>
  );
}
