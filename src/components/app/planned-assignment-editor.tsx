"use client";

import { useActionState } from "react";

import { deletePlannedAssignmentAction, updatePlannedAssignmentAction } from "@/app/experiments/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialFormActionState } from "@/lib/form-state";

type PlannedAssignmentEditorProps = {
  assignmentId: string;
  animalId: string;
  startDate: string;
  treatmentGroup?: string | null;
  notes?: string | null;
};

export function PlannedAssignmentEditor({
  assignmentId,
  animalId,
  startDate,
  treatmentGroup,
  notes,
}: PlannedAssignmentEditorProps) {
  const [updateState, updateAction, updatePending] = useActionState(updatePlannedAssignmentAction, initialFormActionState);
  const [deleteState, deleteAction, deletePending] = useActionState(deletePlannedAssignmentAction, initialFormActionState);
  const handleUpdateSubmit = useSubmitGuard(updatePending);
  const handleDeleteSubmit = useSubmitGuard(deletePending);

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-[var(--line)] p-3" data-testid={`planned-assignment-editor-${assignmentId}`}>
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Edit planned assignment for {animalId}</p>
      <form action={updateAction} className="space-y-3" onSubmit={handleUpdateSubmit}>
        <input type="hidden" name="assignmentId" value={assignmentId} />
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span className="text-[var(--muted)]">Start date</span>
            <Input defaultValue={startDate.slice(0, 10)} name="startDate" type="date" data-testid={`planned-start-${assignmentId}`} />
          </label>
          <label className="space-y-2 text-sm">
            <span className="text-[var(--muted)]">Treatment group</span>
            <Input
              defaultValue={treatmentGroup ?? ""}
              name="treatmentGroup"
              placeholder="Group A"
              data-testid={`planned-group-${assignmentId}`}
            />
          </label>
        </div>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Notes</span>
          <textarea
            className="min-h-20 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
            defaultValue={notes ?? ""}
            name="notes"
            placeholder="Optional planning note"
            data-testid={`planned-notes-${assignmentId}`}
          />
        </label>
        <FormFeedback state={updateState} />
        <Button className="relative z-10 w-full sm:w-auto" disabled={updatePending} type="submit" data-testid={`planned-update-submit-${assignmentId}`}>
          {updatePending ? "Saving plan..." : "Update plan"}
        </Button>
      </form>
      <form action={deleteAction} onSubmit={handleDeleteSubmit}>
        <input type="hidden" name="assignmentId" value={assignmentId} />
        <FormFeedback state={deleteState} />
        <Button className="relative z-10 w-full sm:w-auto" disabled={deletePending} type="submit" variant="subtle" data-testid={`planned-delete-submit-${assignmentId}`}>
          {deletePending ? "Removing..." : "Remove planned assignment"}
        </Button>
      </form>
    </div>
  );
}
