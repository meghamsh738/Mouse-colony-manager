"use client";

import { useActionState, useMemo, useState } from "react";

import { transitionBreedingAction } from "@/app/breeding/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAllowedBreedingTransitions } from "@/lib/breeding-state-machine";
import { initialFormActionState } from "@/lib/form-state";
import type { BreedingStatus } from "@/lib/types";

const LABELS: Record<BreedingStatus, string> = {
  planned: "Planned",
  active: "Resume",
  paused: "Pause",
  retired: "Retire",
  failed: "Mark failed",
};

export function BreedingStatusForm({
  breedingSetupId,
  breedingSetupVersion,
  currentStatus,
  defaultDate,
}: {
  breedingSetupId: string;
  breedingSetupVersion: number;
  currentStatus: BreedingStatus;
  defaultDate: string;
}) {
  const transitions = getAllowedBreedingTransitions(currentStatus);
  const [state, formAction, pending] = useActionState(transitionBreedingAction, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);
  const [targetStatus, setTargetStatus] = useState<BreedingStatus>(transitions[0] ?? currentStatus);
  const [happenedAt, setHappenedAt] = useState(defaultDate);
  const [reason, setReason] = useState("");
  const commandKey = useMemo(
    () => ["breeding-transition", breedingSetupId, breedingSetupVersion, targetStatus, happenedAt, reason].join(":"),
    [breedingSetupId, breedingSetupVersion, happenedAt, reason, targetStatus],
  );

  if (!transitions.length) return <p className="text-sm text-[var(--muted)]">This setup is final.</p>;

  return (
    <form action={formAction} className="space-y-3" onSubmit={handleSubmit}>
      <input name="breedingSetupId" type="hidden" value={breedingSetupId} />
      <input name="expectedVersion" type="hidden" value={breedingSetupVersion} />
      <input name="idempotencyKey" type="hidden" value={commandKey} />
      <input name="requestId" type="hidden" value={commandKey} />
      <label className="block space-y-1.5 text-sm">
        <span className="text-[var(--muted)]">New status</span>
        <select
          className="h-11 w-full md:h-10"
          name="targetStatus"
          value={targetStatus}
          onChange={(event) => setTargetStatus(event.target.value as BreedingStatus)}
        >
          {transitions.map((status) => <option key={status} value={status}>{LABELS[status]}</option>)}
        </select>
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="text-[var(--muted)]">Date</span>
        <Input
          max={defaultDate}
          name="happenedAt"
          required
          type="date"
          value={happenedAt}
          onChange={(event) => setHappenedAt(event.target.value)}
        />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="text-[var(--muted)]">Reason</span>
        <Input name="reason" required value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <FormFeedback state={state} />
      <Button className="w-full" disabled={pending || reason.trim().length < 3} type="submit">
        {pending ? "Saving..." : LABELS[targetStatus]}
      </Button>
    </form>
  );
}
