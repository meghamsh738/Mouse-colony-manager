import { AppShell } from "@/components/app/app-shell";
import { BreedingLitterForm } from "@/components/app/breeding-litter-form";
import { BreedingSetupForm } from "@/components/app/breeding-setup-form";
import { PageHeader } from "@/components/app/page-header";
import { Surface } from "@/components/app/surface";
import {
  getBreedingOverviewView,
  getBreedingSetupOptionsView,
  getBreedingSuggestionSummaryView,
} from "@/lib/breeding-read";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

export default async function BreedingPage() {
  const user = await requireUser();
  const [breedings, suggestions, options] = await Promise.all([
    getBreedingOverviewView(),
    getBreedingSuggestionSummaryView(),
    getBreedingSetupOptionsView(),
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
        <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
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
                </article>
              ))}
            </div>
          </Surface>
        </div>
        <Surface className="space-y-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Generator suggestions</p>
            <div className="space-y-3">
              {suggestions.map((suggestion) => (
                <article key={suggestion.id} className="rounded-2xl border border-[var(--line)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{suggestion.sireLabel}</p>
                      <p className="text-sm text-[var(--muted)]">{suggestion.damLabel}</p>
                    </div>
                    <p className="font-display text-2xl font-semibold tracking-[-0.05em]">{suggestion.probabilityLabel}</p>
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    Estimated usable pups {suggestion.expectedUsablePups} · estimated pups needed {suggestion.estimatedPupsNeeded}
                  </p>
                  <p className="mt-2 text-sm text-amber-900">{suggestion.warnings.join(" · ")}</p>
                </article>
              ))}
            </div>
        </Surface>
      </div>
    </AppShell>
  );
}
