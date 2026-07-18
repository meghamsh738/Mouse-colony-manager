import Link from "next/link";
import { Filter, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { StatStrip } from "@/components/app/stat-strip";
import { Surface } from "@/components/app/surface";
import { MobileWorksheetCard, WorksheetShell } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import { getForecastWorkspaceView, type ForecastFilters, type ForecastWorkspaceView } from "@/lib/forecast-read";
import { requireUser } from "@/lib/session";

type DemandView = ForecastWorkspaceView["surplus"];

function Field({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "mobile-worksheet-field mobile-worksheet-field-wide" : "mobile-worksheet-field"}>
      <dt className="mobile-worksheet-label">{label}</dt>
      <dd className="mobile-worksheet-value">{value}</dd>
    </div>
  );
}

function DemandWorksheet({ title, view }: { title: string; view: DemandView }) {
  return (
    <WorksheetShell
      eyebrow={`${view.horizonDays} day horizon`}
      summary={
        <>
          <span>{view.demandAnimals} demand</span>
          <span>{view.projectedUsableSupply} usable supply</span>
          <span>{view.supplyGap} gap</span>
        </>
      }
      title={title}
      toolbar={
        <div className="chip-list">
          <span className="value-chip">Available {view.availableSupply}</span>
          <span className="value-chip">Surplus {view.surplusAfterDemand}</span>
          <span className="value-chip">Projected pups {view.projectedSurplusPups}</span>
          {view.recommendations.map((recommendation) => (
            <span className="value-chip" key={recommendation}>
              {recommendation}
            </span>
          ))}
        </div>
      }
    >
      {view.demandItems.length ? (
        <>
          <div className="worksheet-table-wrap hidden md:block">
            <table className="worksheet-table min-w-[1180px]">
              <thead>
                <tr>
                  <th>Experiment</th>
                  <th>Project</th>
                  <th>Lab</th>
                  <th>Cages</th>
                  <th>Responsible</th>
                  <th>Start</th>
                  <th>Requested</th>
                  <th>Planned</th>
                  <th>Reserved</th>
                  <th>Active</th>
                  <th>Gap</th>
                </tr>
              </thead>
              <tbody>
                {view.demandItems.map((item) => (
                  <tr key={item.experimentId}>
                    <td>
                      <p className="worksheet-cell-strong">{item.experimentCode}</p>
                      <p className="worksheet-cell-muted">{item.title}</p>
                    </td>
                    <td>{item.projectCode}</td>
                    <td className="worksheet-cell-muted max-w-[12rem]">{item.labLabel}</td>
                    <td className="worksheet-cell-muted max-w-[16rem]">{item.cageLabels.join(", ") || "Unassigned"}</td>
                    <td className="worksheet-cell-muted max-w-[14rem]">{item.responsibleUserNames.join(", ") || "Unassigned"}</td>
                    <td>{item.startLabel}</td>
                    <td>{item.requestedAnimals}</td>
                    <td>{item.plannedAnimals}</td>
                    <td>{item.reservedAnimals}</td>
                    <td>{item.activeAnimals}</td>
                    <td>
                      <Badge variant={item.supplyGap > 0 ? "warning" : "success"}>{item.supplyGap}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="worksheet-mobile-list md:hidden">
            {view.demandItems.map((item) => (
              <MobileWorksheetCard
                key={item.experimentId}
                meta={
                  <>
                    <span>{item.projectCode}</span>
                    <span>{item.startLabel}</span>
                  </>
                }
                title={item.experimentCode}
              >
                <dl className="contents">
                  <Field label="Requested" value={item.requestedAnimals} />
                  <Field label="Lab" value={item.labLabel} />
                  <Field label="Cages" value={item.cageLabels.join(", ") || "Unassigned"} wide />
                  <Field label="Responsible" value={item.responsibleUserNames.join(", ") || "Unassigned"} wide />
                  <Field label="Planned" value={item.plannedAnimals} />
                  <Field label="Reserved" value={item.reservedAnimals} />
                  <Field label="Active" value={item.activeAnimals} />
                  <Field label="Gap" value={item.supplyGap} />
                  <Field label="Title" value={item.title} wide />
                </dl>
              </MobileWorksheetCard>
            ))}
          </div>
        </>
      ) : (
        <p className="px-4 py-5 text-sm text-[var(--muted)]">No demand rows for this horizon.</p>
      )}
    </WorksheetShell>
  );
}

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser({ capability: "forecast:read" });
  const query = await searchParams;
  const filters: ForecastFilters = {
    labId: queryValue(query.labId),
    cageId: queryValue(query.cageId),
    responsibleUserId: queryValue(query.responsibleUserId),
  };
  const { longRange, partial, rows, summary, surplus, issues, scope } = await getForecastWorkspaceView(user, filters);

  return (
    <AppShell currentPath="/forecast" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader eyebrow="Forecast" title="Forecast" />
        <Surface className="p-3 md:p-4">
          <form className="grid gap-3 md:grid-cols-[minmax(10rem,0.8fr)_minmax(12rem,1.2fr)_minmax(12rem,1.2fr)_auto] md:items-end" method="get">
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">Lab</span>
              <select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm" defaultValue={scope.filters.labId} name="labId">
                {scope.options.labs.length > 1 ? <option value="">All accessible labs</option> : null}
                {scope.options.labs.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">Responsible user</span>
              <select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm" defaultValue={scope.filters.responsibleUserId} name="responsibleUserId">
                <option value="">All responsible users</option>
                {scope.options.responsibleUsers.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">Cage</span>
              <select className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm" defaultValue={scope.filters.cageId} name="cageId">
                <option value="">All accessible cages</option>
                {scope.options.cages.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="action-chip action-chip-primary" type="submit"><Filter aria-hidden="true" size={15} />Apply</button>
              <Link className="action-chip" href="/forecast"><RotateCcw aria-hidden="true" size={15} />Clear</Link>
            </div>
          </form>
        </Surface>
        {scope.invalid ? (
          <Surface className="border-amber-200 bg-amber-50/80 text-sm text-amber-950">
            The selected forecast scope is unavailable. Clear the filters or choose an accessible lab, user, and cage.
          </Surface>
        ) : null}
        {partial ? (
          <Surface className="border-amber-200 bg-amber-50/80 text-sm text-amber-950">
            <p className="font-medium">Some forecast data is temporarily unavailable.</p>
            <p className="mt-1 text-amber-900">{issues.slice(0, 2).join(" · ")}</p>
          </Surface>
        ) : null}
        <StatStrip
          stats={[
            { label: "Forecast rows", value: summary.activeBreedingForecasts, emphasis: "info" },
            { label: "Ready supply", value: summary.projectedExperimentReady45Days, emphasis: "success" },
            { label: "Pending demand", value: summary.pendingDemand45Days, emphasis: "warning" },
            { label: "Supply gap", value: summary.supplyGap45Days, emphasis: summary.supplyGap45Days ? "danger" : "success" },
            {
              label: `${summary.longRangeHorizonDays}d gap`,
              value: summary.supplyGapLongRangeDays,
              emphasis: summary.supplyGapLongRangeDays ? "danger" : "success",
            },
            {
              label: "Surplus pups",
              value: summary.projectedSurplus45Days,
              emphasis: summary.projectedSurplus45Days ? "warning" : "success",
            },
            { label: "Cryo backups", value: summary.cryostorageBackups, emphasis: "info" },
          ]}
        />
        <WorksheetShell
          actions={
            <>
              <Link className="action-chip" href="/breeding">
                Breeding
              </Link>
              <Link className="action-chip" href="/experiments">
                Experiments
              </Link>
              <Link className="action-chip" href="/cryostorage">
                Cryostorage
              </Link>
            </>
          }
          eyebrow="Worksheet"
          summary={<span>{rows.length} active pair forecasts</span>}
          title="Breeding outlook"
        >
          {rows.length ? (
            <>
              <div className="worksheet-table-wrap hidden md:block" data-testid="forecast-table">
                <table className="worksheet-table min-w-[1320px]">
                  <thead>
                    <tr>
                      <th>Pair</th>
                      <th>Lab</th>
                      <th>Cages</th>
                      <th>Responsible</th>
                      <th>Target genotype</th>
                      <th>Chance</th>
                      <th>Next litter</th>
                      <th>Ready</th>
                      <th>Usable</th>
                      <th>Litter</th>
                      <th>Surplus</th>
                      <th>Model</th>
                      <th>Warning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="worksheet-cell-strong">{row.pairLabel}</td>
                        <td className="worksheet-cell-muted max-w-[12rem]">{row.labLabel}</td>
                        <td className="worksheet-cell-muted max-w-[16rem]">{row.cageLabels.join(", ") || "Unassigned"}</td>
                        <td className="worksheet-cell-muted max-w-[14rem]">{row.responsibleUserNames.join(", ") || "Unassigned"}</td>
                        <td className="worksheet-cell-muted max-w-[16rem]">{row.targetGenotype}</td>
                        <td>{row.probabilityLabel}</td>
                        <td>{row.nextLitterLabel}</td>
                        <td>{row.readyLabel}</td>
                        <td>{row.expectedUsablePups}</td>
                        <td>{row.expectedLitterSize}</td>
                        <td>{row.expectedSurplusPups}</td>
                        <td className="worksheet-cell-muted max-w-[22rem]">{row.lineFertilitySummary}</td>
                        <td className="worksheet-cell-muted max-w-[18rem]">{row.warnings[0] ?? "None"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="worksheet-mobile-list md:hidden">
                {rows.map((row) => (
                  <MobileWorksheetCard
                    key={row.id}
                    meta={
                      <>
                        <span>{row.probabilityLabel}</span>
                        <span>{row.readyLabel}</span>
                      </>
                    }
                    title={row.pairLabel}
                  >
                    <dl className="contents">
                      <Field label="Target" value={row.targetGenotype} wide />
                      <Field label="Lab" value={row.labLabel} />
                      <Field label="Cages" value={row.cageLabels.join(", ") || "Unassigned"} wide />
                      <Field label="Responsible" value={row.responsibleUserNames.join(", ") || "Unassigned"} wide />
                      <Field label="Next litter" value={row.nextLitterLabel} />
                      <Field label="Usable" value={row.expectedUsablePups} />
                      <Field label="Litter" value={row.expectedLitterSize} />
                      <Field label="Surplus" value={row.expectedSurplusPups} />
                      <Field label="Model" value={row.lineFertilitySummary} wide />
                      <Field label="Warning" value={row.warnings[0] ?? "None"} wide />
                    </dl>
                  </MobileWorksheetCard>
                ))}
              </div>
            </>
          ) : (
            <p className="px-4 py-5 text-sm text-[var(--muted)]">No active breeding forecast rows.</p>
          )}
        </WorksheetShell>
        <DemandWorksheet title="Surplus minimization" view={surplus} />
        <DemandWorksheet title="Long-range study demand" view={longRange} />
      </div>
    </AppShell>
  );
}
