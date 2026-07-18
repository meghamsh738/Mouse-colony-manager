"use client";

import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import { updateAnimalLifecycleAction } from "@/app/animals/[animalId]/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { WorkflowImpact, WorkflowSteps } from "@/components/app/workflow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";

type LifecycleAction = "euthanized" | "dead" | "transferred_out" | "archived";

type AnimalLifecycleFormProps = {
  animalId: string;
  animalLabel: string;
  allowedActions: Array<{ value: LifecycleAction; label: string }>;
  commandNonce: string;
  currentCageLabel: string;
  defaultDate: string;
  openBreedingCount: number;
  openExperimentCount: number;
  version: number;
  sopOptions: Array<{ id: string; label: string }>;
};

const defaultReasons: Record<LifecycleAction, string> = {
  euthanized: "Terminal tissue collection completed.",
  dead: "Found dead during routine welfare round.",
  transferred_out: "Transferred to an external holding or collaborating facility.",
  archived: "Archived after terminal disposition review.",
};

const actionLabels: Record<LifecycleAction, string> = {
  euthanized: "Euthanized",
  dead: "Found dead",
  transferred_out: "Transferred out",
  archived: "Archived",
};

const finalActionLabels: Record<LifecycleAction, string> = {
  euthanized: "Record as euthanized",
  dead: "Record as found dead",
  transferred_out: "Transfer out of facility",
  archived: "Archive animal record",
};

export function AnimalLifecycleForm({
  animalId,
  animalLabel,
  allowedActions,
  commandNonce,
  currentCageLabel,
  defaultDate,
  openBreedingCount,
  openExperimentCount,
  version,
  sopOptions,
}: AnimalLifecycleFormProps) {
  const [state, formAction, pending] = useActionState(updateAnimalLifecycleAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);
  const defaultAction = allowedActions[0]?.value ?? "euthanized";
  const [step, setStep] = useState<"details" | "review">("details");
  const [targetStatus, setTargetStatus] = useState<LifecycleAction>(defaultAction);
  const [happenedAtInput, setHappenedAtInput] = useState(defaultAction === "euthanized" ? "" : defaultDate);
  const [reason, setReason] = useState(defaultReasons[defaultAction]);
  const [destination, setDestination] = useState("");
  const [transferReference, setTransferReference] = useState("");
  const [sopAssignmentId, setSopAssignmentId] = useState("");
  const happenedAt = useMemo(() => {
    if (targetStatus !== "euthanized") return happenedAtInput;
    if (!happenedAtInput) return "";
    const parsed = new Date(happenedAtInput);
    return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString();
  }, [happenedAtInput, targetStatus]);
  const commandKey = useMemo(
    () => [commandNonce, animalId, version, targetStatus, happenedAt, reason, destination, transferReference, sopAssignmentId].join(":"),
    [animalId, commandNonce, destination, happenedAt, reason, sopAssignmentId, targetStatus, transferReference, version],
  );
  const canReview = reason.trim().length >= 3
    && Boolean(happenedAt)
    && openBreedingCount === 0
    && openExperimentCount === 0
    && (targetStatus !== "euthanized" || Boolean(sopAssignmentId))
    && (targetStatus !== "transferred_out" || destination.trim().length >= 2);

  if (!allowedActions.length) {
    return <p className="text-sm text-[var(--muted)]">This animal is already archived and cannot move to another lifecycle state.</p>;
  }

  return (
    <form action={formAction} className="space-y-4" data-testid="animal-lifecycle-form" onSubmit={handleSubmit}>
      <input name="animalId" type="hidden" value={animalId} />
      <input name="expectedVersion" type="hidden" value={version} />
      <input name="idempotencyKey" type="hidden" value={commandKey} />
      <input name="requestId" type="hidden" value={commandKey} />
      <input name="workflowDraftId" type="hidden" value={commandNonce} />
      <input name="targetStatus" type="hidden" value={targetStatus} />
      <input name="happenedAt" type="hidden" value={happenedAt} />
      <input name="reason" type="hidden" value={reason} />
      <input name="destination" type="hidden" value={destination} />
      <input name="transferReference" type="hidden" value={transferReference} />
      <input name="sopAssignmentId" type="hidden" value={sopAssignmentId} />

      <WorkflowSteps
        currentStep={step}
        steps={[{ id: "details", label: "Details" }, { id: "review", label: "Review impact" }]}
      />

      {step === "details" ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="text-[var(--muted)]">Lifecycle action</span>
              <select
                className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base text-[var(--ink)] md:h-10 md:text-sm"
                value={targetStatus}
                onChange={(event) => {
                  const action = event.target.value as LifecycleAction;
                  setTargetStatus(action);
                  setReason(defaultReasons[action]);
                  if (action !== "transferred_out") {
                    setDestination("");
                    setTransferReference("");
                  }
                  if (action === "euthanized") {
                    setHappenedAtInput("");
                  } else {
                    setHappenedAtInput(defaultDate);
                    setSopAssignmentId("");
                  }
                  setStep("details");
                }}
                data-testid="animal-lifecycle-target"
              >
                {allowedActions.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-[var(--muted)]">{targetStatus === "euthanized" ? "Lifecycle date and time" : "Lifecycle date"}</span>
              <Input
                max={targetStatus === "euthanized" ? undefined : defaultDate}
                required
                type={targetStatus === "euthanized" ? "datetime-local" : "date"}
                value={happenedAtInput}
                onChange={(event) => setHappenedAtInput(event.target.value)}
                data-testid="animal-lifecycle-date"
              />
            </label>
          </div>
          {targetStatus === "transferred_out" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="text-[var(--muted)]">Receiving facility</span>
                <Input required value={destination} onChange={(event) => setDestination(event.target.value)} data-testid="animal-lifecycle-destination" />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-[var(--muted)]">Transfer reference</span>
                <Input value={transferReference} onChange={(event) => setTransferReference(event.target.value)} data-testid="animal-lifecycle-reference" />
              </label>
            </div>
          ) : null}
          {targetStatus === "euthanized" ? (
            <label className="space-y-2 text-sm">
              <span className="text-[var(--muted)]">Approved SOP</span>
              <select
                className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3 text-base text-[var(--ink)] md:h-10 md:text-sm"
                required
                value={sopAssignmentId}
                onChange={(event) => setSopAssignmentId(event.target.value)}
              >
                <option value="">Choose exact assigned SOP</option>
                {sopOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              {!sopOptions.length ? <span className="block text-xs font-medium text-red-700">Assign an approved SOP to this lab before recording euthanasia.</span> : null}
            </label>
          ) : null}
          <label className="space-y-2 text-sm">
            <span className="text-[var(--muted)]">Reason</span>
            <textarea
              className="min-h-24 w-full rounded-md border border-[var(--line)] bg-white px-3 py-3 text-base text-[var(--ink)] outline-none focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              data-testid="animal-lifecycle-reason"
            />
          </label>
          <div className="flex justify-end border-t border-[var(--line)] pt-4">
            {openBreedingCount || openExperimentCount ? (
              <p className="mr-auto max-w-xl text-sm font-medium text-red-700">
                Clear
                {openBreedingCount ? ` ${openBreedingCount} open breeding ${openBreedingCount === 1 ? "relationship" : "relationships"}` : ""}
                {openBreedingCount && openExperimentCount ? " and" : ""}
                {openExperimentCount ? ` ${openExperimentCount} open experiment ${openExperimentCount === 1 ? "assignment" : "assignments"}` : ""}
                {" before recording this disposition."}
              </p>
            ) : null}
            <Button disabled={!canReview} onClick={() => setStep("review")} type="button" variant="danger" data-testid="animal-lifecycle-review">
              Review change
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-x-6 gap-y-3 border-y border-[var(--line)] py-4 text-sm sm:grid-cols-2">
            <div><span className="text-[var(--muted)]">Animal</span><strong className="mt-1 block">{animalLabel}</strong></div>
            <div><span className="text-[var(--muted)]">Action</span><strong className="mt-1 block">{actionLabels[targetStatus]}</strong></div>
            <div><span className="text-[var(--muted)]">{targetStatus === "euthanized" ? "Date and time" : "Date"}</span><strong className="mt-1 block">{happenedAtInput}</strong></div>
            <div><span className="text-[var(--muted)]">Current cage</span><strong className="mt-1 block">{currentCageLabel}</strong></div>
            {targetStatus === "transferred_out" && destination ? <div><span className="text-[var(--muted)]">Destination</span><strong className="mt-1 block wrap-value">{destination}</strong></div> : null}
            {targetStatus === "transferred_out" && transferReference ? <div><span className="text-[var(--muted)]">Reference</span><strong className="mt-1 block wrap-value">{transferReference}</strong></div> : null}
            {targetStatus === "euthanized" && sopAssignmentId ? <div><span className="text-[var(--muted)]">Approved SOP</span><strong className="mt-1 block wrap-value">{sopOptions.find((option) => option.id === sopAssignmentId)?.label}</strong></div> : null}
          </div>
          <WorkflowImpact title={`${actionLabels[targetStatus]} removes this animal from the active colony.`}>
            <p>Its cage assignment will end and an immutable lifecycle event will be recorded.</p>
          </WorkflowImpact>
          <div><span className="text-sm text-[var(--muted)]">Reason</span><p className="mt-1 wrap-value text-sm">{reason}</p></div>
          <FormFeedback state={state} />
          <div className="flex flex-wrap justify-between gap-3 border-t border-[var(--line)] pt-4">
            <Button disabled={pending || state.status === "success"} onClick={() => setStep("details")} type="button" variant="ghost">
              <ArrowLeft aria-hidden="true" size={16} /> Back
            </Button>
            <Button disabled={pending || state.status === "success"} type="submit" variant="danger" data-testid="animal-lifecycle-submit">
              <ClipboardCheck aria-hidden="true" size={16} /> {pending ? "Saving..." : state.status === "success" ? "Change recorded" : `${finalActionLabels[targetStatus]} · ${animalLabel.split(" · ")[0]}`}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
