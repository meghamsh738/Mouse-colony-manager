"use client";

import { FlaskConical, PencilLine } from "lucide-react";
import { useActionState, useState, type ReactNode } from "react";

import {
  createExperimentAction,
  transitionExperimentStatusAction,
  updateExperimentAction,
} from "@/app/experiments/actions";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { FormFeedback } from "@/components/app/form-feedback";
import { useSubmitGuard } from "@/components/app/use-submit-guard";
import { MobileWorksheetCard, RowActionMenu, WorksheetShell } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { ExperimentOverviewItem } from "@/lib/experiments-read";
import { initialFormActionState, type FormActionState } from "@/lib/form-state";
import { formatDate, titleCase } from "@/lib/utils";

type Option = { id: string; label: string };
type ProjectOption = Option & { labId: string };
type ExperimentAction = (previousState: FormActionState, formData: FormData) => Promise<FormActionState>;

type ExperimentRegistryProps = {
  experiments: ExperimentOverviewItem[];
  labOptions: Option[];
  projectOptions: ProjectOption[];
  canManage: boolean;
};

const controlClassName = "min-h-11 w-full min-w-0 rounded-md border border-[var(--line)] bg-white px-3 text-base text-[var(--ink)] outline-none focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm";
const textareaClassName = `${controlClassName} resize-y py-2.5`;
const labelClassName = "block min-w-0 space-y-1.5 text-sm";

function makeCommandIdentity() {
  return { idempotencyKey: crypto.randomUUID(), requestId: crypto.randomUUID() };
}

function CommandForm({
  action,
  children,
  pendingLabel,
  submitLabel,
  testId,
  variant = "default",
}: {
  action: ExperimentAction;
  children: ReactNode;
  pendingLabel: string;
  submitLabel: string;
  testId: string;
  variant?: ButtonProps["variant"];
}) {
  const [state, formAction, pending] = useActionState(action, initialFormActionState);
  const [identity] = useState(makeCommandIdentity);
  const handleSubmit = useSubmitGuard(pending);
  return (
    <form action={formAction} className="space-y-3" data-testid={testId} onSubmit={handleSubmit}>
      <input name="idempotencyKey" type="hidden" value={identity.idempotencyKey} />
      <input name="requestId" type="hidden" value={identity.requestId} />
      {children}
      <FormFeedback state={state} />
      <Button className="min-h-11 w-full sm:w-auto" disabled={pending} type="submit" variant={variant}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`${labelClassName}${wide ? " md:col-span-2" : ""}`}>
      <span className="text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

function dateValue(value: string | null) {
  return value?.slice(0, 10) ?? "";
}

function ExperimentDetailsFields({
  experiment,
  labOptions,
  projectOptions,
}: {
  experiment?: ExperimentOverviewItem;
  labOptions: Option[];
  projectOptions: ProjectOption[];
}) {
  const [selectedLabId, setSelectedLabId] = useState(experiment?.labId ?? labOptions[0]?.id ?? "");
  const availableProjects = projectOptions.filter((project) => project.labId === selectedLabId);
  return (
    <>
      {experiment ? (
        <input name="labId" type="hidden" value={experiment.labId} />
      ) : labOptions.length === 1 ? (
        <input name="labId" type="hidden" value={selectedLabId} />
      ) : (
        <Field label="Lab">
          <select className={controlClassName} name="labId" onChange={(event) => setSelectedLabId(event.target.value)} required value={selectedLabId}>
            <option disabled value="">Choose lab</option>
            {labOptions.map((lab) => <option key={lab.id} value={lab.id}>{lab.label}</option>)}
          </select>
        </Field>
      )}
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <Field label="Experiment code">
          <input className={controlClassName} defaultValue={experiment?.experimentCode} maxLength={40} name="experimentCode" placeholder="EXP-2026-01" required />
        </Field>
        <Field label="Project">
          <select className={controlClassName} defaultValue={experiment?.projectId ?? ""} name="projectId" required>
            <option disabled value="">Choose project</option>
            {availableProjects.map((project) => <option key={project.id} value={project.id}>{project.label}</option>)}
          </select>
        </Field>
        <Field label="Title" wide>
          <input className={controlClassName} defaultValue={experiment?.title} maxLength={160} name="title" required />
        </Field>
        <Field label="Planned start">
          <input className={controlClassName} defaultValue={dateValue(experiment?.plannedStartAt ?? null)} name="plannedStartAt" type="date" />
        </Field>
        <Field label="Planned end">
          <input className={controlClassName} defaultValue={dateValue(experiment?.plannedEndAt ?? null)} name="plannedEndAt" type="date" />
        </Field>
        <Field label="Operational contact" wide>
          <input className={controlClassName} defaultValue={experiment?.operationalContact ?? ""} maxLength={160} name="operationalContact" />
        </Field>
        <Field label="Procedure summary" wide>
          <textarea className={textareaClassName} defaultValue={experiment?.procedureSummary ?? ""} maxLength={2_000} name="procedureSummary" rows={3} />
        </Field>
        <Field label="Treatment summary" wide>
          <textarea className={textareaClassName} defaultValue={experiment?.treatmentSummary ?? ""} maxLength={2_000} name="treatmentSummary" rows={3} />
        </Field>
        <Field label="Welfare risks" wide>
          <textarea className={textareaClassName} defaultValue={experiment?.welfareRisks ?? ""} maxLength={2_000} name="welfareRisks" rows={3} />
        </Field>
        <Field label="Schedule notes" wide>
          <textarea className={textareaClassName} defaultValue={experiment?.scheduleNotes ?? ""} maxLength={2_000} name="scheduleNotes" rows={3} />
        </Field>
        <Field label="Operational notes" wide>
          <textarea className={textareaClassName} defaultValue={experiment?.operationalNotes ?? ""} maxLength={2_000} name="operationalNotes" rows={3} />
        </Field>
        <Field label="Private research notes" wide>
          <textarea className={textareaClassName} defaultValue={experiment?.researchNotes ?? ""} maxLength={4_000} name="notes" rows={4} />
        </Field>
        <Field label="Private result summary" wide>
          <textarea className={textareaClassName} defaultValue={experiment?.resultSummary ?? ""} maxLength={4_000} name="resultSummary" rows={4} />
        </Field>
      </div>
    </>
  );
}

function CreateExperimentForm({ labOptions, projectOptions }: Pick<ExperimentRegistryProps, "labOptions" | "projectOptions">) {
  if (!labOptions.length) return <p className="text-sm text-[var(--muted)]">No active lab is available for experiment creation.</p>;
  return (
    <CommandForm action={createExperimentAction} pendingLabel="Creating experiment..." submitLabel="Create planned experiment" testId="create-experiment-form">
      <ExperimentDetailsFields labOptions={labOptions} projectOptions={projectOptions} />
    </CommandForm>
  );
}

function UpdateExperimentForm({ experiment, projectOptions }: { experiment: ExperimentOverviewItem; projectOptions: ProjectOption[] }) {
  return (
    <CommandForm action={updateExperimentAction} pendingLabel="Saving worksheet..." submitLabel="Save worksheet" testId={`update-experiment-${experiment.id}`}>
      <input name="experimentId" type="hidden" value={experiment.id} />
      <input name="expectedVersion" type="hidden" value={experiment.version} />
      <ExperimentDetailsFields experiment={experiment} labOptions={[]} projectOptions={projectOptions} />
    </CommandForm>
  );
}

function LifecycleForm({ experiment }: { experiment: ExperimentOverviewItem }) {
  const nextStatuses = experiment.status === "planned" ? ["active", "cancelled"] : ["completed", "cancelled"];
  return (
    <CommandForm action={transitionExperimentStatusAction} pendingLabel="Changing status..." submitLabel="Apply lifecycle change" testId={`transition-experiment-${experiment.id}`} variant="warning">
      <input name="experimentId" type="hidden" value={experiment.id} />
      <input name="labId" type="hidden" value={experiment.labId} />
      <input name="expectedVersion" type="hidden" value={experiment.version} />
      <Field label="Next status">
        <select className={controlClassName} name="status" required>
          {nextStatuses.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}
        </select>
      </Field>
      <p className="text-xs leading-5 text-[var(--muted)]">Terminal statuses lock experiment metadata and cannot be reversed.</p>
    </CommandForm>
  );
}

function ExperimentActions({ experiment, projectOptions }: { experiment: ExperimentOverviewItem; projectOptions: ProjectOption[] }) {
  const terminal = experiment.status === "completed" || experiment.status === "cancelled";
  if (terminal) return <span className="text-xs text-[var(--muted)]">Locked</span>;
  return (
    <RowActionMenu label="Manage">
      <details>
        <summary className="table-action min-h-11 w-full cursor-pointer justify-start">Edit worksheet</summary>
        <div className="mt-3 border-l-2 border-[var(--line)] pl-3"><UpdateExperimentForm experiment={experiment} projectOptions={projectOptions} /></div>
      </details>
      <details>
        <summary className="table-action min-h-11 w-full cursor-pointer justify-start">Change lifecycle</summary>
        <div className="mt-3 border-l-2 border-amber-300 pl-3"><LifecycleForm experiment={experiment} /></div>
      </details>
    </RowActionMenu>
  );
}

function statusVariant(status: string) {
  if (status === "active") return "success" as const;
  if (status === "cancelled") return "danger" as const;
  if (status === "planned") return "warning" as const;
  return "neutral" as const;
}

export function ExperimentRegistry({ experiments, labOptions, projectOptions, canManage }: ExperimentRegistryProps) {
  const actions: CompactActionItem[] = canManage ? [{
    id: "create-experiment",
    label: "New experiment",
    description: "Create a planned experiment with operational and private worksheet fields.",
    icon: <FlaskConical aria-hidden size={17} />,
    panel: <CreateExperimentForm labOptions={labOptions} projectOptions={projectOptions} />,
    tone: "primary",
  }] : [];
  return (
    <div className="space-y-5" data-testid="experiment-registry">
      {canManage ? <CompactActionTray actions={actions} eyebrow="Registry" summary={<span>{experiments.length} experiments</span>} title="Experiment actions" /> : null}
      <WorksheetShell eyebrow="Lifecycle registry" summary={<span>Optimistic versioning enabled</span>} title="Experiment worksheets">
        {experiments.length ? (
          <>
            <div className="worksheet-table-wrap hidden md:block">
              <table className="worksheet-table min-w-[980px]" data-testid="experiment-registry-worksheet">
                <thead><tr><th>Experiment</th><th>Lab / project</th><th>Status</th><th>Window</th><th>Operational contact</th><th>Version</th><th>Actions</th></tr></thead>
                <tbody>{experiments.map((experiment) => (
                  <tr key={experiment.id}>
                    <td><p className="worksheet-cell-strong">{experiment.experimentCode}</p><p className="worksheet-cell-muted">{experiment.title}</p></td>
                    <td>{experiment.labCode} · {experiment.projectCode}</td>
                    <td><Badge variant={statusVariant(experiment.status)}>{titleCase(experiment.status)}</Badge></td>
                    <td>{experiment.plannedStartAt ? formatDate(experiment.plannedStartAt) : "Not set"} → {experiment.plannedEndAt ? formatDate(experiment.plannedEndAt) : "Open"}</td>
                    <td>{experiment.operationalContact ?? experiment.ownerContact}</td>
                    <td>{experiment.version}</td>
                    <td>{canManage ? <ExperimentActions experiment={experiment} projectOptions={projectOptions} /> : <span className="text-xs text-[var(--muted)]">View only</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="worksheet-mobile-list md:hidden">{experiments.map((experiment) => (
              <MobileWorksheetCard
                actions={canManage ? <ExperimentActions experiment={experiment} projectOptions={projectOptions} /> : undefined}
                key={experiment.id}
                meta={<><span>{experiment.labCode}</span><Badge variant={statusVariant(experiment.status)}>{titleCase(experiment.status)}</Badge></>}
                title={<span className="inline-flex items-center gap-2"><PencilLine aria-hidden size={15} />{experiment.experimentCode} · {experiment.title}</span>}
              >
                <dl className="contents">
                  <div className="mobile-worksheet-field"><dt className="mobile-worksheet-label">Project</dt><dd className="mobile-worksheet-value">{experiment.projectCode}</dd></div>
                  <div className="mobile-worksheet-field"><dt className="mobile-worksheet-label">Version</dt><dd className="mobile-worksheet-value">{experiment.version}</dd></div>
                  <div className="mobile-worksheet-field mobile-worksheet-field-wide"><dt className="mobile-worksheet-label">Window</dt><dd className="mobile-worksheet-value">{experiment.plannedStartAt ? formatDate(experiment.plannedStartAt) : "Not set"} → {experiment.plannedEndAt ? formatDate(experiment.plannedEndAt) : "Open"}</dd></div>
                </dl>
              </MobileWorksheetCard>
            ))}</div>
          </>
        ) : <p className="px-4 py-5 text-sm text-[var(--muted)]">No experiments yet. Create the first planned worksheet above.</p>}
      </WorksheetShell>
    </div>
  );
}
