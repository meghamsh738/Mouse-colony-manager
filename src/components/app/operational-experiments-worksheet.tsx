import Link from "next/link";

import { MobileWorksheetCard, WorksheetShell } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import type { ExperimentOverviewItem } from "@/lib/experiments-read";
import { formatDate, titleCase } from "@/lib/utils";

function statusVariant(status: string) {
  if (status === "active") return "success" as const;
  if (status === "planned") return "info" as const;
  if (status === "cancelled") return "danger" as const;
  return "neutral" as const;
}

function valueOrDash(value: string | null) {
  return value?.trim() || "—";
}

export function OperationalExperimentsWorksheet({ overview }: { overview: ExperimentOverviewItem[] }) {
  const assignments = overview.flatMap((experiment) =>
    experiment.assignments.map((assignment) => ({ experiment, assignment })),
  );

  return (
    <div className="space-y-5" data-testid="operational-experiments-workspace">
      <WorksheetShell
        eyebrow="Operational schedule"
        summary={(
          <>
            <span>{overview.length} experiments</span>
            <span>{assignments.length} animals</span>
          </>
        )}
        title="Facility work"
      >
        {overview.length ? (
          <>
            <div className="worksheet-table-wrap hidden md:block">
              <table className="worksheet-table min-w-[1120px]">
                <thead>
                  <tr>
                    <th>Experiment</th>
                    <th>Lab</th>
                    <th>Status</th>
                    <th>Schedule</th>
                    <th>Procedures</th>
                    <th>Treatments</th>
                    <th>Welfare</th>
                    <th>Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.map((experiment) => (
                    <tr key={experiment.id}>
                      <td>
                        <p className="worksheet-cell-strong">{experiment.experimentCode}</p>
                        <p className="worksheet-cell-muted">{experiment.title}</p>
                        <p className="worksheet-cell-muted">{experiment.projectCode}</p>
                      </td>
                      <td>{experiment.labCode}</td>
                      <td><Badge variant={statusVariant(experiment.status)}>{titleCase(experiment.status)}</Badge></td>
                      <td className="max-w-[15rem]">
                        <p>{experiment.plannedStartAt ? formatDate(experiment.plannedStartAt) : "Not scheduled"}</p>
                        <p className="worksheet-cell-muted">{valueOrDash(experiment.scheduleNotes)}</p>
                      </td>
                      <td className="max-w-[16rem]">{valueOrDash(experiment.procedureSummary)}</td>
                      <td className="max-w-[16rem]">{valueOrDash(experiment.treatmentSummary)}</td>
                      <td className="max-w-[16rem]">{valueOrDash(experiment.welfareRisks)}</td>
                      <td className="max-w-[14rem]">{valueOrDash(experiment.operationalContact ?? experiment.ownerContact)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="worksheet-mobile-list md:hidden">
              {overview.map((experiment) => (
                <MobileWorksheetCard
                  key={experiment.id}
                  meta={<><span>{experiment.labCode}</span><span>{titleCase(experiment.status)}</span></>}
                  title={experiment.experimentCode}
                >
                  <dl className="metadata-grid">
                    <div><dt className="metadata-label">Title</dt><dd className="wrap-value">{experiment.title}</dd></div>
                    <div><dt className="metadata-label">Start</dt><dd>{experiment.plannedStartAt ? formatDate(experiment.plannedStartAt) : "Not scheduled"}</dd></div>
                    <div><dt className="metadata-label">Procedures</dt><dd className="wrap-value">{valueOrDash(experiment.procedureSummary)}</dd></div>
                    <div><dt className="metadata-label">Treatments</dt><dd className="wrap-value">{valueOrDash(experiment.treatmentSummary)}</dd></div>
                    <div><dt className="metadata-label">Welfare</dt><dd className="wrap-value">{valueOrDash(experiment.welfareRisks)}</dd></div>
                    <div><dt className="metadata-label">Contact</dt><dd className="wrap-value">{experiment.operationalContact ?? experiment.ownerContact}</dd></div>
                  </dl>
                </MobileWorksheetCard>
              ))}
            </div>
          </>
        ) : (
          <p className="px-4 py-5 text-sm text-[var(--muted)]">No planned or active experiment work is visible.</p>
        )}
      </WorksheetShell>

      <WorksheetShell eyebrow="Animals" summary={<span>{assignments.length} assignments</span>} title="Operational assignments">
        {assignments.length ? (
          <div className="record-list">
            {assignments.map(({ experiment, assignment }) => (
              <div className="record-card" key={assignment.id}>
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--ink)]">{assignment.animalId}</p>
                  <p className="wrap-value text-sm text-[var(--muted)]">
                    {experiment.experimentCode} · {assignment.treatmentGroup ?? "No treatment group"}
                  </p>
                </div>
                <div className="metadata-grid">
                  <div><span className="metadata-label">Cage</span><p className="wrap-value">{assignment.cageLocation ?? "Unassigned"}</p></div>
                  <div><span className="metadata-label">Start</span><p>{formatDate(assignment.startDate)}</p></div>
                  <div><span className="metadata-label">Status</span><p>{titleCase(assignment.status)}</p></div>
                </div>
                <div className="action-row">
                  {assignment.cageBarcode ? <Link className="action-chip" href={`/scan/${assignment.cageBarcode}`}>Scan cage</Link> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-5 text-sm text-[var(--muted)]">No animal assignments are scheduled.</p>
        )}
      </WorksheetShell>
    </div>
  );
}
