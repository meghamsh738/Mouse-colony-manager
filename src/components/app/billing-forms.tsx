"use client";

import { useActionState, useEffect, useState } from "react";

import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { WorkflowImpact, WorkflowSteps } from "@/components/app/workflow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";

type ServerFormAction = (state: FormActionState | undefined, formData: FormData) => Promise<FormActionState>;

type InvoiceGenerateFormProps = {
  action: ServerFormAction;
  labs: Array<{ id: string; name: string; code: string }>;
};

type RateFormProps = {
  action: ServerFormAction;
  category?: {
    id: string;
    name: string;
    code: string;
    dailyRateCents: number;
    currencyCode: string;
    active: boolean;
    notes?: string;
    version: number;
  };
};

type InvoiceActionFormsProps = {
  invoiceId: string;
  invoiceNumber: string;
  labId: string;
  labName: string;
  totalLabel: string;
  expectedVersion: number;
  status: string;
  adjustmentAction: ServerFormAction;
  finalizeAction: ServerFormAction;
  voidAction: ServerFormAction;
  mode?: "all" | "adjustment" | "finalize" | "void";
};

function useCommandIdentity(prefix: string, state: FormActionState) {
  const [identity, setIdentity] = useState(() => `${prefix}:${crypto.randomUUID()}`);
  useEffect(() => {
    if (state.status !== "success") return;
    const refresh = window.setTimeout(() => setIdentity(`${prefix}:${crypto.randomUUID()}`), 0);
    return () => window.clearTimeout(refresh);
  }, [prefix, state]);
  return identity;
}

function CommandIdentityFields({ identity }: { identity: string }) {
  return (
    <>
      <input name="idempotencyKey" type="hidden" value={identity} />
      <input name="requestId" type="hidden" value={`${identity}:request`} />
    </>
  );
}

export function InvoiceGenerateForm({ action, labs }: InvoiceGenerateFormProps) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const commandIdentity = useCommandIdentity("billing-generate", state);
  const handleSubmit = useSubmitGuard(pending);

  return (
    <form action={formAction} className="space-y-4 md:max-w-4xl" data-testid="generate-invoice-form" onSubmit={handleSubmit}>
      <CommandIdentityFields identity={commandIdentity} />
      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Lab</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            name="labId"
            required
          >
            <option value="">Choose lab</option>
            {labs.map((lab) => (
              <option key={lab.id} value={lab.id}>
                {lab.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Start</span>
          <Input name="periodStart" required type="date" />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">End</span>
          <Input name="periodEnd" required type="date" />
        </label>
      </div>
      <FormFeedback state={state} />
      <p className="text-sm text-[var(--muted)]">The draft will include charge periods for the selected lab and dates.</p>
      <Button disabled={pending || !labs.length} type="submit">
        {pending ? "Generating..." : "Generate draft"}
      </Button>
    </form>
  );
}

export function RateForm({ action, category }: RateFormProps) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const commandIdentity = useCommandIdentity("billing-rate", state);
  const handleSubmit = useSubmitGuard(pending);

  return (
    <form action={formAction} className="rate-editor-form space-y-4" data-testid="rate-form" onSubmit={handleSubmit}>
      <CommandIdentityFields identity={commandIdentity} />
      {category ? <input name="categoryId" type="hidden" value={category.id} /> : null}
      <input name="expectedVersion" type="hidden" value={category?.version ?? 0} />
      {category ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="wrap-value font-semibold text-[var(--ink)]">{category.name}</p>
            <p className="font-mono text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
              Code {category.code} · {category.active ? "Active" : "Inactive"}
            </p>
          </div>
          <p className="money text-lg font-semibold text-[var(--ink)]">
            {(category.dailyRateCents / 100).toLocaleString("en-US", {
              style: "currency",
              currency: category.currencyCode,
            })}
            /day
          </p>
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_9rem_8rem_7rem]">
        <label className="space-y-2 text-sm md:col-span-2">
          <span className="text-[var(--muted)]">Name</span>
          <Input defaultValue={category?.name ?? ""} name="name" required />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Code</span>
          <Input defaultValue={category?.code ?? ""} name="code" required />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Daily rate</span>
          <Input
            className="money max-w-32"
            defaultValue={category ? (category.dailyRateCents / 100).toFixed(2) : ""}
            inputMode="decimal"
            min={0}
            name="dailyRate"
            placeholder="2.50"
            required
            step="0.01"
            type="number"
          />
          {category ? <input name="dailyRateCents" type="hidden" value={category.dailyRateCents} /> : null}
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Currency</span>
          <Input className="max-w-28 uppercase" defaultValue={category?.currencyCode ?? "USD"} name="currencyCode" required />
        </label>
        <label className="flex h-11 items-center gap-3 self-end rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm text-[var(--muted)]">
          <input defaultChecked={category?.active ?? true} name="active" type="checkbox" />
          Active
        </label>
        <label className="space-y-2 text-sm md:col-span-4">
          <span className="text-[var(--muted)]">Notes</span>
          <Input defaultValue={category?.notes ?? ""} name="notes" />
        </label>
      </div>
      <FormFeedback state={state} />
      <Button
        aria-label={category ? `Save ${category.name} rate` : "Add cage charge rate"}
        disabled={pending}
        type="submit"
        variant={category ? "subtle" : "default"}
      >
        {pending ? "Saving..." : category ? "Save" : "Add rate"}
      </Button>
    </form>
  );
}

export function InvoiceActionForms({
  invoiceId,
  invoiceNumber,
  labId,
  labName,
  totalLabel,
  expectedVersion,
  status,
  adjustmentAction,
  finalizeAction,
  voidAction,
  mode = "all",
}: InvoiceActionFormsProps) {
  const [adjustmentState, adjustmentFormAction, adjustmentPending] = useActionState(adjustmentAction, initialFormActionState);
  const [finalizeState, finalizeFormAction, finalizePending] = useActionState(finalizeAction, initialFormActionState);
  const [voidState, voidFormAction, voidPending] = useActionState(voidAction, initialFormActionState);
  const adjustmentIdentity = useCommandIdentity("billing-adjustment", adjustmentState);
  const finalizeIdentity = useCommandIdentity("billing-finalize", finalizeState);
  const voidIdentity = useCommandIdentity("billing-void", voidState);
  const [voidReason, setVoidReason] = useState("");
  const [finalizeStep, setFinalizeStep] = useState<"details" | "review">("details");
  const [voidStep, setVoidStep] = useState<"details" | "review">("details");
  const handleAdjustmentSubmit = useSubmitGuard(adjustmentPending);
  const handleFinalizeSubmit = useSubmitGuard(finalizePending);
  const handleVoidSubmit = useSubmitGuard(voidPending);
  const canVoid = Boolean(voidReason.trim()) && !voidPending;

  if (mode === "finalize" && status !== "draft") {
    return status === "finalized"
      ? <div className="worksheet-empty"><strong>Invoice already finalized</strong><p>The locked invoice is available from invoice detail.</p></div>
      : <div className="worksheet-empty"><strong>Invoice cannot be finalized</strong><p>This invoice is {status} and has no available finalization action.</p></div>;
  }

  if (mode === "void" && status === "void") {
    return <div className="worksheet-empty"><strong>Invoice already voided</strong><p>The void reason and audit history remain on invoice detail.</p></div>;
  }

  return (
    <div className="space-y-4">
      {status === "draft" && (mode === "all" || mode === "adjustment") ? (
        <form
          action={adjustmentFormAction}
          className="space-y-3 border-y border-[var(--line)] py-4"
          onSubmit={handleAdjustmentSubmit}
        >
          <CommandIdentityFields identity={adjustmentIdentity} />
          <input name="invoiceId" type="hidden" value={invoiceId} />
          <input name="labId" type="hidden" value={labId} />
          <input name="expectedVersion" type="hidden" value={expectedVersion} />
          <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,10rem)_minmax(0,1fr)]">
            <label className="space-y-2 text-sm">
              <span className="text-[var(--muted)]">Adjustment</span>
              <select className="h-11 w-full rounded-2xl border border-[var(--line)] bg-white px-4" name="adjustmentType">
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-[var(--muted)]">Amount</span>
              <Input inputMode="decimal" min="0.01" name="amount" placeholder="25.00" required step="0.01" type="number" />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-[var(--muted)]">Reason</span>
              <Input maxLength={500} name="reason" required />
            </label>
          </div>
          <p className="text-sm text-[var(--muted)]">Debits add to the total; credits subtract. Entries cannot be edited or deleted.</p>
          <Button disabled={adjustmentPending} type="submit" variant="subtle">
            {adjustmentPending ? "Recording..." : "Record adjustment"}
          </Button>
          <FormFeedback state={adjustmentState} />
        </form>
      ) : null}
      {status === "draft" && (mode === "all" || mode === "finalize") ? (
        <form
          action={finalizeFormAction}
          className="space-y-3 border-y border-[var(--line)] py-4"
          onSubmit={handleFinalizeSubmit}
        >
          <CommandIdentityFields identity={finalizeIdentity} />
          <input name="invoiceId" type="hidden" value={invoiceId} />
          <input name="labId" type="hidden" value={labId} />
          <input name="expectedVersion" type="hidden" value={expectedVersion} />
          <WorkflowSteps currentStep={finalizeStep} steps={[{ id: "details", label: "Invoice" }, { id: "review", label: "Review lock" }]} />
          {finalizeStep === "details" ? (
            <>
              <div className="metadata-grid">
                <div><span>Invoice</span><strong>{invoiceNumber}</strong></div>
                <div><span>Lab</span><strong>{labName}</strong></div>
                <div><span>Total</span><strong>{totalLabel}</strong></div>
                <div><span>Current state</span><strong>Draft</strong></div>
              </div>
              <Button onClick={() => setFinalizeStep("review")} type="button">Review finalization</Button>
            </>
          ) : (
            <>
              <WorkflowImpact title="Finalization locks this invoice for billing." tone="financial">
                <p>Line items, adjustments, service period, and total cannot be edited after this action. A void is required to remove it from active billing totals.</p>
              </WorkflowImpact>
              <div className="metadata-grid">
                <div><span>Invoice</span><strong>{invoiceNumber}</strong></div>
                <div><span>Lab</span><strong>{labName}</strong></div>
                <div><span>Locked total</span><strong>{totalLabel}</strong></div>
                <div><span>Next state</span><strong>Finalized</strong></div>
              </div>
              <FormFeedback state={finalizeState} />
              <div className="flex flex-wrap justify-between gap-3">
                <Button disabled={finalizePending || finalizeState.status === "success"} onClick={() => setFinalizeStep("details")} type="button" variant="ghost">Back</Button>
                <Button disabled={finalizePending || finalizeState.status === "success"} type="submit">
                  {finalizePending ? "Finalizing..." : finalizeState.status === "success" ? "Invoice finalized" : `Finalize ${invoiceNumber} for ${totalLabel}`}
                </Button>
              </div>
            </>
          )}
        </form>
      ) : null}
      {status !== "void" && (mode === "all" || mode === "void") ? (
        <form
          action={voidFormAction}
          className="space-y-3 border-y border-red-200 py-4"
          onSubmit={handleVoidSubmit}
        >
          <CommandIdentityFields identity={voidIdentity} />
          <input name="invoiceId" type="hidden" value={invoiceId} />
          <input name="labId" type="hidden" value={labId} />
          <input name="expectedVersion" type="hidden" value={expectedVersion} />
          <input name="reason" type="hidden" value={voidReason} />
          <WorkflowSteps currentStep={voidStep} steps={[{ id: "details", label: "Reason" }, { id: "review", label: "Review removal" }]} />
          {voidStep === "details" ? (
            <>
              <label className="space-y-2 text-sm">
                <span className="text-[var(--muted)]">Void reason</span>
                <Input onChange={(event) => setVoidReason(event.target.value)} required value={voidReason} />
              </label>
              <Button disabled={!canVoid} onClick={() => setVoidStep("review")} type="button" variant="danger">Review void</Button>
            </>
          ) : (
            <>
              <WorkflowImpact title="Voiding removes this invoice from active billing totals.">
                <p>The invoice and reason remain in the immutable audit trail. This action does not delete charge periods or line history.</p>
              </WorkflowImpact>
              <div className="metadata-grid">
                <div><span>Invoice</span><strong>{invoiceNumber}</strong></div>
                <div><span>Lab</span><strong>{labName}</strong></div>
                <div><span>Removed total</span><strong>{totalLabel}</strong></div>
                <div className="md:col-span-2"><span>Reason</span><strong className="wrap-value">{voidReason}</strong></div>
              </div>
              <FormFeedback state={voidState} />
              <div className="flex flex-wrap justify-between gap-3">
                <Button disabled={voidPending || voidState.status === "success"} onClick={() => setVoidStep("details")} type="button" variant="ghost">Back</Button>
                <Button disabled={voidPending || voidState.status === "success"} type="submit" variant="danger">
                  {voidPending ? "Voiding..." : voidState.status === "success" ? "Invoice voided" : `Void ${invoiceNumber}`}
                </Button>
              </div>
            </>
          )}
        </form>
      ) : null}
    </div>
  );
}
