import Link from "next/link";
import type { ReactNode } from "react";

import {
  ExperimentAssignmentBatchForm,
  ExperimentPlanSaveForm,
  VersionedPlannedAssignmentEditor,
} from "@/components/app/experiment-plan-save-form";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { MobileWorksheetCard, RowActionMenu, WorksheetShell } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ExperimentOverviewItem, getExperimentPlannerOptions } from "@/lib/experiments-read";
import type { ExperimentCandidate, ExperimentGroupSuggestion, ExperimentPlannerView } from "@/lib/types";
import { formatDate, titleCase } from "@/lib/utils";

type ExperimentPlannerOptions = Awaited<ReturnType<typeof getExperimentPlannerOptions>>;

type ExperimentsWorksheetProps = {
  overview: ExperimentOverviewItem[];
  options: ExperimentPlannerOptions;
  planner: ExperimentPlannerView;
};

function renderSelectionReason(reason: string) {
  if (reason.startsWith("siblings:")) {
    return "Unique sibling group retained";
  }

  return reason;
}

function renderAssignmentProvenance(action: string) {
  switch (action) {
    case "reserve":
      return "Reserved directly";
    case "plan":
      return "Planned from helper";
    case "promote_plan":
      return "Promoted from planned";
    case "demote_reservation":
      return "Rolled back to planned";
    case "update_plan":
      return "Planned entry updated";
    case "delete_plan":
      return "Planned entry removed";
    default:
      return titleCase(action.replaceAll("_", " "));
  }
}

function renderAllocationRisk(risk: ExperimentCandidate["allocationRisk"]) {
  switch (risk) {
    case "multi_project":
      return "Multi-project";
    case "unallocated":
      return "Unallocated";
    default:
      return "Allocated";
  }
}

function getAllocationBadgeVariant(risk: ExperimentCandidate["allocationRisk"]) {
  return risk === "none" ? "success" : "warning";
}

function getCandidateMap(candidates: ExperimentCandidate[]) {
  return new Map(candidates.map((candidate) => [candidate.animalId, candidate]));
}

function selectedCandidateRows(planner: ExperimentPlannerView) {
  const candidateMap = getCandidateMap(planner.candidates);

  return planner.selected
    .map((entry) => {
      const candidate = candidateMap.get(entry.animalId);

      return candidate ? { candidate, entry } : null;
    })
    .filter((row): row is { candidate: ExperimentCandidate; entry: ExperimentGroupSuggestion } => Boolean(row));
}

function alternateCandidateRows(planner: ExperimentPlannerView) {
  const candidateMap = getCandidateMap(planner.candidates);

  return planner.alternates
    .map((entry) => {
      const candidate = candidateMap.get(entry.animalId);

      return candidate ? { candidate, entry } : null;
    })
    .filter((row): row is { candidate: ExperimentCandidate; entry: ExperimentGroupSuggestion } => Boolean(row));
}

function Field({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "mobile-worksheet-field mobile-worksheet-field-wide" : "mobile-worksheet-field"}>
      <dt className="mobile-worksheet-label">{label}</dt>
      <dd className="mobile-worksheet-value">{value}</dd>
    </div>
  );
}

function PlannerToolbar({ options, planner }: { options: ExperimentPlannerOptions; planner: ExperimentPlannerView }) {
  return (
    <form className="space-y-3" data-testid="experiment-planner-filters" method="get">
      <div className="worksheet-filter-grid">
        <label>
          <span className="metadata-label">Desired</span>
          <input
            defaultValue={String(planner.filters.desiredNumber)}
            max={24}
            min={1}
            name="desiredNumber"
            type="number"
            data-testid="planner-desired-number"
          />
        </label>
        <label>
          <span className="metadata-label">Sex</span>
          <select defaultValue={planner.filters.desiredSex} name="sex" data-testid="planner-sex">
            <option value="either">Either</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </label>
        <label>
          <span className="metadata-label">Min age</span>
          <input
            defaultValue={String(planner.filters.minAgeDays)}
            max={365}
            min={14}
            name="minAgeDays"
            type="number"
            data-testid="planner-min-age"
          />
        </label>
        <label>
          <span className="metadata-label">Max age</span>
          <input
            defaultValue={String(planner.filters.maxAgeDays)}
            max={540}
            min={planner.filters.minAgeDays}
            name="maxAgeDays"
            type="number"
            data-testid="planner-max-age"
          />
        </label>
        <label>
          <span className="metadata-label">Genotype</span>
          <input
            defaultValue={planner.filters.genotypeKeyword}
            name="genotypeKeyword"
            placeholder="Cre, flox, tdTomato"
            type="text"
            data-testid="planner-genotype"
          />
        </label>
        <label>
          <span className="metadata-label">Strain</span>
          <select defaultValue={planner.filters.strainId ?? ""} name="strainId" data-testid="planner-strain">
            <option value="">Any strain</option>
            {options.strainOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="metadata-label">Project</span>
          <select defaultValue={planner.filters.projectId ?? ""} name="projectId" data-testid="planner-project">
            <option value="">Any project</option>
            {options.projectOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="metadata-label">Groups</span>
          <input
            defaultValue={String(planner.filters.groupCount)}
            max={6}
            min={2}
            name="groupCount"
            type="number"
            data-testid="planner-group-count"
          />
        </label>
        <label>
          <span className="metadata-label">Seed</span>
          <input
            defaultValue={planner.filters.randomSeed}
            name="randomSeed"
            placeholder="colony-balance"
            type="text"
            data-testid="planner-random-seed"
          />
        </label>
        <label>
          <span className="metadata-label">Cage/group</span>
          <input
            defaultValue={String(planner.filters.maxSameCagePerGroup)}
            max={6}
            min={1}
            name="maxSameCagePerGroup"
            type="number"
            data-testid="planner-max-same-cage"
          />
        </label>
      </div>
      <div className="action-row">
        {[
          ["includeReserved", "Include reserved", planner.filters.includeReserved],
          ["allowOverlap", "Allow overlap", planner.filters.allowOverlap],
          ["balanceByCage", "Balance cage", planner.filters.balanceByCage],
          ["avoidSiblingClustering", "Avoid siblings", planner.filters.avoidSiblingClustering],
          ["blockBySex", "Block sex", planner.filters.blockBySex],
          ["blockBySiblingGroup", "Block sibling", planner.filters.blockBySiblingGroup],
          ["balanceByAge", "Balance age", planner.filters.balanceByAge],
        ].map(([name, label, checked]) => (
          <label className="worksheet-filter-toggle action-chip text-[var(--ink)]" key={String(name)}>
            <input defaultChecked={Boolean(checked)} name={String(name)} type="checkbox" value="true" />
            <span>{label}</span>
          </label>
        ))}
        <Button className="relative z-10 min-h-11" type="submit" data-testid="planner-apply">
          Apply
        </Button>
        <Link className="action-chip" href="/experiments">
          Reset
        </Link>
        <Link className="action-chip" href="/animals">
          Animals
        </Link>
      </div>
    </form>
  );
}

function CohortWorksheet({ planner }: { planner: ExperimentPlannerView }) {
  const selectedRows = selectedCandidateRows(planner);

  return (
    <WorksheetShell
      eyebrow="Primary cohort"
      summary={<span>{planner.selected.length} selected / {planner.filters.desiredNumber} requested</span>}
      title="Selected animals"
    >
      {selectedRows.length ? (
        <>
          <div className="worksheet-table-wrap hidden md:block">
            <table className="worksheet-table min-w-[1120px]" data-testid="experiment-cohort-worksheet">
              <thead>
                <tr>
                  <th>Animal</th>
                  <th>Score</th>
                  <th>Rank</th>
                  <th>Sex</th>
                  <th>Age</th>
                  <th>Strain</th>
                  <th>Genotype</th>
                  <th>Cage</th>
                  <th>Allocation</th>
                  <th>Warnings</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {selectedRows.map(({ candidate, entry }) => (
                  <tr key={entry.animalId} data-testid="planner-selected-row">
                    <td className="worksheet-cell-strong">{candidate.animalId}</td>
                    <td>{entry.adjustedScore}</td>
                    <td>{entry.rank}</td>
                    <td>{titleCase(candidate.sex)}</td>
                    <td>{candidate.ageLabel}</td>
                    <td>{candidate.strain}</td>
                    <td className="worksheet-cell-muted worksheet-cell-mono max-w-[18rem]">{candidate.genotypeSummary}</td>
                    <td>{candidate.cageLabel}</td>
                    <td className="max-w-[16rem]">
                      <Badge variant={getAllocationBadgeVariant(candidate.allocationRisk)}>
                        {renderAllocationRisk(candidate.allocationRisk)}
                      </Badge>
                      <p className="mt-1 worksheet-cell-muted">{candidate.allocationSummary}</p>
                    </td>
                    <td className="worksheet-cell-muted max-w-[16rem]">
                      {candidate.warnings.length ? (
                        <span className="text-amber-900">{candidate.warnings.join(" · ")}</span>
                      ) : (
                        "None"
                      )}
                    </td>
                    <td className="worksheet-cell-muted max-w-[18rem]">
                      {entry.reasons.map(renderSelectionReason).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="worksheet-mobile-list md:hidden">
            {selectedRows.map(({ candidate, entry }) => (
              <MobileWorksheetCard
                key={entry.animalId}
                meta={
                  <>
                    <span>Rank {entry.rank}</span>
                    <span>Score {entry.adjustedScore}</span>
                  </>
                }
                title={candidate.animalId}
              >
                <dl className="contents">
                  <Field label="Sex" value={titleCase(candidate.sex)} />
                  <Field label="Age" value={candidate.ageLabel} />
                  <Field label="Strain" value={candidate.strain} wide />
                  <Field label="Genotype" value={candidate.genotypeSummary} wide />
                  <Field label="Cage" value={candidate.cageLabel} />
                  <Field label="Allocation" value={candidate.allocationSummary} wide />
                  <Field label="Reason" value={entry.reasons.map(renderSelectionReason).join(" · ")} wide />
                </dl>
              </MobileWorksheetCard>
            ))}
          </div>
        </>
      ) : (
        <p className="px-4 py-5 text-sm text-[var(--muted)]">
          No cohort selected. Widen the filter set or allow reserved animals.
        </p>
      )}
    </WorksheetShell>
  );
}

function TreatmentGroupWorksheet({ planner }: { planner: ExperimentPlannerView }) {
  type RandomizationGroup = ExperimentPlannerView["randomization"]["groups"][number];
  type RandomizationMember = RandomizationGroup["members"][number];
  const groupRows: Array<{ group: RandomizationGroup; member: RandomizationMember | null }> = [];

  for (const group of planner.randomization.groups) {
    if (group.members.length) {
      for (const member of group.members) {
        groupRows.push({ group, member });
      }
    } else {
      groupRows.push({ group, member: null });
    }
  }

  return (
    <WorksheetShell
      eyebrow="Groups"
      summary={<span>Seed {planner.randomization.seed}</span>}
      title="Treatment-arm layout"
    >
      <div className="chip-list border-b border-[var(--line)] px-3 py-2">
        {planner.randomization.strategy.map((step) => (
          <span className="value-chip" key={step}>
            {step}
          </span>
        ))}
      </div>
      <div className="worksheet-table-wrap hidden md:block">
        <table className="worksheet-table min-w-[980px]" data-testid="experiment-group-worksheet">
          <thead>
            <tr>
              <th>Group</th>
              <th>Animal</th>
              <th>Sex</th>
              <th>Age</th>
              <th>Age band</th>
              <th>Cage</th>
              <th>Genotype</th>
              <th>Group summary</th>
              <th>Warnings</th>
            </tr>
          </thead>
          <tbody>
            {groupRows.map(({ group, member }, index) => (
              <tr key={`${group.name}-${member?.animalId ?? "empty"}-${index}`}>
                <td className="worksheet-cell-strong">{group.name}</td>
                <td>{member?.animalId ?? "No member"}</td>
                <td>{member ? titleCase(member.sex) : "-"}</td>
                <td>{member?.ageLabel ?? "-"}</td>
                <td>{member?.ageBand ?? "-"}</td>
                <td>{member?.cageLabel ?? "-"}</td>
                <td className="worksheet-cell-muted worksheet-cell-mono max-w-[18rem]">
                  {member?.genotypeSummary ?? "-"}
                </td>
                <td className="worksheet-cell-muted max-w-[15rem]">
                  {group.summary.total} animals · {group.summary.males} male · {group.summary.females} female · avg{" "}
                  {group.summary.averageAgeDays} d · {group.summary.cageCount} cages
                </td>
                <td className="worksheet-cell-muted max-w-[18rem]">
                  {group.constraintWarnings.length ? (
                    <span className="text-amber-900">{group.constraintWarnings.join(" · ")}</span>
                  ) : (
                    "Clear"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="worksheet-mobile-list md:hidden">
        {groupRows.map(({ group, member }, index) => (
          <MobileWorksheetCard
            key={`${group.name}-${member?.animalId ?? "empty"}-${index}`}
            meta={
              <>
                <span>{group.summary.total} animals</span>
                <span>{group.summary.cageCount} cages</span>
              </>
            }
            title={`${group.name}: ${member?.animalId ?? "No member"}`}
          >
            <dl className="contents">
              <Field label="Sex" value={member ? titleCase(member.sex) : "-"} />
              <Field label="Age" value={member?.ageLabel ?? "-"} />
              <Field label="Cage" value={member?.cageLabel ?? "-"} wide />
              <Field label="Genotype" value={member?.genotypeSummary ?? "-"} wide />
              <Field label="Warnings" value={group.constraintWarnings.join(" · ") || "Clear"} wide />
            </dl>
          </MobileWorksheetCard>
        ))}
      </div>
    </WorksheetShell>
  );
}

function CandidateWorksheet({ planner }: { planner: ExperimentPlannerView }) {
  const alternates = alternateCandidateRows(planner);

  return (
    <WorksheetShell
      eyebrow="Ranked pool"
      summary={<span>{planner.candidates.length} candidates</span>}
      title="Candidates and alternates"
    >
      <div className="worksheet-table-wrap hidden md:block">
        <table className="worksheet-table min-w-[1120px]" data-testid="experiment-ranked-candidates">
          <thead>
            <tr>
              <th>Animal</th>
              <th>Score</th>
              <th>Selected rank</th>
              <th>Group</th>
              <th>Sex</th>
              <th>Age</th>
              <th>Strain</th>
              <th>Genotype</th>
              <th>Cage</th>
              <th>Allocation</th>
              <th>Warnings</th>
              <th>Inclusion reason</th>
            </tr>
          </thead>
          <tbody>
            {planner.candidates.slice(0, 16).map((candidate, index) => {
              const selectedEntry = planner.selected.find((entry) => entry.animalId === candidate.animalId);
              const group = planner.randomization.groups.find((item) =>
                item.members.some((member) => member.animalId === candidate.animalId),
              );

              return (
                <tr key={candidate.animalId}>
                  <td className="worksheet-cell-strong">{candidate.animalId}</td>
                  <td>{candidate.score}</td>
                  <td>{selectedEntry?.rank ?? index + 1}</td>
                  <td>{group?.name ?? (alternates.some((entry) => entry.candidate.animalId === candidate.animalId) ? "Alternate" : "-")}</td>
                  <td>{titleCase(candidate.sex)}</td>
                  <td>{candidate.ageLabel}</td>
                  <td>{candidate.strain}</td>
                  <td className="worksheet-cell-muted worksheet-cell-mono max-w-[18rem]">{candidate.genotypeSummary}</td>
                  <td>{candidate.cageLabel}</td>
                  <td className="max-w-[16rem]">
                    <Badge variant={getAllocationBadgeVariant(candidate.allocationRisk)}>
                      {renderAllocationRisk(candidate.allocationRisk)}
                    </Badge>
                    <p className="mt-1 worksheet-cell-muted">{candidate.allocationSummary}</p>
                  </td>
                  <td className="worksheet-cell-muted max-w-[16rem]">
                    {candidate.warnings.length ? (
                      <span className="text-amber-900">{candidate.warnings.join(" · ")}</span>
                    ) : (
                      "None"
                    )}
                  </td>
                  <td className="worksheet-cell-muted max-w-[16rem]">{candidate.inclusionReason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="worksheet-mobile-list md:hidden">
        {planner.candidates.slice(0, 16).map((candidate) => (
          <MobileWorksheetCard
            key={candidate.animalId}
            meta={
              <>
                <span>Score {candidate.score}</span>
                <span>{candidate.ageLabel}</span>
              </>
            }
            title={candidate.animalId}
          >
            <dl className="contents">
              <Field label="Sex" value={titleCase(candidate.sex)} />
              <Field label="Strain" value={candidate.strain} />
              <Field label="Genotype" value={candidate.genotypeSummary} wide />
              <Field label="Cage" value={candidate.cageLabel} />
              <Field label="Allocation" value={candidate.allocationSummary} wide />
              <Field label="Warnings" value={candidate.warnings.join(" · ") || "None"} wide />
            </dl>
          </MobileWorksheetCard>
        ))}
      </div>
    </WorksheetShell>
  );
}

function ExclusionWorksheet({ planner }: { planner: ExperimentPlannerView }) {
  return (
    <WorksheetShell
      eyebrow="Excluded by filter"
      summary={<span>{planner.exclusions.length} buckets</span>}
      title="Exclusions"
    >
      {planner.exclusions.length ? (
        <>
          <div className="worksheet-table-wrap hidden md:block">
            <table className="worksheet-table min-w-[720px]" data-testid="experiment-exclusions">
              <thead>
                <tr>
                  <th>Reason</th>
                  <th>Severity</th>
                  <th>Count</th>
                  <th>Examples</th>
                </tr>
              </thead>
              <tbody>
                {planner.exclusions.map((item) => (
                  <tr key={item.reason}>
                    <td className="worksheet-cell-strong">{item.reason}</td>
                    <td>
                      <Badge variant={item.severity === "warning" ? "warning" : "neutral"}>{item.severity}</Badge>
                    </td>
                    <td>{item.count}</td>
                    <td className="worksheet-cell-muted">{item.exampleAnimalIds.join(", ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="worksheet-mobile-list md:hidden">
            {planner.exclusions.map((item) => (
              <MobileWorksheetCard key={item.reason} meta={<span>{item.count} animals</span>} title={item.reason}>
                <dl className="contents">
                  <Field label="Severity" value={item.severity} />
                  <Field label="Examples" value={item.exampleAnimalIds.join(", ") || "-"} wide />
                </dl>
              </MobileWorksheetCard>
            ))}
          </div>
        </>
      ) : (
        <p className="px-4 py-5 text-sm text-[var(--muted)]">No exclusions were triggered.</p>
      )}
    </WorksheetShell>
  );
}

function AssignmentActions({ overview }: { overview: ExperimentOverviewItem[] }) {
  const experimentsWithPlanned = overview
    .map((experiment) => ({
      experiment,
      plannedAssignments: experiment.assignments
        .filter((assignment) => assignment.status === "planned")
        .map((assignment) => ({ assignmentId: assignment.id, expectedVersion: assignment.version })),
      promotedAssignments: experiment.assignments
        .filter((assignment) => assignment.status === "reserved" && assignment.provenance?.action === "promote_plan")
        .map((assignment) => ({ assignmentId: assignment.id, expectedVersion: assignment.version })),
    }))
    .filter((item) => item.plannedAssignments.length > 0 || item.promotedAssignments.length > 0);

  if (!experimentsWithPlanned.length) {
    return null;
  }

  return (
    <>
      {experimentsWithPlanned.map(({ experiment, plannedAssignments, promotedAssignments }) => (
        <RowActionMenu key={experiment.id} label={experiment.experimentCode} tone="warning">
          {plannedAssignments.length > 0 ? (
            <ExperimentAssignmentBatchForm
              action="promote"
              assignments={plannedAssignments}
              expectedExperimentVersion={experiment.version}
              experimentId={experiment.id}
              experimentLabel={experiment.experimentCode}
            />
          ) : null}
          {promotedAssignments.length > 0 ? (
            <ExperimentAssignmentBatchForm
              action="demote"
              assignments={promotedAssignments}
              expectedExperimentVersion={experiment.version}
              experimentId={experiment.id}
              experimentLabel={experiment.experimentCode}
            />
          ) : null}
        </RowActionMenu>
      ))}
    </>
  );
}

function AssignmentWorksheet({ overview }: { overview: ExperimentOverviewItem[] }) {
  const rows = overview.flatMap((experiment) =>
    experiment.assignments.map((assignment) => ({
      assignment,
      experiment,
    })),
  );

  return (
    <WorksheetShell
      actions={<AssignmentActions overview={overview} />}
      eyebrow="Experiment overview"
      summary={<span>{rows.length} assignments</span>}
      title="Assignments"
    >
      {rows.length ? (
        <>
          <div className="worksheet-table-wrap hidden md:block">
            <table className="worksheet-table min-w-[1120px]" data-testid="experiment-assignments-worksheet">
              <thead>
                <tr>
                  <th>Experiment</th>
                  <th>Animal</th>
                  <th>Status</th>
                  <th>Treatment group</th>
                  <th>Start date</th>
                  <th>Notes</th>
                  <th>Provenance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ assignment, experiment }) => (
                  <tr key={assignment.id} data-testid={`experiment-assignment-${assignment.id}`}>
                    <td className="max-w-[14rem]">
                      <p className="worksheet-cell-strong">{experiment.experimentCode}</p>
                      <p className="worksheet-cell-muted">{experiment.title}</p>
                      <p className="worksheet-cell-muted">{experiment.projectCode}</p>
                    </td>
                    <td className="worksheet-cell-strong">{assignment.animalId}</td>
                    <td>{assignment.status}</td>
                    <td>{assignment.treatmentGroup ?? "No group"}</td>
                    <td>{formatDate(assignment.startDate)}</td>
                    <td className="worksheet-cell-muted max-w-[16rem]">{assignment.notes ?? "None"}</td>
                    <td className="worksheet-cell-muted max-w-[18rem]">
                      {assignment.provenance ? (
                        <>
                          {renderAssignmentProvenance(assignment.provenance.action)}
                          {assignment.provenance.actorName ? ` by ${assignment.provenance.actorName}` : ""}
                          {` · ${formatDate(assignment.provenance.timestamp)}`}
                        </>
                      ) : (
                        "None"
                      )}
                    </td>
                    <td>
                      {assignment.status === "planned" ? (
                        <RowActionMenu label="Edit">
                          <VersionedPlannedAssignmentEditor
                            animalId={assignment.animalId}
                            assignmentId={assignment.id}
                            expectedAssignmentVersion={assignment.version}
                            expectedExperimentVersion={experiment.version}
                            experimentId={experiment.id}
                            experimentLabel={experiment.experimentCode}
                            notes={assignment.notes}
                            startDate={assignment.startDate}
                            treatmentGroup={assignment.treatmentGroup}
                          />
                        </RowActionMenu>
                      ) : (
                        <span className="text-sm text-[var(--muted)]">Locked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="worksheet-mobile-list md:hidden">
            {rows.map(({ assignment, experiment }) => (
              <MobileWorksheetCard
                actions={
                  assignment.status === "planned" ? (
                    <RowActionMenu label="Edit">
                      <VersionedPlannedAssignmentEditor
                        animalId={assignment.animalId}
                        assignmentId={assignment.id}
                        expectedAssignmentVersion={assignment.version}
                        expectedExperimentVersion={experiment.version}
                        experimentId={experiment.id}
                        experimentLabel={experiment.experimentCode}
                        notes={assignment.notes}
                        startDate={assignment.startDate}
                        treatmentGroup={assignment.treatmentGroup}
                      />
                    </RowActionMenu>
                  ) : null
                }
                key={assignment.id}
                meta={
                  <>
                    <span>{experiment.experimentCode}</span>
                    <span>{assignment.status}</span>
                  </>
                }
                title={assignment.animalId}
              >
                <dl className="contents">
                  <Field label="Experiment" value={experiment.title} wide />
                  <Field label="Group" value={assignment.treatmentGroup ?? "No group"} />
                  <Field label="Start" value={formatDate(assignment.startDate)} />
                  <Field label="Notes" value={assignment.notes ?? "None"} wide />
                  <Field
                    label="Provenance"
                    value={
                      assignment.provenance
                        ? `${renderAssignmentProvenance(assignment.provenance.action)} · ${formatDate(
                            assignment.provenance.timestamp,
                          )}`
                        : "None"
                    }
                    wide
                  />
                </dl>
              </MobileWorksheetCard>
            ))}
          </div>
        </>
      ) : (
        <p className="px-4 py-5 text-sm text-[var(--muted)]">No experiment assignments recorded.</p>
      )}
    </WorksheetShell>
  );
}

export function ExperimentsWorksheet({ overview, options, planner }: ExperimentsWorksheetProps) {
  const renderedAssignments = planner.randomization.groups.flatMap((group) =>
    group.members.map((member) => ({ animalId: member.animalId, treatmentGroup: group.name })),
  );
  const saveActions: CompactActionItem[] = [
    {
      id: "save-cohort",
      label: "Save cohort",
      description: "Write selected rows",
      tone: "primary",
      panel: (
        <ExperimentPlanSaveForm
          assignments={renderedAssignments}
          experimentOptions={options.experimentOptions}
          filters={planner.filters}
        />
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <WorksheetShell
        eyebrow="Planner"
        summary={
          <>
            <span>{planner.summary.totalReviewed} reviewed</span>
            <span>{planner.summary.included} included</span>
            <span>{planner.summary.excluded} excluded</span>
          </>
        }
        title="Selection filters"
        toolbar={<PlannerToolbar options={options} planner={planner} />}
      >
        <div className="px-3 py-2">
          <CompactActionTray
            actions={saveActions}
            className="border-0 bg-transparent p-0 shadow-none"
            summary={<span>{planner.selected.length} rows ready</span>}
            title="Planner actions"
          />
        </div>
      </WorksheetShell>
      <CohortWorksheet planner={planner} />
      <TreatmentGroupWorksheet planner={planner} />
      <CandidateWorksheet planner={planner} />
      <ExclusionWorksheet planner={planner} />
      <AssignmentWorksheet overview={overview} />
    </div>
  );
}
