import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app/app-shell";
import { HighImpactWorkflowShell } from "@/components/app/high-impact-workflow-shell";
import { PageHeader } from "@/components/app/page-header";
import { QuarantineOperations, QuarantineReleaseWorkflow } from "@/components/app/quarantine-operations";
import { StatStrip } from "@/components/app/stat-strip";
import { MobileWorksheetCard, WorksheetShell } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import { getQuarantineCaseActionView, getQuarantineSentinelView } from "@/lib/quarantine-read";
import { requireUser } from "@/lib/session";
import { formatDate, titleCase } from "@/lib/utils";

function boolLabel(value: boolean) {
  return value ? "due" : "current";
}

function Field({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "mobile-worksheet-field mobile-worksheet-field-wide" : "mobile-worksheet-field"}>
      <dt className="mobile-worksheet-label">{label}</dt>
      <dd className="mobile-worksheet-value">{value}</dd>
    </div>
  );
}

export default async function QuarantinePage({ searchParams }: { searchParams: Promise<{ caseId?: string; action?: string }> }) {
  const user = await requireUser({ capability: "quarantine:read" });
  const query = await searchParams;
  const view = await getQuarantineSentinelView(user);
  const actionCase = query.action === "release" && query.caseId ? await getQuarantineCaseActionView(user, query.caseId) : null;
  const selectedCage = view.cages.find((cage) => cage.quarantineCase?.id === query.caseId) ?? null;
  const selectedCase = selectedCage?.quarantineCase
    ? {
        id: selectedCage.quarantineCase.id,
        version: selectedCage.quarantineCase.version,
        status: selectedCage.quarantineCase.status,
        cageLabel: selectedCage.label,
        minimumReleaseAt: selectedCage.quarantineCase.minimumReleaseAt,
        latestObservationResult: selectedCage.quarantineCase.latestObservation?.result ?? null,
        openFollowupCount: selectedCage.quarantineCase.openFollowupCount,
        occupants: selectedCage.occupants,
      }
    : null;
  const canManage = user.capabilities.includes("quarantine:manage");
  const canFinalize = user.canonicalRole === "facility_admin" || user.canonicalRole === "cmu_staff";
  const occupants = view.cages.flatMap((cage) =>
    cage.occupants.map((animal) => ({
      ...animal,
      cageId: cage.id,
      cageLabel: cage.label,
      cageBarcode: cage.barcode,
    })),
  );

  if (query.action === "release") {
    if (!canManage || !canFinalize || !actionCase) notFound();
    if (actionCase.status !== "release_requested" && actionCase.status !== "released") notFound();
    const destinations = view.releaseDestinations.filter((cage) => cage.labId === actionCase.labId);
    return (
      <AppShell currentPath="/quarantine" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
        <HighImpactWorkflowShell
          backHref={`/quarantine?caseId=${actionCase.id}`}
          backLabel="Quarantine queue"
          context={[
            { label: "Cage", value: actionCase.cageLabel },
            { label: "Animals", value: actionCase.occupants.length },
            { label: "Minimum release", value: actionCase.minimumReleaseAt.slice(0, 10) },
            { label: "Open follow-ups", value: actionCase.openFollowupCount },
          ]}
          description="Review the release date, reason, every animal destination, and receiving-cage capacity before moving the cohort."
          title={`Release ${actionCase.cageLabel} from quarantine`}
        >
          {actionCase.status === "release_requested" ? <QuarantineReleaseWorkflow destinations={destinations} nonce={randomUUID()} selectedCase={actionCase} today={view.rules.today.slice(0, 10)} /> : <div className="worksheet-empty"><strong>Quarantine release complete</strong><p>This case is {actionCase.status.replaceAll("_", " ")} and no longer awaits finalization.</p><Link className="table-action" href="/quarantine">Return to quarantine queue</Link></div>}
        </HighImpactWorkflowShell>
      </AppShell>
    );
  }

  return (
    <AppShell currentPath="/quarantine" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader eyebrow="Quarantine" title="Quarantine" />
        <StatStrip
          stats={[
            { label: "Quarantine cages", value: view.summary.quarantineCages, emphasis: "info" },
            { label: "Animals", value: view.summary.quarantineAnimals, emphasis: "neutral" },
            { label: "Sentinel due", value: view.summary.sentinelDue, emphasis: view.summary.sentinelDue ? "warning" : "success" },
            { label: "Review due", value: view.summary.reviewDue, emphasis: view.summary.reviewDue ? "warning" : "success" },
            { label: "Open follow-up", value: view.summary.openFollowups, emphasis: "warning" },
            { label: "Critical", value: view.summary.criticalConcerns, emphasis: view.summary.criticalConcerns ? "danger" : "success" },
          ]}
        />
        {canManage ? (
          <QuarantineOperations
            cages={view.cages.filter((cage) => !cage.quarantineCase).map((cage) => ({ id: cage.id, label: `${cage.label} · ${cage.barcode}`, version: cage.version }))}
            holdDays={view.rules.quarantineReviewDays}
            nonce={randomUUID()}
            canFinalize={canFinalize}
            selectedCase={selectedCase}
            today={view.rules.today.slice(0, 10)}
          />
        ) : null}
        <WorksheetShell
          actions={
            <Link className="action-chip" href="/cages">
              Cage list
            </Link>
          }
          eyebrow="Worksheet"
          summary={<span>{view.cages.length} quarantine cages</span>}
          title="Cage queue"
        >
          <div className="worksheet-table-wrap hidden md:block" data-testid="quarantine-cage-list">
            <table className="worksheet-table min-w-[1040px]">
              <thead>
                <tr>
                  <th>Cage</th>
                  <th>Barcode</th>
                  <th>Occupants</th>
                  <th>Case</th>
                  <th>Last check</th>
                  <th>Sentinel</th>
                  <th>Review</th>
                  <th>Follow-up</th>
                  <th>Latest note</th>
                  <th>Flags</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {view.cages.map((cage) => (
                  <tr key={cage.id} data-testid={`quarantine-cage-${cage.id}`}>
                    <td className="worksheet-cell-strong">{cage.label}</td>
                    <td className="worksheet-cell-mono">{cage.barcode}</td>
                    <td>{cage.occupantCount}</td>
                    <td><Badge variant={cage.quarantineCase?.status === "exception_open" ? "danger" : cage.quarantineCase?.status === "release_requested" ? "warning" : cage.quarantineCase ? "info" : "neutral"}>{cage.quarantineCase?.status.replaceAll("_", " ") ?? "untracked"}</Badge></td>
                    <td>{cage.daysSinceLastCheck === null ? "No note" : `${cage.daysSinceLastCheck} d ago`}</td>
                    <td>
                      <Badge variant={cage.sentinelDue ? "warning" : "success"}>{boolLabel(cage.sentinelDue)}</Badge>
                    </td>
                    <td>
                      <Badge variant={cage.reviewDue ? "warning" : "success"}>{boolLabel(cage.reviewDue)}</Badge>
                    </td>
                    <td>{cage.unresolvedNoteCount}</td>
                    <td className="worksheet-cell-muted max-w-[22rem]">
                      {cage.latestNote ? (
                        <>
                          <Badge
                            variant={
                              cage.latestNote.severity === "critical"
                                ? "danger"
                                : cage.latestNote.severity === "warning"
                                  ? "warning"
                                  : "info"
                            }
                          >
                            {cage.latestNote.severity}
                          </Badge>
                          <p className="mt-1">
                            {cage.latestNote.noteType.replaceAll("_", " ")} · {formatDate(cage.latestNote.createdAt)}
                          </p>
                          <p className="mt-1">{cage.latestNote.note}</p>
                        </>
                      ) : (
                        "None"
                      )}
                    </td>
                    <td className="worksheet-cell-muted max-w-[14rem]">{cage.welfareFlags.join(", ") || "None"}</td>
                    <td>
                      <div className="flex flex-wrap gap-2"><Link className="table-action" href={`/cages/${cage.id}`}>Open</Link>{cage.quarantineCase ? <Link className="table-action" data-testid={`quarantine-manage-${cage.quarantineCase.id}`} href={`/quarantine?caseId=${cage.quarantineCase.id}`}>Manage</Link> : null}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="worksheet-mobile-list md:hidden">
            {view.cages.map((cage) => (
              <MobileWorksheetCard
                actions={
                  <div className="flex gap-2"><Link className="table-action" href={`/cages/${cage.id}`}>Open</Link>{cage.quarantineCase ? <Link className="table-action" href={`/quarantine?caseId=${cage.quarantineCase.id}`}>Manage</Link> : null}</div>
                }
                key={cage.id}
                meta={
                  <>
                    <span>{cage.barcode}</span>
                    <span>{cage.occupantCount} occupants</span>
                  </>
                }
                title={cage.label}
              >
                <dl className="contents">
                  <Field label="Last check" value={cage.daysSinceLastCheck === null ? "No note" : `${cage.daysSinceLastCheck} d ago`} />
                  <Field label="Follow-up" value={`${cage.unresolvedNoteCount} open`} />
                  <Field label="Case" value={cage.quarantineCase?.status.replaceAll("_", " ") ?? "Untracked"} />
                  <Field label="Sentinel" value={boolLabel(cage.sentinelDue)} />
                  <Field label="Review" value={boolLabel(cage.reviewDue)} />
                  <Field label="Latest note" value={cage.latestNote?.note ?? "None"} wide />
                  <Field label="Flags" value={cage.welfareFlags.join(", ") || "None"} wide />
                </dl>
              </MobileWorksheetCard>
            ))}
          </div>
        </WorksheetShell>
        <WorksheetShell
          eyebrow="Worksheet"
          summary={<span>{occupants.length} occupants</span>}
          title="Occupants"
        >
          {occupants.length ? (
            <>
              <div className="worksheet-table-wrap hidden md:block">
                <table className="worksheet-table min-w-[720px]">
                  <thead>
                    <tr>
                      <th>Animal</th>
                      <th>Sex</th>
                      <th>Strain</th>
                      <th>Cage</th>
                      <th>Barcode</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {occupants.map((animal) => (
                      <tr key={animal.id}>
                        <td className="worksheet-cell-strong">{animal.animalId}</td>
                        <td>{titleCase(animal.sex)}</td>
                        <td>{animal.strain}</td>
                        <td>{animal.cageLabel}</td>
                        <td className="worksheet-cell-mono">{animal.cageBarcode}</td>
                        <td>
                          <Link className="table-action" href={`/animals/${animal.id}`}>
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="worksheet-mobile-list md:hidden">
                {occupants.map((animal) => (
                  <MobileWorksheetCard
                    actions={
                      <Link className="table-action" href={`/animals/${animal.id}`}>
                        Open
                      </Link>
                    }
                    key={animal.id}
                    meta={
                      <>
                        <span>{titleCase(animal.sex)}</span>
                        <span>{animal.cageBarcode}</span>
                      </>
                    }
                    title={animal.animalId}
                  >
                    <dl className="contents">
                      <Field label="Strain" value={animal.strain} />
                      <Field label="Cage" value={animal.cageLabel} wide />
                    </dl>
                  </MobileWorksheetCard>
                ))}
              </div>
            </>
          ) : (
            <p className="px-4 py-5 text-sm text-[var(--muted)]">No live quarantine occupants.</p>
          )}
        </WorksheetShell>
        <WorksheetShell
          actions={
            <Link className="action-chip" href="/settings">
              Edit thresholds
            </Link>
          }
          eyebrow="Rules"
          summary={<span>{view.rules.sentinelCheckIntervalDays}d sentinel · {view.rules.quarantineReviewDays}d review</span>}
          title="Sentinel rules"
        >
          <div className="worksheet-table-wrap hidden md:block">
            <table className="worksheet-table min-w-[480px]">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="worksheet-cell-strong">Sentinel interval</td>
                  <td>{view.rules.sentinelCheckIntervalDays} days between checks</td>
                </tr>
                <tr>
                  <td className="worksheet-cell-strong">Quarantine review</td>
                  <td>{view.rules.quarantineReviewDays} days before manager review</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="worksheet-mobile-list md:hidden">
            <MobileWorksheetCard
              meta={<span>Facility threshold</span>}
              title="Sentinel interval"
            >
              <dl className="contents">
                <Field label="Value" value={`${view.rules.sentinelCheckIntervalDays} days between checks`} wide />
              </dl>
            </MobileWorksheetCard>
            <MobileWorksheetCard
              meta={<span>Manager threshold</span>}
              title="Quarantine review"
            >
              <dl className="contents">
                <Field label="Value" value={`${view.rules.quarantineReviewDays} days before manager review`} wide />
              </dl>
            </MobileWorksheetCard>
          </div>
        </WorksheetShell>
      </div>
    </AppShell>
  );
}
