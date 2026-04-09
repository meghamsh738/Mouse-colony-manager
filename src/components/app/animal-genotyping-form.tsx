"use client";

import { useActionState, useEffect, useRef } from "react";

import { recordGenotypeAction } from "@/app/animals/[animalId]/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";

type AnimalGenotypingFormProps = {
  animalId: string;
  alleleOptions: Array<{ id: string; label: string }>;
  defaultDate: string;
};

const sourceTypeOptions = ["manual PCR", "external vendor", "qPCR", "sequencing"];
const commonZygosityValues = ["+/-", "+/+", "WT/WT", "flox/+", "flox/flox", "pending"];

export function AnimalGenotypingForm({ animalId, alleleOptions, defaultDate }: AnimalGenotypingFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, formAction, pending] = useActionState(recordGenotypeAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);
  const defaultAlleleId = alleleOptions.find((option) => option.label.includes("CreER"))?.id ?? alleleOptions[0]?.id ?? "";
  const datalistId = `genotype-zygosity-suggestions-${animalId}`;

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.status]);

  if (!alleleOptions.length) {
    return <p className="text-sm text-[var(--muted)]">No alleles are configured yet. Add allele definitions in admin settings first.</p>;
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-4"
      data-testid="genotype-record-form"
      onSubmit={handleSubmit}
    >
      <input name="animalId" type="hidden" value={animalId} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)_minmax(0,0.9fr)]">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Allele or marker</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue={defaultAlleleId}
            name="alleleId"
            data-testid="genotype-record-allele"
          >
            {alleleOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Call status</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue="confirmed"
            name="status"
            data-testid="genotype-record-status"
          >
            <option value="confirmed">Confirmed</option>
            <option value="provisional">Provisional</option>
            <option value="pending">Pending</option>
            <option value="conflict">Conflict</option>
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Zygosity</span>
          <Input
            defaultValue="+/-"
            list={datalistId}
            name="zygosity"
            required
            data-testid="genotype-record-zygosity"
          />
          <datalist id={datalistId}>
            {commonZygosityValues.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Source</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            defaultValue="manual PCR"
            name="sourceType"
            data-testid="genotype-record-source-type"
          >
            {sourceTypeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Assay</span>
          <Input defaultValue="gel PCR" name="assayType" required data-testid="genotype-record-assay-type" />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Confidence</span>
          <Input defaultValue="high" name="confidence" data-testid="genotype-record-confidence" />
        </label>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Sample date</span>
          <Input
            defaultValue={defaultDate}
            name="sampleDate"
            required
            type="date"
            data-testid="genotype-record-sample-date"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Assay date</span>
          <Input
            defaultValue={defaultDate}
            name="resultDate"
            required
            type="date"
            data-testid="genotype-record-result-date"
          />
        </label>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Sample ID</span>
          <Input defaultValue="" name="sampleId" placeholder="PCR-25009" data-testid="genotype-record-sample-id" />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Provider</span>
          <Input defaultValue="" name="provider" placeholder="Transnetyx" data-testid="genotype-record-provider" />
        </label>
      </div>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Result summary</span>
        <textarea
          className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          defaultValue="Expected band present at the correct size."
          name="resultText"
          data-testid="genotype-record-result-text"
        />
      </label>
      <FormFeedback state={state} />
      <div className="border-t border-[var(--line)] pt-4">
        <Button
          className="relative z-10 w-full sm:w-auto"
          disabled={pending}
          type="submit"
          data-testid="genotype-record-submit"
        >
          {pending ? "Saving genotype..." : "Record genotype"}
        </Button>
      </div>
    </form>
  );
}
