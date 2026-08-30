import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { BreedingLitterForm } from "@/components/app/breeding-litter-form";
import { BreedingStatusForm } from "@/components/app/breeding-status-form";
import { MobileWorksheetCard, RowActionMenu, WorksheetShell } from "@/components/app/worksheet-shell";
import { getAllowedBreedingTransitions } from "@/lib/breeding-state-machine";
import type { BreedingOverviewItem, BreedingSuggestionSummary } from "@/lib/breeding-read";
import type { BreedingSuggestion } from "@/lib/types";
import { formatDate } from "@/lib/utils";

type BreedingWorksheetProps = {
  breedings: BreedingOverviewItem[];
  canRecordLitter: boolean;
  defaultBirthDate: string;
  suggestions: BreedingSuggestionSummary[];
};

function getRuleBadgeVariant(severity: BreedingSuggestion["ruleSeverity"]) {
  if (severity === "critical") {
    return "danger";
  }

  return severity === "warning" ? "warning" : "neutral";
}

function getAdultLabel(breeding: BreedingOverviewItem, role: "sire" | "dam") {
  return breeding.adults.find((adult) => adult.role === role)?.animal?.animalId ?? "Not set";
}

function getLitterStatus(breeding: BreedingOverviewItem) {
  if (!breeding.litter) {
    return "No litter";
  }

  if (breeding.litter.litterSizeWean !== undefined) {
    return "Weaned";
  }

  if (breeding.litter.progenyCount > 0) {
    return "Progeny linked";
  }

  return "Born";
}

function getNextAction(breeding: BreedingOverviewItem) {
  if (breeding.status !== "active") {
    return "Monitor";
  }

  if (!breeding.litter) {
    return "Record litter";
  }

  if (breeding.litter.litterSizeWean === undefined && breeding.litter.progenyCount === 0) {
    return "Wean litter";
  }

  return "Review";
}

function Field({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "mobile-worksheet-field mobile-worksheet-field-wide" : "mobile-worksheet-field"}>
      <dt className="mobile-worksheet-label">{label}</dt>
      <dd className="mobile-worksheet-value">{value}</dd>
    </div>
  );
}

function BreedingRowActions({
  breeding,
  canRecordLitter,
  defaultBirthDate,
}: {
  breeding: BreedingOverviewItem;
  canRecordLitter: boolean;
  defaultBirthDate: string;
}) {
  const canRecord = canRecordLitter && breeding.status === "active";
  const canWean =
    canRecordLitter &&
    breeding.litter &&
    breeding.litter.litterSizeWean === undefined &&
    breeding.litter.progenyCount === 0;
  const progenyAlreadyLinked =
    breeding.litter &&
    breeding.litter.litterSizeWean === undefined &&
    breeding.litter.progenyCount > 0;
  const canTransition = canRecordLitter && getAllowedBreedingTransitions(breeding.status).length > 0;

  if (!canRecord && !canWean && !progenyAlreadyLinked && !canTransition) {
    return <span className="text-sm text-[var(--muted)]">No row action</span>;
  }

  return (
    <RowActionMenu label="Manage">
      {canRecord ? (
        <div className="space-y-2">
          <p className="metadata-label">Record litter</p>
          <BreedingLitterForm
            breedingSetupId={breeding.id}
            breedingSetupVersion={breeding.version}
            defaultBirthDate={defaultBirthDate}
          />
        </div>
      ) : null}
      {canWean && breeding.litter ? (
        <Link className="table-action inline-flex items-center gap-2" href={`/cages/intake?mode=wean&litterId=${breeding.litter.id}`}>
          Wean and plan cages <ArrowRight size={15} />
        </Link>
      ) : null}
      {progenyAlreadyLinked ? (
        <p className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--muted)]">
          Progeny records already exist for this litter.
        </p>
      ) : null}
      {canTransition ? (
        <div className="space-y-2 border-t border-[var(--line)] pt-3">
          <p className="metadata-label">Setup status</p>
          <BreedingStatusForm
            breedingSetupId={breeding.id}
            breedingSetupVersion={breeding.version}
            currentStatus={breeding.status}
            defaultDate={defaultBirthDate}
          />
        </div>
      ) : null}
    </RowActionMenu>
  );
}

export function BreedingWorksheet({
  breedings,
  canRecordLitter,
  defaultBirthDate,
  suggestions,
}: BreedingWorksheetProps) {
  return (
    <div className="space-y-5">
      <WorksheetShell
        eyebrow="Breeding setups"
        summary={<span>{breedings.length} setups</span>}
        title="Setup worksheet"
      >
        <div className="worksheet-table-wrap hidden md:block">
          <table className="worksheet-table min-w-[1120px]" data-testid="breeding-setup-worksheet">
            <thead>
              <tr>
                <th>Setup ID</th>
                <th>Status</th>
                <th>Sire</th>
                <th>Dam</th>
                <th>Target genotype</th>
                <th>Start</th>
                <th>Age</th>
                <th>Litter</th>
                <th>Birth</th>
                <th>Wean</th>
                <th>Progeny</th>
                <th>Next</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {breedings.map((breeding) => (
                <tr key={breeding.id} data-testid={`breeding-row-${breeding.id}`}>
                  <td className="worksheet-cell-strong">{breeding.id}</td>
                  <td>
                    <Badge variant={breeding.status === "active" ? "success" : "neutral"}>{breeding.status}</Badge>
                  </td>
                  <td>{getAdultLabel(breeding, "sire")}</td>
                  <td>{getAdultLabel(breeding, "dam")}</td>
                  <td className="worksheet-cell-muted max-w-[18rem]">{breeding.targetGenotype}</td>
                  <td>{formatDate(breeding.startDate)}</td>
                  <td>{breeding.ageDays} d</td>
                  <td>{getLitterStatus(breeding)}</td>
                  <td>{breeding.litter?.litterSizeBirth ?? "-"}{breeding.litter?.correction ? <span className="block text-xs font-semibold text-emerald-800" data-testid={`litter-correction-${breeding.litter.id}`}>Corrected · {breeding.litter.correction.requestId.slice(0, 12)}</span> : null}</td>
                  <td>{breeding.litter?.litterSizeWean ?? "-"}</td>
                  <td>{breeding.litter?.progenyCount ?? 0}</td>
                  <td className="whitespace-nowrap">{getNextAction(breeding)}</td>
                  <td>
                    <BreedingRowActions
                      breeding={breeding}
                      canRecordLitter={canRecordLitter}
                      defaultBirthDate={defaultBirthDate}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="worksheet-mobile-list md:hidden">
          {breedings.map((breeding) => (
            <MobileWorksheetCard
              actions={
                <BreedingRowActions
                  breeding={breeding}
                  canRecordLitter={canRecordLitter}
                  defaultBirthDate={defaultBirthDate}
                />
              }
              key={breeding.id}
              meta={
                <>
                  <span>{breeding.status}</span>
                  <span>{breeding.ageDays} d</span>
                  <span>{getNextAction(breeding)}</span>
                </>
              }
              title={breeding.id}
            >
              <dl className="contents">
                <Field label="Sire" value={getAdultLabel(breeding, "sire")} />
                <Field label="Dam" value={getAdultLabel(breeding, "dam")} />
                <Field label="Target" value={breeding.targetGenotype} wide />
                <Field label="Start" value={formatDate(breeding.startDate)} />
                <Field label="Litter" value={getLitterStatus(breeding)} />
                <Field label="Birth size" value={breeding.litter?.litterSizeBirth ?? "-"} />
                {breeding.litter?.correction ? <Field label="Correction" value={`Request ${breeding.litter.correction.requestId.slice(0, 12)}`} /> : null}
                <Field label="Wean size" value={breeding.litter?.litterSizeWean ?? "-"} />
                <Field label="Progeny" value={breeding.litter?.progenyCount ?? 0} />
              </dl>
            </MobileWorksheetCard>
          ))}
        </div>
      </WorksheetShell>

      <WorksheetShell
        eyebrow="Generator suggestions"
        summary={<span>{suggestions.length} ranked crosses</span>}
        title="Cross suggestions"
      >
        {suggestions.length ? (
          <>
            <div className="worksheet-table-wrap hidden md:block">
              <table className="worksheet-table min-w-[1040px]" data-testid="breeding-suggestion-worksheet">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Sire</th>
                    <th>Dam</th>
                    <th>Target chance</th>
                    <th>Pups needed</th>
                    <th>Expected litter</th>
                    <th>Usable pups</th>
                    <th>Surplus risk</th>
                    <th>Fertility model</th>
                    <th>Rules</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((suggestion, index) => (
                    <tr key={suggestion.id}>
                      <td className="worksheet-cell-strong">#{index + 1}</td>
                      <td>{suggestion.sireLabel}</td>
                      <td>{suggestion.damLabel}</td>
                      <td className="worksheet-cell-strong">{suggestion.probabilityLabel}</td>
                      <td>{suggestion.estimatedPupsNeeded}</td>
                      <td>{suggestion.expectedLitterSize}</td>
                      <td>{suggestion.expectedUsablePups}</td>
                      <td>
                        <Badge variant={suggestion.estimatedSurplusPups >= 4 ? "warning" : "success"}>
                          {suggestion.estimatedSurplusPups}
                        </Badge>
                      </td>
                      <td className="worksheet-cell-muted max-w-[22rem]">
                        <p className="font-medium text-[var(--ink)]">Model applied</p>
                        <details className="worksheet-row-details">
                          <summary>Model details</summary>
                          <p>{suggestion.lineFertilitySummary}</p>
                          <p>{suggestion.workloadSummary}</p>
                        </details>
                      </td>
                      <td className="worksheet-cell-muted max-w-[20rem]">
                        <Badge variant={getRuleBadgeVariant(suggestion.ruleSeverity)}>
                          {suggestion.ruleSeverity === "ok" ? "No genotype conflicts" : "Genotype risk"}
                        </Badge>
                        {suggestion.warnings.length ? (
                          <Badge className="ml-1" variant="warning">
                            {suggestion.warnings.length} {suggestion.warnings.length === 1 ? "caution" : "cautions"}
                          </Badge>
                        ) : null}
                        <details className="worksheet-row-details">
                          <summary>Rule details</summary>
                          <p>{suggestion.ruleSummary}</p>
                          {suggestion.warnings.length ? (
                            <ul>
                              {suggestion.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                            </ul>
                          ) : null}
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="worksheet-mobile-list md:hidden">
              {suggestions.map((suggestion, index) => (
                <MobileWorksheetCard
                  key={suggestion.id}
                  meta={
                    <>
                      <span>{suggestion.probabilityLabel}</span>
                      <span>{suggestion.estimatedPupsNeeded} pups</span>
                    </>
                  }
                  title={`#${index + 1} ${suggestion.sireLabel}`}
                >
                  <dl className="contents">
                    <Field label="Dam" value={suggestion.damLabel} />
                    <Field label="Litter" value={suggestion.expectedLitterSize} />
                    <Field label="Usable" value={suggestion.expectedUsablePups} />
                    <Field label="Surplus" value={suggestion.estimatedSurplusPups} />
                    <Field
                      label="Model"
                      wide
                      value={
                        <details className="worksheet-row-details">
                          <summary>Model applied</summary>
                          <p>{suggestion.lineFertilitySummary}</p>
                          <p>{suggestion.workloadSummary}</p>
                        </details>
                      }
                    />
                    <Field
                      label="Rules"
                      wide
                      value={
                        <div className="space-y-2">
                          <Badge variant={getRuleBadgeVariant(suggestion.ruleSeverity)}>
                            {suggestion.ruleSeverity === "ok" ? "No genotype conflicts" : "Genotype risk"}
                          </Badge>
                          {suggestion.warnings.length ? (
                            <details className="worksheet-row-details">
                              <summary>
                                {suggestion.warnings.length} {suggestion.warnings.length === 1 ? "caution" : "cautions"}
                              </summary>
                              <p>{suggestion.ruleSummary}</p>
                              <ul>
                                {suggestion.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                              </ul>
                            </details>
                          ) : (
                            <p className="text-sm text-[var(--muted)]">{suggestion.ruleSummary}</p>
                          )}
                        </div>
                      }
                    />
                  </dl>
                </MobileWorksheetCard>
              ))}
            </div>
          </>
        ) : (
          <p className="px-4 py-5 text-sm text-[var(--muted)]">No valid cross suggestions are available.</p>
        )}
      </WorksheetShell>
    </div>
  );
}
