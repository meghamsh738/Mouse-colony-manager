"use client";

import { useActionState, useState } from "react";

import { updateAnimalPresenceAction } from "@/app/animals/[animalId]/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";
import type { CageTransferOption } from "@/lib/types";

export function AnimalPresenceForm({
  animalId,
  version,
  isMissing,
  defaultDate,
  cages,
  commandNonce,
}: {
  animalId: string;
  version: number;
  isMissing: boolean;
  defaultDate: string;
  cages: CageTransferOption[];
  commandNonce: string;
}) {
  const [state, action, pending] = useActionState(updateAnimalPresenceAction, initialFormActionState);
  const [happenedAt, setHappenedAt] = useState(defaultDate);
  const [reason, setReason] = useState(isMissing ? "Animal located during cage search." : "Animal not present during routine cage check.");
  const [toCageId, setToCageId] = useState(cages[0]?.id ?? "");
  const presenceAction = isMissing ? "found" : "missing";
  const commandKey = [commandNonce, presenceAction, happenedAt, reason, toCageId].join(":");

  return (
    <form action={action} className="space-y-4">
      <input name="animalId" type="hidden" value={animalId} />
      <input name="action" type="hidden" value={presenceAction} />
      <input name="expectedVersion" type="hidden" value={version} />
      <input name="idempotencyKey" type="hidden" value={commandKey} />
      <input name="requestId" type="hidden" value={commandKey} />
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Event date</span>
        <Input name="happenedAt" required type="date" value={happenedAt} onChange={(event) => setHappenedAt(event.target.value)} />
      </label>
      {isMissing ? (
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Found in cage</span>
          <select name="toCageId" required value={toCageId} onChange={(event) => setToCageId(event.target.value)}>
            <option value="">Choose a cage</option>
            {cages.filter((cage) => cage.status !== "quarantine").map((cage) => (
              <option key={cage.id} value={cage.id}>{cage.barcode} · {cage.label} · {cage.occupantCount}/{cage.capacity}</option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Reason</span>
        <textarea name="reason" required value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <FormFeedback state={state} />
      <Button disabled={pending || (isMissing && !toCageId)} type="submit" variant={isMissing ? "default" : "danger"}>
        {pending ? "Saving..." : isMissing ? "Mark found" : "Mark missing"}
      </Button>
    </form>
  );
}
