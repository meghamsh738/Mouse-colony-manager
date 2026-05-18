import { AppShell } from "@/components/app/app-shell";
import { BreedingLitterForm } from "@/components/app/breeding-litter-form";
import { BreedingSetupForm } from "@/components/app/breeding-setup-form";
import { BreedingWeanForm } from "@/components/app/breeding-wean-form";
import { PageHeader } from "@/components/app/page-header";
import { Surface } from "@/components/app/surface";
import { Badge } from "@/components/ui/badge";
import {
  getBreedingOverviewView,
  getBreedingSetupOptionsView,
  getBreedingSuggestionSummaryView,
  getBreedingWeaningOptionsView,
} from "@/lib/breeding-read";
import { requireUser } from "@/lib/session";
import type { BreedingSuggestion } from "@/lib/types";
import { formatDate } from "@/lib/utils";

function getRuleBadgeVariant(severity: BreedingSuggestion["ruleSeverity"]) {
  if (severity === "critical") {
    return "danger";
  }

  return severity === "warning" ? "warning" : "success";
}

export default async function BreedingPage() {
  const user = await requireUser();
  const [breedings, suggestions, options, weaningOptions] = await Promise.all([
    getBreedingOverviewView(),
    getBreedingSuggestionSummaryView(),
    getBreedingSetupOptionsView(),
    getBreedingWeaningOptionsView(),
  ]);
  const canCreateBreeding = user.role !== "read_only";
  const canOverride = user.role === "admin";
  const canRecordLitter = user.role !== "read_only";
  const defaultBirthDate = (process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString()).slice(0, 10);

  return (
    <AppShell currentPath="/breeding" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Breeding"
          title="Active breeding setups and suggested crosses."
          description="Use this area to review active pairs, overdue breedings, litter status, and ranked cross suggestions for the next cohort."
        />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(18rem,0.92fr)]">
          <Surface className="space-y-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Active breeding dashboard</p>
            <div className="space-y-3">
              {breedings.map((breeding) => (
                <article key={breeding.id} className="rounded-2xl border border-[var(--line)] p-4" data-testid={`breeding-card-${breeding.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{breeding.id}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">Started {formatDate(breeding.startDate)}</p>
                    </div>
                    <p className="text-sm capitalize text-[var(--muted)]">{breeding.status}</p>
                  </div>
                  <div className="mt-3 text-sm text-[var(--muted)]">
                    {breeding.adults.map((adult) => `${adult.role}: ${adult.animal?.animalId}`).join(" · ")}
                  </div>
                  <p className="mt-3 text-sm text-[var(--ink)]">{breeding.targetGenotype}</p>
                  {breeding.litter ? (
                    <div className="mt-3 space-y-1 text-sm text-[var(--muted)]">
                      <p>
                        {breeding.litter.id} born {formatDate(breeding.litter.birthDate)}
                      </p>
                      <p>{breeding.litter.litterSizeBirth} pups recorded at birth</p>
                      {breeding.litter.litterSizeWean !== undefined ? <p>{breeding.litter.litterSizeWean} pups weaned</p> : null}
                      <p>{breeding.litter.progenyCount} progeny linked</p>
                      {breeding.litter.notes ? <p>{breeding.litter.notes}</p> : null}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-[var(--muted)]">No litter recorded yet.</p>
                  )}
                  {canRecordLitter && breeding.status === "active" ? (
                    <div className="mt-4 border-t border-[var(--line)] pt-4">
                      <div className="mb-3 space-y-1">
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Record litter outcome</p>
                        <p className="text-sm text-[var(--muted)]">
                          Enter the confirmed birth date and litter size for this pairing. The latest litter summary updates here immediately.
                        </p>
                      </div>
                      <BreedingLitterForm breedingSetupId={breeding.id} defaultBirthDate={defaultBirthDate} />
                    </div>
                  ) : null}
                  {canRecordLitter && breeding.litter && breeding.litter.litterSizeWean === undefined && breeding.litter.progenyCount === 0 ? (
                    <div className="mt-4 border-t border-[var(--line)] pt-4">
                      <div className="mb-3 space-y-1">
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Wean and assign progeny</p>
                        <p className="text-sm text-[var(--muted)]">
                          Split the litter into male and female holding cages, then generate traceable pup records in one step.
                        </p>
                      </div>
                      <BreedingWeanForm
                        litterId={breeding.litter.id}
                        defaultWeanDate={new Date(new Date(breeding.litter.birthDate).getTime() + 21 * 86_400_000)
                          .toISOString()
                          .slice(0, 10)}
                        cageOptions={weaningOptions.cageOptions}
                        strainOptions={weaningOptions.strainOptions}
                      />
                    </div>
                  ) : null}
                  {breeding.litter && breeding.litter.litterSizeWean === undefined && breeding.litter.progenyCount > 0 ? (
                    <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--muted)]">
                      Progeny records already exist for this litter. Review those pups from the colony table instead of creating a second weaning batch.
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </Surface>
          <Surface className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Create setup</p>
              <p className="text-sm leading-6 text-[var(--muted)]">
                Start a new sire and dam pairing from live colony animals. Duplicate breeder safeguards stay on unless an admin explicitly overrides them.
              </p>
            </div>
            {canCreateBreeding ? (
              <BreedingSetupForm
                sireOptions={options.sireOptions}
                damOptions={options.damOptions}
                allowOverride={canOverride}
              />
            ) : (
              <p className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--muted)]">
                Read-only users can review breeding state here, but cannot create new setups.
              </p>
            )}
          </Surface>
        </div>
        <Surface className="space-y-4" data-testid="breeding-suggestions">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Generator suggestions</p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                Ranked crosses in a scan-first table.
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-[var(--muted)]">
              Compare target probability, expected output, fertility model, and rule risks without opening separate cards. Uses actual
              litter history where available before default assumptions.
            </p>
          </div>
          {suggestions.length ? (
            <>
              <div className="data-table-wrap hidden lg:block">
                <table className="data-table min-w-[980px]">
                  <thead>
                    <tr>
                      <th>Ranked cross</th>
                      <th>Target chance</th>
                      <th>Expected output</th>
                      <th>Fertility model</th>
                      <th>Rules</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestions.map((suggestion) => (
                      <tr key={suggestion.id}>
                        <td>
                          <div className="font-medium text-[var(--ink)]">{suggestion.sireLabel}</div>
                          <div className="mt-1 text-sm text-[var(--muted)]">{suggestion.damLabel}</div>
                        </td>
                        <td>
                          <div className="font-display text-2xl font-semibold tracking-[-0.05em] text-[var(--ink)]">
                            {suggestion.probabilityLabel}
                          </div>
                          <div className="mt-1 text-xs text-[var(--muted)]">{suggestion.estimatedPupsNeeded} pups needed</div>
                        </td>
                        <td>
                          <div className="text-sm text-[var(--ink)]">
                            {suggestion.expectedLitterSize} litter · {suggestion.expectedUsablePups} usable
                          </div>
                          <div className="mt-2">
                            <Badge variant={suggestion.estimatedSurplusPups >= 4 ? "warning" : "success"}>
                              surplus risk {suggestion.estimatedSurplusPups}
                            </Badge>
                          </div>
                        </td>
                        <td className="max-w-[22rem]">
                          <p className="text-sm text-[var(--muted)]">{suggestion.fertilitySummary}</p>
                          <p className="mt-1 text-sm text-[var(--muted)]">{suggestion.lineFertilitySummary}</p>
                          <p className="mt-1 text-sm text-[var(--muted)]">{suggestion.workloadSummary}</p>
                        </td>
                        <td className="max-w-[20rem]">
                          <Badge variant={getRuleBadgeVariant(suggestion.ruleSeverity)}>
                            {suggestion.ruleSeverity === "ok" ? "Rule clear" : "Rule risk"}
                          </Badge>
                          <p className="mt-2 text-sm text-[var(--muted)]">{suggestion.ruleSummary}</p>
                          {suggestion.warnings.length ? (
                            <p className="mt-1 text-sm text-amber-900">{suggestion.warnings.join(" · ")}</p>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 lg:hidden">
                {suggestions.map((suggestion) => (
                  <article key={suggestion.id} className="mobile-record">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-[var(--ink)]">{suggestion.sireLabel}</p>
                        <p className="text-sm text-[var(--muted)]">{suggestion.damLabel}</p>
                      </div>
                      <p className="font-display text-2xl font-semibold tracking-[-0.05em] text-[var(--ink)]">
                        {suggestion.probabilityLabel}
                      </p>
                    </div>
                    <dl className="mt-3 grid gap-3 text-sm text-[var(--muted)] sm:grid-cols-2">
                      <div>
                        <dt className="text-xs uppercase tracking-[0.14em]">Output</dt>
                        <dd className="mt-1 text-[var(--ink)]">
                          {suggestion.expectedLitterSize} litter · {suggestion.expectedUsablePups} usable · surplus risk{" "}
                          {suggestion.estimatedSurplusPups}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.14em]">Needed</dt>
                        <dd className="mt-1 text-[var(--ink)]">{suggestion.estimatedPupsNeeded} pups</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs uppercase tracking-[0.14em]">Model</dt>
                        <dd className="mt-1">{suggestion.lineFertilitySummary}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs uppercase tracking-[0.14em]">Rule check</dt>
                        <dd className="mt-1">{suggestion.ruleSummary}</dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant={suggestion.estimatedSurplusPups >= 4 ? "warning" : "success"}>
                        surplus risk {suggestion.estimatedSurplusPups}
                      </Badge>
                      <Badge variant={getRuleBadgeVariant(suggestion.ruleSeverity)}>
                        {suggestion.ruleSeverity === "ok" ? "Rule clear" : "Rule risk"}
                      </Badge>
                    </div>
                    {suggestion.warnings.length ? (
                      <p className="mt-2 text-sm text-amber-900">{suggestion.warnings.join(" · ")}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--muted)]">
              No valid cross suggestions are available for the current rule set.
            </p>
          )}
        </Surface>
      </div>
    </AppShell>
  );
}
