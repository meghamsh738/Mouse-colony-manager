"use client";

import { useActionState, useState } from "react";

import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";

type CageMoveFormProps = {
  action: (state: FormActionState | undefined, formData: FormData) => Promise<FormActionState>;
  cageId: string;
  currentLocationLabel: string;
  defaultDate: string;
  defaultRoomId: string;
  defaultRackId: string;
  defaultCageNumber: string;
  roomOptions: Array<{ id: string; label: string }>;
  rackOptions: Array<{ id: string; roomId: string; label: string }>;
};

export function CageMoveForm({
  action,
  cageId,
  currentLocationLabel,
  defaultDate,
  defaultRoomId,
  defaultRackId,
  defaultCageNumber,
  roomOptions,
  rackOptions,
}: CageMoveFormProps) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const handleSubmit = useSubmitGuard(pending);
  const [selectedRoomId, setSelectedRoomId] = useState(defaultRoomId);
  const [selectedRackId, setSelectedRackId] = useState(defaultRackId);
  const filteredRacks = rackOptions.filter((rack) => rack.roomId === selectedRoomId);

  return (
    <form action={formAction} className="space-y-4" data-testid="cage-move-form" onSubmit={handleSubmit}>
      <input name="cageId" type="hidden" value={cageId} />
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Current location</p>
        <p className="mt-2 text-base font-medium text-[var(--ink)]">{currentLocationLabel}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Destination room</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            data-testid="cage-move-room"
            name="roomId"
            value={selectedRoomId}
            onChange={(event) => {
              const nextRoomId = event.target.value;
              const nextRacks = rackOptions.filter((rack) => rack.roomId === nextRoomId);

              setSelectedRoomId(nextRoomId);
              setSelectedRackId(nextRacks.some((rack) => rack.id === selectedRackId) ? selectedRackId : (nextRacks[0]?.id ?? ""));
            }}
          >
            {roomOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Destination rack</span>
          <select
            className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
            data-testid="cage-move-rack"
            name="rackId"
            value={selectedRackId}
            onChange={(event) => setSelectedRackId(event.target.value)}
          >
            {filteredRacks.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Destination cage number</span>
          <Input defaultValue={defaultCageNumber} name="cageNumber" required data-testid="cage-move-number" />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Move date</span>
          <Input defaultValue={defaultDate} name="movedAt" required type="date" data-testid="cage-move-date" />
        </label>
      </div>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Reason</span>
        <textarea
          className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          defaultValue="Moved after room-side review to keep the cage aligned with current monitoring needs."
          name="reason"
          required
          data-testid="cage-move-reason"
        />
      </label>
      <FormFeedback state={state} />
      <div className="border-t border-[var(--line)] pt-4">
        <Button className="relative z-10 w-full sm:w-auto" disabled={pending} type="submit" data-testid="cage-move-submit">
          {pending ? "Saving cage move..." : "Save cage move"}
        </Button>
      </div>
    </form>
  );
}
