"use client";

import { useActionState, useState } from "react";

import {
  deletePlannedAssignmentAction,
  demoteReservedCohortAction,
  planExperimentCohortAction,
  promotePlannedCohortAction,
  updatePlannedAssignmentAction,
} from "@/app/experiments/actions";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { WorkflowImpact, WorkflowSteps } from "@/components/app/workflow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ExperimentAssignmentVersionSnapshot, PlannedAnimalSnapshot } from "@/lib/experiment-assignment-write";
import type { ExperimentPlannerFilters } from "@/lib/types";
import { initialFormActionState } from "@/lib/form-state";

type ExperimentOption = {
  id: string;
  label: string;
  version: number;
};

type ExperimentPlanSaveFormProps = {
  experimentOptions: ExperimentOption[];
  filters: ExperimentPlannerFilters;
  assignments: PlannedAnimalSnapshot[];
};

function makeNonce() {
  return crypto.randomUUID();
}

function payloadHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function commandIdentity(nonce: string, action: string, payload: string) {
  const value = `${nonce}:${action}:${payloadHash(payload)}`;
  return { idempotencyKey: value, requestId: value };
}

function CommandIdentityFields({ identity }: { identity: { idempotencyKey: string; requestId: string } }) {
  return (
    <>
      <input name="idempotencyKey" type="hidden" value={identity.idempotencyKey} />
      <input name="requestId" type="hidden" value={identity.requestId} />
    </>
  );
}

export function ExperimentPlanSaveForm({ experimentOptions, filters, assignments }: ExperimentPlanSaveFormProps) {
  const [state, formAction, pending] = useActionState(planExperimentCohortAction, initialFormActionState);
  const [nonce] = useState(makeNonce);
  const [experimentId, setExperimentId] = useState(experimentOptions[0]?.id ?? "");
  const [startDate, setStartDate] = useState("2026-04-15");
  const [notes, setNotes] = useState("");
  const handleSubmit = useSubmitGuard(pending);
  const expectedExperimentVersion = experimentOptions.find((option) => option.id === experimentId)?.version ?? 0;
  const assignmentsJson = JSON.stringify(assignments);
  const identity = commandIdentity(nonce, "plan", JSON.stringify({ experimentId, expectedExperimentVersion, startDate, notes, assignments }));

  return (
    <form className="space-y-4" action={formAction} data-testid="experiment-plan-save-form" onSubmit={handleSubmit}>
      <input name="assignmentsJson" type="hidden" value={assignmentsJson} />
      <input name="expectedExperimentVersion" type="hidden" value={expectedExperimentVersion} />
      <CommandIdentityFields identity={identity} />

      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Target experiment</span>
        <select
          className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
          name="experimentId"
          value={experimentId}
          data-testid="planner-save-experiment"
          onChange={(event) => setExperimentId(event.target.value)}
        >
          {experimentOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Planned start</span>
          <Input
            name="startDate"
            type="date"
            value={startDate}
            data-testid="planner-save-start-date"
            onChange={(event) => setStartDate(event.target.value)}
            required
          />
        </label>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--ink)]">
          <span className="text-[var(--muted)]">Immutable submitted snapshot</span>
          <p className="mt-1 font-medium">
            {assignments.length} rendered animals · {filters.groupCount} groups · seed {filters.randomSeed}
          </p>
        </div>
      </div>
      <label className="space-y-2 text-sm">
        <span className="text-[var(--muted)]">Planning note</span>
        <textarea
          className="min-h-24 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
          maxLength={400}
          name="notes"
          placeholder="Saved from planner."
          value={notes}
          data-testid="planner-save-notes"
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <FormFeedback state={state} />
      <div className="border-t border-[var(--line)] pt-4">
        <Button className="relative z-10 w-full sm:w-auto" disabled={pending || !assignments.length || !experimentId} type="submit" data-testid="planner-save-submit">
          {pending ? "Saving cohort..." : "Save cohort plan"}
        </Button>
      </div>
    </form>
  );
}

type ExperimentAssignmentBatchFormProps = {
  action: "promote" | "demote";
  experimentId: string;
  experimentLabel: string;
  expectedExperimentVersion: number;
  assignments: ExperimentAssignmentVersionSnapshot[];
};

export function ExperimentAssignmentBatchForm({
  action,
  experimentId,
  experimentLabel,
  expectedExperimentVersion,
  assignments,
}: ExperimentAssignmentBatchFormProps) {
  const serverAction = action === "promote" ? promotePlannedCohortAction : demoteReservedCohortAction;
  const [state, formAction, pending] = useActionState(serverAction, initialFormActionState);
  const [nonce] = useState(makeNonce);
  const handleSubmit = useSubmitGuard(pending);
  const assignmentsJson = JSON.stringify(assignments);
  const identity = commandIdentity(nonce, action, JSON.stringify({ experimentId, expectedExperimentVersion, assignments }));
  const promote = action === "promote";
  const [step, setStep] = useState<"details" | "review">("details");

  return (
    <form action={formAction} className="space-y-3" data-testid={`experiment-${action}-form-${experimentId}`} onSubmit={handleSubmit}>
      <input name="experimentId" type="hidden" value={experimentId} />
      <input name="expectedExperimentVersion" type="hidden" value={expectedExperimentVersion} />
      <input name="assignmentsJson" type="hidden" value={assignmentsJson} />
      <CommandIdentityFields identity={identity} />
      <WorkflowSteps currentStep={step} steps={[{ id: "details", label: "Cohort" }, { id: "review", label: "Review reservations" }]} />
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--ink)]">
        <span className="text-[var(--muted)]">Exact versioned assignment snapshot</span>
        <p className="mt-1 font-medium">{assignments.length} assignment{assignments.length === 1 ? "" : "s"} selected</p>
      </div>
      {step === "details" ? <Button className="relative z-10 w-full sm:w-auto" disabled={!assignments.length} onClick={() => setStep("review")} type="button" variant={promote ? "default" : "subtle"}>Review {promote ? "reservation" : "return"}</Button> : <><WorkflowImpact title={promote ? "This reserves the selected animals for the experiment." : "This returns the selected reservations to planned status."} tone="warning"><p>{promote ? "Availability is revalidated when submitted and each assignment retains its exact versioned provenance." : "The animals remain in the experiment plan but are no longer held as active reservations."}</p></WorkflowImpact><FormFeedback state={state} /><div className="flex flex-wrap justify-between gap-3"><Button disabled={pending || state.status === "success"} onClick={() => setStep("details")} type="button" variant="ghost">Back</Button><Button className="relative z-10 w-full sm:w-auto" disabled={pending || !assignments.length || state.status === "success"} type="submit" variant={promote ? "default" : "subtle"} data-testid={`experiment-${action}-submit-${experimentId}`}>{pending ? (promote ? "Reserving cohort..." : "Returning reservations...") : promote ? `Reserve ${assignments.length} planned animals for ${experimentLabel}` : `Return ${assignments.length} reservations to planned`}</Button></div></>}
    </form>
  );
}

type VersionedPlannedAssignmentEditorProps = {
  experimentId: string;
  expectedExperimentVersion: number;
  assignmentId: string;
  expectedAssignmentVersion: number;
  animalId: string;
  experimentLabel: string;
  startDate: string;
  treatmentGroup?: string | null;
  notes?: string | null;
};

export function VersionedPlannedAssignmentEditor({
  experimentId,
  expectedExperimentVersion,
  assignmentId,
  expectedAssignmentVersion,
  animalId,
  experimentLabel,
  startDate: initialStartDate,
  treatmentGroup: initialTreatmentGroup,
  notes: initialNotes,
}: VersionedPlannedAssignmentEditorProps) {
  const [updateState, updateAction, updatePending] = useActionState(updatePlannedAssignmentAction, initialFormActionState);
  const [deleteState, deleteAction, deletePending] = useActionState(deletePlannedAssignmentAction, initialFormActionState);
  const [updateNonce] = useState(makeNonce);
  const [deleteNonce] = useState(makeNonce);
  const [startDate, setStartDate] = useState(initialStartDate.slice(0, 10));
  const [treatmentGroup, setTreatmentGroup] = useState(initialTreatmentGroup ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [deleteReview, setDeleteReview] = useState(false);
  const handleUpdateSubmit = useSubmitGuard(updatePending);
  const handleDeleteSubmit = useSubmitGuard(deletePending);
  const versionPayload = { experimentId, expectedExperimentVersion, assignmentId, expectedAssignmentVersion };
  const updateIdentity = commandIdentity(updateNonce, "update", JSON.stringify({ ...versionPayload, startDate, treatmentGroup, notes }));
  const deleteIdentity = commandIdentity(deleteNonce, "delete", JSON.stringify(versionPayload));

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-[var(--line)] p-3" data-testid={`planned-assignment-editor-${assignmentId}`}>
      <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Edit planned assignment for {animalId}</p>
      <form action={updateAction} className="space-y-3" onSubmit={handleUpdateSubmit}>
        <VersionFields
          assignmentId={assignmentId}
          expectedAssignmentVersion={expectedAssignmentVersion}
          expectedExperimentVersion={expectedExperimentVersion}
          experimentId={experimentId}
        />
        <CommandIdentityFields identity={updateIdentity} />
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span className="text-[var(--muted)]">Start date</span>
            <Input value={startDate} name="startDate" type="date" data-testid={`planned-start-${assignmentId}`} onChange={(event) => setStartDate(event.target.value)} required />
          </label>
          <label className="space-y-2 text-sm">
            <span className="text-[var(--muted)]">Treatment group</span>
            <Input
              value={treatmentGroup}
              maxLength={80}
              name="treatmentGroup"
              placeholder="Group A"
              data-testid={`planned-group-${assignmentId}`}
              onChange={(event) => setTreatmentGroup(event.target.value)}
            />
          </label>
        </div>
        <label className="space-y-2 text-sm">
          <span className="text-[var(--muted)]">Notes</span>
          <textarea
            className="min-h-20 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
            maxLength={400}
            value={notes}
            name="notes"
            placeholder="Optional planning note"
            data-testid={`planned-notes-${assignmentId}`}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <FormFeedback state={updateState} />
        <Button className="relative z-10 w-full sm:w-auto" disabled={updatePending} type="submit" data-testid={`planned-update-submit-${assignmentId}`}>
          {updatePending ? "Saving plan..." : "Update plan"}
        </Button>
      </form>
      <form action={deleteAction} className="space-y-3" onSubmit={handleDeleteSubmit}>
        <VersionFields
          assignmentId={assignmentId}
          expectedAssignmentVersion={expectedAssignmentVersion}
          expectedExperimentVersion={expectedExperimentVersion}
          experimentId={experimentId}
        />
        <CommandIdentityFields identity={deleteIdentity} />
        {deleteReview ? <><WorkflowImpact title={`Remove ${animalId} from ${experimentLabel} plan?`} tone="warning"><p>The animal is released from this planned assignment. Existing animal and experiment records are not deleted.</p></WorkflowImpact><FormFeedback state={deleteState} /><div className="flex flex-wrap gap-2"><Button disabled={deletePending || deleteState.status === "success"} onClick={() => setDeleteReview(false)} type="button" variant="ghost">Back</Button><Button className="relative z-10 w-full sm:w-auto" disabled={deletePending || deleteState.status === "success"} type="submit" variant="warning" data-testid={`planned-delete-submit-${assignmentId}`}>{deletePending ? "Removing..." : `Remove ${animalId} from ${experimentLabel} plan`}</Button></div></> : <Button className="relative z-10 w-full sm:w-auto" onClick={() => setDeleteReview(true)} type="button" variant="subtle">Review removal</Button>}
      </form>
    </div>
  );
}

function VersionFields({
  experimentId,
  expectedExperimentVersion,
  assignmentId,
  expectedAssignmentVersion,
}: {
  experimentId: string;
  expectedExperimentVersion: number;
  assignmentId: string;
  expectedAssignmentVersion: number;
}) {
  return (
    <>
      <input name="experimentId" type="hidden" value={experimentId} />
      <input name="expectedExperimentVersion" type="hidden" value={expectedExperimentVersion} />
      <input name="assignmentId" type="hidden" value={assignmentId} />
      <input name="expectedAssignmentVersion" type="hidden" value={expectedAssignmentVersion} />
    </>
  );
}
