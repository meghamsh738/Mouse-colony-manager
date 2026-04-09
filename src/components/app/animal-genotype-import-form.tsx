"use client";

import { useActionState, useEffect, useRef } from "react";

import { importGenotypeCsvAction } from "@/app/animals/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { initialFormActionState } from "@/lib/form-state";

const sampleHeaders = "subject_id,marker,call,status,source,assay,sample_date,result_date,result_text,provider,confidence,sample_id";
const sampleRow =
  "CM-25009,CreER,+/-,confirmed,manual PCR,gel PCR,2026-04-09,2026-04-09,Expected band present,Transnetyx,high,PCR-25009";

export function AnimalGenotypeImportForm() {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, formAction, pending] = useActionState(importGenotypeCsvAction, initialFormActionState);
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
      data-testid="genotype-import-form"
      onSubmit={handleSubmit}
    >
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">CSV upload</span>
        <input
          accept=".csv,text/csv"
          className="block h-auto w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] file:mr-4 file:rounded-full file:border-0 file:bg-[var(--surface-2)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--ink)] focus:border-[var(--line-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          data-testid="genotype-import-file"
          name="file"
          type="file"
        />
      </label>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Paste rows instead</span>
        <textarea
          className="min-h-28 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 font-mono text-sm text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)]"
          data-testid="genotype-import-text"
          name="csvText"
          placeholder={`${sampleHeaders}\n${sampleRow}`}
        />
      </label>
      <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-2)] p-4">
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Accepted headers</p>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Use either generic fields such as <code>animal_id</code>, <code>allele</code>, and <code>zygosity</code> or
          vendor-style fields such as <code>subject_id</code>, <code>marker</code>, and <code>call</code>.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-2xl border border-[var(--line)] bg-white/70 p-3 text-xs text-[var(--ink)]">
          {sampleHeaders}
          {"\n"}
          {sampleRow}
        </pre>
      </div>
      <FormFeedback state={state} />
      <div className="border-t border-[var(--line)] pt-4">
        <Button
          className="relative z-10 w-full sm:w-auto"
          disabled={pending}
          type="submit"
          data-testid="genotype-import-submit"
        >
          {pending ? "Importing genotype rows..." : "Import genotype CSV"}
        </Button>
      </div>
    </form>
  );
}
