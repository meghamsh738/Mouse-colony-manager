import Link from "next/link";

import { AppShell } from "@/components/app/app-shell";
import { ExperimentPlanDemoteForm } from "@/components/app/experiment-plan-demote-form";
import { PlannedAssignmentEditor } from "@/components/app/planned-assignment-editor";
import { ExperimentPlanPromoteForm } from "@/components/app/experiment-plan-promote-form";
import { ExperimentPlanSaveForm } from "@/components/app/experiment-plan-save-form";
import { PageHeader } from "@/components/app/page-header";
import { StatStrip } from "@/components/app/stat-strip";
import { Surface } from "@/components/app/surface";
import { Button } from "@/components/ui/button";
import {
  getExperimentOverviewView,
  getExperimentPlannerOptions,
  getExperimentPlannerView,
  parseExperimentPlannerFilters,
} from "@/lib/experiments-read";
import { requireUser } from "@/lib/session";
import { formatDate, titleCase } from "@/lib/utils";

type ExperimentsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function renderSelectionReason(reason: string) {
  if (reason.startsWith("siblings:")) {
    return "Unique sibling group retained";
  }

  return reason;
}

export default async function ExperimentsPage({ searchParams }: ExperimentsPageProps) {
  const user = await requireUser();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const filters = parseExperimentPlannerFilters(resolvedSearchParams);
  const [overview, planner, options] = await Promise.all([
    getExperimentOverviewView(),
    getExperimentPlannerView(filters),
    getExperimentPlannerOptions(),
  ]);

  return (
    <AppShell currentPath="/experiments" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Experiments"
          title="Assignment conflicts and cohort planning."
          description="Filter the live colony, pick a balanced cohort, and see exactly why other animals were excluded before any reservation is written."
        />
        <StatStrip
          stats={[
            {
              label: "Reviewed",
              value: planner.summary.totalReviewed,
              hint: "Alive animals screened against the current planner filters",
            },
            {
              label: "Included",
              value: planner.summary.included,
              hint: "Animals still eligible after hard filter checks",
              emphasis: "success",
            },
            {
              label: "Selected",
              value: planner.summary.selected,
              hint: `Primary cohort target is ${planner.filters.desiredNumber}`,
              emphasis: "info",
            },
            {
              label: "Alternates",
              value: planner.summary.alternates,
              hint: "Held back in case a selected animal is blocked later",
            },
            {
              label: "Excluded",
              value: planner.summary.excluded,
              hint: "Filtered out by status, age, project, overlap, or genotype",
              emphasis: planner.summary.excluded > 0 ? "warning" : "neutral",
            },
            {
              label: "Overlap Mode",
              value: planner.filters.allowOverlap ? "Allowed" : "Blocked",
              hint: planner.filters.allowOverlap
                ? "Existing planned or active assignments stay visible"
                : "Conflicting assignments are removed from the pool",
            },
          ]}
        />
        <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
          <Surface className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Distribution helper</p>
                <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">Tune the selection window</h2>
                <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
                  Use hard filters for inclusion, then let the planner spread picks across cages and sibling groups.
                </p>
              </div>
              <Link href="/animals" className="text-sm text-[var(--accent)] transition hover:text-[var(--accent-strong)]">
                Open colony table
              </Link>
            </div>
            <form className="space-y-5" data-testid="experiment-planner-filters" method="get">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="text-[var(--muted)]">Desired animals</span>
                  <input
                    className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
                    defaultValue={String(planner.filters.desiredNumber)}
                    max={24}
                    min={1}
                    name="desiredNumber"
                    type="number"
                    data-testid="planner-desired-number"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-[var(--muted)]">Sex</span>
                  <select
                    className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
                    defaultValue={planner.filters.desiredSex}
                    name="sex"
                    data-testid="planner-sex"
                  >
                    <option value="either">Either</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-[var(--muted)]">Minimum age in days</span>
                  <input
                    className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
                    defaultValue={String(planner.filters.minAgeDays)}
                    max={365}
                    min={14}
                    name="minAgeDays"
                    type="number"
                    data-testid="planner-min-age"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-[var(--muted)]">Maximum age in days</span>
                  <input
                    className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
                    defaultValue={String(planner.filters.maxAgeDays)}
                    max={540}
                    min={planner.filters.minAgeDays}
                    name="maxAgeDays"
                    type="number"
                    data-testid="planner-max-age"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-[var(--muted)]">Genotype keyword</span>
                  <input
                    className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
                    defaultValue={planner.filters.genotypeKeyword}
                    name="genotypeKeyword"
                    placeholder="Cre, flox, tdTomato"
                    type="text"
                    data-testid="planner-genotype"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-[var(--muted)]">Strain</span>
                  <select
                    className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
                    defaultValue={planner.filters.strainId ?? ""}
                    name="strainId"
                    data-testid="planner-strain"
                  >
                    <option value="">Any active strain</option>
                    {options.strainOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm md:col-span-2">
                  <span className="text-[var(--muted)]">Chargeable project</span>
                  <select
                    className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] md:text-sm"
                    defaultValue={planner.filters.projectId ?? ""}
                    name="projectId"
                    data-testid="planner-project"
                  >
                    <option value="">Any active project</option>
                    {options.projectOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-[var(--muted)]">Treatment groups</span>
                  <input
                    className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
                    defaultValue={String(planner.filters.groupCount)}
                    max={6}
                    min={2}
                    name="groupCount"
                    type="number"
                    data-testid="planner-group-count"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-[var(--muted)]">Randomization seed</span>
                  <input
                    className="h-11 w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--focus)] md:text-sm"
                    defaultValue={planner.filters.randomSeed}
                    name="randomSeed"
                    placeholder="colony-balance"
                    type="text"
                    data-testid="planner-random-seed"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-start gap-3 rounded-3xl border border-[var(--line)] px-4 py-4 text-sm">
                  <input
                    className="mt-1 h-5 w-5 rounded border-[var(--line)] text-[var(--accent)] focus:ring-[var(--accent)]"
                    defaultChecked={planner.filters.includeReserved}
                    name="includeReserved"
                    type="checkbox"
                    value="true"
                    data-testid="planner-include-reserved"
                  />
                  <span>
                    <span className="block font-medium text-[var(--ink)]">Include reserved animals</span>
                    <span className="mt-1 block text-[var(--muted)]">Show animals already held for another workflow.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-3xl border border-[var(--line)] px-4 py-4 text-sm">
                  <input
                    className="mt-1 h-5 w-5 rounded border-[var(--line)] text-[var(--accent)] focus:ring-[var(--accent)]"
                    defaultChecked={planner.filters.allowOverlap}
                    name="allowOverlap"
                    type="checkbox"
                    value="true"
                    data-testid="planner-allow-overlap"
                  />
                  <span>
                    <span className="block font-medium text-[var(--ink)]">Allow overlap review</span>
                    <span className="mt-1 block text-[var(--muted)]">Keep animals with existing experiment assignments visible.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-3xl border border-[var(--line)] px-4 py-4 text-sm">
                  <input
                    className="mt-1 h-5 w-5 rounded border-[var(--line)] text-[var(--accent)] focus:ring-[var(--accent)]"
                    defaultChecked={planner.filters.balanceByCage}
                    name="balanceByCage"
                    type="checkbox"
                    value="true"
                    data-testid="planner-balance-cage"
                  />
                  <span>
                    <span className="block font-medium text-[var(--ink)]">Balance by cage</span>
                    <span className="mt-1 block text-[var(--muted)]">Reduce clustering so the cohort is spread across rooms and racks.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-3xl border border-[var(--line)] px-4 py-4 text-sm">
                  <input
                    className="mt-1 h-5 w-5 rounded border-[var(--line)] text-[var(--accent)] focus:ring-[var(--accent)]"
                    defaultChecked={planner.filters.avoidSiblingClustering}
                    name="avoidSiblingClustering"
                    type="checkbox"
                    value="true"
                    data-testid="planner-avoid-siblings"
                  />
                  <span>
                    <span className="block font-medium text-[var(--ink)]">Avoid sibling clustering</span>
                    <span className="mt-1 block text-[var(--muted)]">Prefer animals from different sire and dam pairs where possible.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-3xl border border-[var(--line)] px-4 py-4 text-sm">
                  <input
                    className="mt-1 h-5 w-5 rounded border-[var(--line)] text-[var(--accent)] focus:ring-[var(--accent)]"
                    defaultChecked={planner.filters.blockBySex}
                    name="blockBySex"
                    type="checkbox"
                    value="true"
                    data-testid="planner-block-sex"
                  />
                  <span>
                    <span className="block font-medium text-[var(--ink)]">Block by sex in randomization</span>
                    <span className="mt-1 block text-[var(--muted)]">Keep treatment arms mixed as evenly as the selected cohort allows.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-3xl border border-[var(--line)] px-4 py-4 text-sm">
                  <input
                    className="mt-1 h-5 w-5 rounded border-[var(--line)] text-[var(--accent)] focus:ring-[var(--accent)]"
                    defaultChecked={planner.filters.blockBySiblingGroup}
                    name="blockBySiblingGroup"
                    type="checkbox"
                    value="true"
                    data-testid="planner-block-siblings"
                  />
                  <span>
                    <span className="block font-medium text-[var(--ink)]">Block by sibling group in randomization</span>
                    <span className="mt-1 block text-[var(--muted)]">Avoid loading one treatment arm from the same sire and dam pair first.</span>
                  </span>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button className="relative z-10" type="submit" data-testid="planner-apply">
                  Apply planner filters
                </Button>
                <Link
                  href="/experiments"
                  className="relative z-10 inline-flex h-10 items-center justify-center rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)] hover:bg-[var(--surface)]"
                >
                  Reset
                </Link>
              </div>
            </form>
          </Surface>
          <div className="space-y-6">
            <Surface className="space-y-4" data-testid="experiment-cohort">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Primary cohort</p>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">Balanced picks for the current request</h2>
                </div>
                <p className="text-sm text-[var(--muted)]">
                  {planner.selected.length} selected / {planner.filters.desiredNumber} requested
                </p>
              </div>
              <div className="space-y-3">
                {planner.selected.length ? (
                  planner.selected.map((entry) => {
                    const candidate = planner.candidates.find((item) => item.animalId === entry.animalId);

                    if (!candidate) {
                      return null;
                    }

                    return (
                      <article
                        key={entry.animalId}
                        className="grid gap-3 rounded-3xl border border-[var(--line)] p-4 lg:grid-cols-[1fr_auto]"
                        data-testid="planner-selected-row"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <p className="font-medium">{candidate.animalId}</p>
                            <span className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                              Rank {entry.rank}
                            </span>
                          </div>
                          <p className="text-sm text-[var(--muted)]">
                            {titleCase(candidate.sex)} · {candidate.ageLabel} · {candidate.strain}
                          </p>
                          <p className="text-sm text-[var(--muted)]">{candidate.genotypeSummary}</p>
                          <p className="text-sm text-[var(--muted)]">{candidate.cageLabel}</p>
                          <p className="text-sm text-[var(--muted)]">
                            {entry.reasons.map(renderSelectionReason).join(" · ")}
                          </p>
                          {candidate.warnings.length ? (
                            <p className="text-sm text-amber-900">{candidate.warnings.join(" · ")}</p>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Adjusted score</p>
                          <p className="font-display text-3xl font-semibold tracking-[-0.05em]">{entry.adjustedScore}</p>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <p className="rounded-3xl border border-dashed border-[var(--line)] px-4 py-5 text-sm text-[var(--muted)]">
                    No cohort was selected for the current filter combination. Widen the age range, allow reserved animals,
                    or remove the project constraint.
                  </p>
                )}
              </div>
            </Surface>
            <Surface className="space-y-4" data-testid="experiment-randomization">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Randomization helper</p>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">Seeded treatment-arm layout</h2>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Deterministic grouping from the selected cohort. Reuse the same seed to regenerate the same arm layout.
                  </p>
                </div>
                <p className="text-sm text-[var(--muted)]">Seed {planner.randomization.seed}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm text-[var(--muted)]">
                {planner.randomization.strategy.map((step) => (
                  <span key={step} className="rounded-full border border-[var(--line)] px-3 py-1.5">
                    {step}
                  </span>
                ))}
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {planner.randomization.groups.map((group) => (
                  <article key={group.name} className="rounded-3xl border border-[var(--line)] p-4" data-testid="planner-group-card">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{group.name}</p>
                        <p className="text-sm text-[var(--muted)]">
                          {group.summary.total} animals · {group.summary.males} male · {group.summary.females} female
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {group.members.length ? (
                        group.members.map((member) => (
                          <div key={member.animalId} className="rounded-2xl bg-[var(--surface-2)] px-4 py-3 text-sm">
                            <p className="font-medium">{member.animalId}</p>
                            <p className="mt-1 text-[var(--muted)]">
                              {titleCase(member.sex)} · {member.ageLabel} · {member.cageLabel}
                            </p>
                            <p className="mt-1 text-[var(--muted)]">{member.genotypeSummary}</p>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-2xl border border-dashed border-[var(--line)] px-4 py-4 text-sm text-[var(--muted)]">
                          No members assigned. Increase the selected cohort or reduce the group count.
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </Surface>
            <Surface className="space-y-4" data-testid="experiment-plan-save">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Persist cohort</p>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">Write the current layout into experiment planning</h2>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    This saves the selected cohort as `planned` experiment assignments and preserves the seeded treatment groups.
                  </p>
                </div>
              </div>
              <ExperimentPlanSaveForm experimentOptions={options.experimentOptions} filters={planner.filters} />
            </Surface>
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <Surface className="space-y-4" data-testid="experiment-ranked-candidates">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Ranked pool</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">Eligible animals still in play</h2>
                  </div>
                  <p className="text-sm text-[var(--muted)]">{planner.candidates.length} candidates</p>
                </div>
                <div className="space-y-3">
                  {planner.candidates.slice(0, 8).map((candidate) => (
                    <article key={candidate.animalId} className="rounded-3xl border border-[var(--line)] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{candidate.animalId}</p>
                          <p className="text-sm text-[var(--muted)]">
                            {titleCase(candidate.sex)} · {candidate.ageLabel} · {candidate.strain}
                          </p>
                        </div>
                        <p className="font-display text-2xl font-semibold tracking-[-0.05em]">{candidate.score}</p>
                      </div>
                      <p className="mt-2 text-sm text-[var(--muted)]">{candidate.genotypeSummary}</p>
                      <p className="mt-2 text-sm text-[var(--muted)]">{candidate.cageLabel}</p>
                      {candidate.projectCodes.length ? (
                        <p className="mt-2 text-sm text-[var(--muted)]">Projects: {candidate.projectCodes.join(", ")}</p>
                      ) : null}
                      <p className="mt-2 text-sm text-[var(--muted)]">{candidate.inclusionReason}</p>
                      {candidate.warnings.length ? (
                        <p className="mt-2 text-sm text-amber-900">{candidate.warnings.join(" · ")}</p>
                      ) : null}
                    </article>
                  ))}
                </div>
              </Surface>
              <div className="space-y-6">
                <Surface className="space-y-4" data-testid="experiment-alternates">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Alternates</p>
                      <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">Backup animals if a pick fails review</h2>
                    </div>
                    <p className="text-sm text-[var(--muted)]">{planner.alternates.length} backups</p>
                  </div>
                  <div className="space-y-3">
                    {planner.alternates.map((entry) => {
                      const candidate = planner.candidates.find((item) => item.animalId === entry.animalId);

                      if (!candidate) {
                        return null;
                      }

                      return (
                        <article key={entry.animalId} className="rounded-3xl border border-[var(--line)] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-medium">{candidate.animalId}</p>
                            <p className="font-display text-2xl font-semibold tracking-[-0.05em]">{entry.adjustedScore}</p>
                          </div>
                          <p className="mt-2 text-sm text-[var(--muted)]">
                            {candidate.cageLabel} · {candidate.ageLabel} · {candidate.strain}
                          </p>
                          <p className="mt-2 text-sm text-[var(--muted)]">
                            {entry.reasons.map(renderSelectionReason).join(" · ")}
                          </p>
                        </article>
                      );
                    })}
                  </div>
                </Surface>
                <Surface className="space-y-4" data-testid="experiment-exclusions">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Excluded by filter</p>
                      <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">Why animals dropped out</h2>
                    </div>
                    <p className="text-sm text-[var(--muted)]">{planner.exclusions.length} exclusion buckets</p>
                  </div>
                  <div className="space-y-3">
                    {planner.exclusions.length ? (
                      planner.exclusions.map((item) => (
                        <div key={item.reason} className="flex items-center justify-between gap-4 rounded-3xl border border-[var(--line)] px-4 py-3">
                          <p className="text-sm text-[var(--ink)]">{item.reason}</p>
                          <p className="font-display text-2xl font-semibold tracking-[-0.05em]">{item.count}</p>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-3xl border border-dashed border-[var(--line)] px-4 py-5 text-sm text-[var(--muted)]">
                        No exclusions were triggered. The current filter set is permissive.
                      </p>
                    )}
                  </div>
                </Surface>
              </div>
            </div>
          </div>
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Surface className="space-y-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Experiment overview</p>
            <div className="space-y-3">
              {overview.map((experiment) => (
                <article key={experiment.id} className="rounded-3xl border border-[var(--line)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{experiment.experimentCode}</p>
                      <p className="text-sm text-[var(--muted)]">{experiment.title}</p>
                    </div>
                    <p className="text-sm capitalize text-[var(--muted)]">{experiment.status}</p>
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted)]">{experiment.projectCode}</p>
                  <div className="mt-3 space-y-2">
                    {experiment.assignments.map((assignment) => (
                      <div key={assignment.id} className="rounded-3xl bg-[var(--surface-2)] px-4 py-3 text-sm">
                        <p>{assignment.animalId}</p>
                        <p className="text-[var(--muted)]">
                          {assignment.status} · {assignment.treatmentGroup ?? "No treatment group"} · starts {formatDate(assignment.startDate)}
                        </p>
                        {assignment.notes ? <p className="mt-1 text-[var(--muted)]">{assignment.notes}</p> : null}
                        {assignment.status === "planned" ? (
                          <PlannedAssignmentEditor
                            assignmentId={assignment.id}
                            animalId={assignment.animalId}
                            startDate={assignment.startDate}
                            treatmentGroup={assignment.treatmentGroup}
                            notes={assignment.notes}
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {experiment.assignments.some((assignment) => assignment.status === "planned") ? (
                    <div className="mt-4 border-t border-[var(--line)] pt-4">
                      <ExperimentPlanPromoteForm
                        experimentId={experiment.id}
                        plannedCount={experiment.assignments.filter((assignment) => assignment.status === "planned").length}
                      />
                    </div>
                  ) : null}
                  {experiment.assignments.some((assignment) => assignment.status === "reserved") ? (
                    <div className="mt-4 border-t border-[var(--line)] pt-4">
                      <ExperimentPlanDemoteForm
                        experimentId={experiment.id}
                        reservedCount={experiment.assignments.filter((assignment) => assignment.status === "reserved").length}
                      />
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </Surface>
          <Surface className="space-y-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Next actions</p>
            <div className="space-y-4 text-sm text-[var(--muted)]">
              <p>
                Use the planner to settle the cohort first, then reserve each animal from its detail page so the audit
                trail, overlap checks, and treatment-group notes stay transactional.
              </p>
              <p>
                When the selected pool looks thin, widen the age range slightly or move to{" "}
                <Link className="text-[var(--accent)] transition hover:text-[var(--accent-strong)]" href="/forecast">
                  Forecast
                </Link>{" "}
                to see whether the next breeding wave will cover the shortfall.
              </p>
              <p>
                If the cohort is too sibling-heavy, keep the sibling blocker on and reserve alternates instead of forcing
                one litter to carry the entire experiment.
              </p>
            </div>
          </Surface>
        </div>
      </div>
    </AppShell>
  );
}
