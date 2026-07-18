"use client";

import { ArrowLeft, ClipboardCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useActionState, useMemo, useState } from "react";

import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { WorkflowImpact, WorkflowSteps } from "@/components/app/workflow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import type { CageStatus, CageTransferOption, ChargeCategoryOption } from "@/lib/types";

type ServerFormAction = (state: FormActionState | undefined, formData: FormData) => Promise<FormActionState>;

type CageEditFormProps = {
  action: ServerFormAction;
  cage: {
    id: string;
    barcode: string;
    status: CageStatus;
    notes?: string;
    welfareFlags: string[];
    chargeCategoryId?: string | null;
    dailyRateCents?: number | null;
  };
  chargeCategoryOptions: ChargeCategoryOption[];
  canManageBilling: boolean;
};

type CageExitFormProps = {
  action: ServerFormAction;
  cageId: string;
  barcode: string;
  commandNonce: string;
  defaultDate: string;
  version: number;
  occupants: Array<{ id: string; animalId: string }>;
  destinationOptions: CageTransferOption[];
  activeChargePeriod: {
    id: string;
    categoryId: string;
    categoryName: string;
    dailyRateCents: number;
    currencyCode: string;
    startedAt: string;
  } | null;
};

function FormShell({
  action,
  children,
  testId,
}: {
  action: ServerFormAction;
  children: (pending: boolean, state: FormActionState) => ReactNode;
  testId: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);

  return (
    <form action={formAction} className="space-y-4" data-testid={testId} onSubmit={handleSubmit}>
      {children(pending, state)}
    </form>
  );
}

export function CageEditForm({ action, cage, chargeCategoryOptions, canManageBilling }: CageEditFormProps) {
  return (
    <FormShell action={action} testId="cage-edit-form">
      {(pending, state) => (
        <>
          <input name="cageId" type="hidden" value={cage.id} />
          <input name="barcode" type="hidden" value={cage.barcode} />
          <div className="grid gap-4 sm:grid-cols-2">
            {canManageBilling ? <label className="space-y-2 text-sm">
              <span className="text-[var(--muted)]">Status</span>
              <select
                className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
                defaultValue={cage.status === "closed" ? "retired" : cage.status}
                name="status"
              >
                <option value="active">Active</option>
                <option value="breeding">Breeding</option>
                <option value="quarantine">Quarantine</option>
                <option value="experiment">Experiment</option>
                <option value="retired">Retired</option>
              </select>
            </label> : null}
            {canManageBilling ? <label className="space-y-2 text-sm">
              <span className="text-[var(--muted)]">Charge category</span>
              <select
                className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
                defaultValue={cage.chargeCategoryId ?? ""}
                name="chargeCategoryId"
              >
                <option value="">Unpriced</option>
                {chargeCategoryOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label> : null}
            <label className="space-y-2 text-sm">
              <span className="text-[var(--muted)]">Daily rate override</span>
              <Input
                defaultValue={cage.dailyRateCents ? (cage.dailyRateCents / 100).toFixed(2) : ""}
                inputMode="decimal"
                min={0}
                name="dailyRate"
                placeholder="Default"
                step="0.01"
                type="number"
              />
              {cage.dailyRateCents ? <input name="dailyRateCents" type="hidden" value={cage.dailyRateCents} /> : null}
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-[var(--muted)]">Welfare flags</span>
              <Input defaultValue={cage.welfareFlags.join(", ")} name="welfareFlags" placeholder="Comma-separated" />
            </label>
          </div>
          <label className="space-y-2 text-sm">
            <span className="text-[var(--muted)]">Notes</span>
            <textarea
              className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
              defaultValue={cage.notes ?? ""}
              name="notes"
            />
          </label>
          <FormFeedback state={state} />
          <Button className="relative z-10 w-full sm:w-auto" disabled={pending} type="submit">
            {pending ? "Saving..." : "Save cage"}
          </Button>
        </>
      )}
    </FormShell>
  );
}

export function CageExitForm({
  action,
  cageId,
  barcode,
  commandNonce,
  defaultDate,
  version,
  occupants,
  destinationOptions,
  activeChargePeriod,
}: CageExitFormProps) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);
  const [step, setStep] = useState<"details" | "review">("details");
  const [closedAt, setClosedAt] = useState(defaultDate);
  const [reason, setReason] = useState("Cage removed from active service after occupant consolidation.");
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const availableDestinations = destinationOptions.filter((option) => option.id !== cageId);
  const commandKey = useMemo(
    () => [
      commandNonce,
      cageId,
      version,
      closedAt,
      reason,
      ...occupants.map((animal) => `${animal.id}:${assignments[animal.id] ?? ""}`),
      activeChargePeriod?.id ?? "no-period",
      activeChargePeriod?.categoryId ?? "no-category",
      activeChargePeriod?.startedAt ?? "no-start",
      activeChargePeriod?.dailyRateCents ?? "no-rate",
      activeChargePeriod?.currencyCode ?? "no-currency",
    ].join(":"),
    [activeChargePeriod, assignments, cageId, closedAt, commandNonce, occupants, reason, version],
  );
  const canReview = Boolean(activeChargePeriod)
    && Boolean(closedAt)
    && reason.trim().length >= 3
    && occupants.every((animal) => Boolean(assignments[animal.id]));
  const rateLabel = activeChargePeriod
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: activeChargePeriod.currencyCode }).format(activeChargePeriod.dailyRateCents / 100)
    : null;

  return (
    <form action={formAction} className="space-y-4" data-testid="cage-exit-form" onSubmit={handleSubmit}>
      <input name="cageId" type="hidden" value={cageId} />
      <input name="barcode" type="hidden" value={barcode} />
      <input name="closedAt" type="hidden" value={closedAt} />
      <input name="reason" type="hidden" value={reason} />
      <input name="expectedVersion" type="hidden" value={version} />
      <input name="idempotencyKey" type="hidden" value={commandKey} />
      <input name="requestId" type="hidden" value={commandKey} />
      <input name="workflowDraftId" type="hidden" value={commandNonce} />
      <input name="expectedChargePeriodId" type="hidden" value={activeChargePeriod?.id ?? ""} />
      <input name="expectedChargeCategoryId" type="hidden" value={activeChargePeriod?.categoryId ?? ""} />
      <input name="expectedChargePeriodStartedAt" type="hidden" value={activeChargePeriod?.startedAt ?? ""} />
      <input name="expectedDailyRateCents" type="hidden" value={activeChargePeriod?.dailyRateCents ?? ""} />
      <input name="expectedCurrencyCode" type="hidden" value={activeChargePeriod?.currencyCode ?? ""} />
      {occupants.map((animal) => (
        <span key={animal.id}>
          <input name="moveAnimalId" type="hidden" value={animal.id} />
          <input name="moveToCageId" type="hidden" value={assignments[animal.id] ?? ""} />
        </span>
      ))}

      <WorkflowSteps
        currentStep={step}
        steps={[{ id: "details", label: "Move occupants" }, { id: "review", label: "Review closure" }]}
      />

      {step === "details" ? (
        <>
          <div className="rounded-2xl border border-red-300 bg-red-50/80 px-4 py-3 text-sm text-red-950">
            <p className="font-medium">Cage {barcode}</p>
            <p className="mt-1">
              {occupants.length
                ? `${occupants.length} live occupant${occupants.length === 1 ? "" : "s"} must be moved before closure.`
                : "No live occupants are assigned."}
            </p>
          </div>
          {occupants.length ? (
            <div className="space-y-3">
              {occupants.map((animal) => (
                <div key={animal.id} className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]">
                  <div className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 font-medium">
                    {animal.animalId}
                  </div>
                  <select
                    aria-label={`Destination cage for ${animal.animalId}`}
                    className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
                    required
                    value={assignments[animal.id] ?? ""}
                    onChange={(event) => setAssignments((current) => ({ ...current, [animal.id]: event.target.value }))}
                  >
                    <option value="">Destination cage</option>
                    {availableDestinations.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.barcode} - {option.label} - {option.sexComposition}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <label className="space-y-2 text-sm">
              <span className="text-[var(--muted)]">Closure date</span>
              <Input max={defaultDate} required type="date" value={closedAt} onChange={(event) => setClosedAt(event.target.value)} />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-[var(--muted)]">Reason</span>
              <textarea
                className="min-h-20 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </div>
          {!activeChargePeriod ? (
            <p className="border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm font-medium text-red-950">
              Reconcile cage billing before closure. Exactly one active charge period is required.
            </p>
          ) : null}
          <div className="flex justify-end border-t border-[var(--line)] pt-4">
            <Button
              disabled={!canReview || (occupants.length > 0 && !availableDestinations.length)}
              onClick={() => setStep("review")}
              type="button"
              variant="danger"
            >
              Review closure
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-x-6 gap-y-3 border-y border-[var(--line)] py-4 text-sm sm:grid-cols-2">
            <div><span className="text-[var(--muted)]">Cage</span><strong className="mt-1 block">{barcode}</strong></div>
            <div><span className="text-[var(--muted)]">Closure date</span><strong className="mt-1 block">{closedAt}</strong></div>
            <div><span className="text-[var(--muted)]">Animals moved</span><strong className="mt-1 block">{occupants.length}</strong></div>
            <div><span className="text-[var(--muted)]">Billing cutoff</span><strong className="mt-1 block">Start of {closedAt}</strong></div>
            {activeChargePeriod ? (
              <>
                <div><span className="text-[var(--muted)]">Final charge period</span><strong className="mt-1 block wrap-value">{activeChargePeriod.id}</strong></div>
                <div><span className="text-[var(--muted)]">Current rate</span><strong className="mt-1 block">{activeChargePeriod.categoryName} · {rateLabel}/day</strong></div>
              </>
            ) : null}
          </div>
          {occupants.length ? (
            <div className="row-list">
              {occupants.map((animal) => {
                const destination = availableDestinations.find((option) => option.id === assignments[animal.id]);
                return (
                  <div className="record-row" key={animal.id}>
                    <strong>{animal.animalId}</strong>
                    <span className="wrap-value text-sm text-[var(--muted)]">to {destination?.barcode ?? "Missing destination"} · {destination?.label ?? "Review assignment"}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
          <WorkflowImpact title="This cage cannot be reopened after confirmation.">
            <p>Future assignments and billing periods are blocked. The closure and final charge cutoff become append-only history.</p>
          </WorkflowImpact>
          <div><span className="text-sm text-[var(--muted)]">Reason</span><p className="mt-1 wrap-value text-sm">{reason}</p></div>
          <label className="flex min-h-11 items-start gap-3 border border-red-300 bg-red-50/80 px-4 py-3 text-sm text-red-950">
            <input
              checked={acknowledged}
              className="mt-1 size-4"
              name="confirmCloseImpact"
              onChange={(event) => setAcknowledged(event.target.checked)}
              required
              type="checkbox"
            />
            <span>I reviewed all destinations and understand the closure and billing cutoff are permanent.</span>
          </label>
          <FormFeedback state={state} />
          <div className="flex flex-wrap justify-between gap-3 border-t border-[var(--line)] pt-4">
            <Button
              disabled={pending || state.status === "success"}
              onClick={() => {
                setAcknowledged(false);
                setStep("details");
              }}
              type="button"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" size={16} /> Back
            </Button>
            <Button disabled={!acknowledged || pending || state.status === "success"} type="submit" variant="danger">
              <ClipboardCheck aria-hidden="true" size={16} /> {pending ? "Closing..." : state.status === "success" ? "Cage closed" : `Permanently close ${barcode}`}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
