import Link from "next/link";

import { AlertFeed } from "@/components/app/alert-feed";
import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { StatStrip } from "@/components/app/stat-strip";
import { Surface } from "@/components/app/surface";
import {
  getBreedingSuggestionSummaryView,
  getDashboardOverviewView,
} from "@/lib/dashboard-read";
import { SEED_REFERENCE_DATE } from "@/lib/seed-metadata";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

export default async function DashboardPage() {
  const user = await requireUser();
  const [{ metrics, composition, highlights }, suggestions] = await Promise.all([
    getDashboardOverviewView(),
    getBreedingSuggestionSummaryView(),
  ]);

  return (
    <AppShell currentPath="/" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Dashboard"
          title="Operational view of the live colony."
          description="Start from alerts, age-sensitive workload, and the cages or animals that need attention first. This surface is tuned for daily staff rounds and experiment planning."
          badgeLabel="postgres runtime"
        />
        <StatStrip
          stats={[
            { label: "Active mice", value: metrics.activeAnimals, hint: "Live animals in active views", emphasis: "success" },
            { label: "Active breeders", value: metrics.activeBreeders, hint: "Animals marked in breeding", emphasis: "warning" },
            { label: "Pending genotype", value: metrics.pendingGenotypes, hint: "Need verification or report upload", emphasis: "warning" },
            {
              label: "Experiment-ready",
              value: metrics.availableForExperiment,
              hint: "Genotype-confirmed holding animals",
              emphasis: "info",
            },
            { label: "Open alerts", value: metrics.openAlerts, hint: "Rule and manual alerts combined", emphasis: "danger" },
            { label: "Old breeders", value: metrics.oldBreeders, hint: "Above breeder age threshold", emphasis: "warning" },
          ]}
        />
        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
          <AlertFeed alerts={highlights.alerts} title="Priority alerts" />
          <div className="space-y-6">
            <Surface className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Upcoming wean</p>
                  <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em]">Litter queue</h2>
                </div>
                <Link className="text-sm text-[var(--accent)]" href="/breeding">
                  Open breeding
                </Link>
              </div>
              <div className="space-y-3">
                {highlights.upcomingWean.map((item) => (
                  <article key={item.litterId} className="rounded-2xl border border-[var(--line)] px-4 py-4">
                    <p className="font-medium">{item.litterId}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      Due {item.dueDate} · linked to {item.breedingId}
                    </p>
                  </article>
                ))}
              </div>
            </Surface>
            <Surface className="space-y-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Colony composition</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="font-display text-3xl font-semibold tracking-[-0.05em]">{composition.males}</p>
                  <p className="text-sm text-[var(--muted)]">Male</p>
                </div>
                <div>
                  <p className="font-display text-3xl font-semibold tracking-[-0.05em]">{composition.females}</p>
                  <p className="text-sm text-[var(--muted)]">Female</p>
                </div>
                <div>
                  <p className="font-display text-3xl font-semibold tracking-[-0.05em]">{composition.breeding}</p>
                  <p className="text-sm text-[var(--muted)]">In breeding</p>
                </div>
                <div>
                  <p className="font-display text-3xl font-semibold tracking-[-0.05em]">{composition.transgenic}</p>
                  <p className="text-sm text-[var(--muted)]">Transgenic</p>
                </div>
              </div>
            </Surface>
          </div>
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Surface className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Breeding helper</p>
                <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em]">Suggested crosses</h2>
              </div>
              <Link className="text-sm text-[var(--accent)]" href="/breeding">
                Planner
              </Link>
            </div>
            <div className="space-y-3">
              {suggestions.slice(0, 3).map((suggestion) => (
                <article key={suggestion.id} className="rounded-2xl border border-[var(--line)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{suggestion.sireLabel}</p>
                      <p className="text-sm text-[var(--muted)]">{suggestion.damLabel}</p>
                    </div>
                    <p className="font-display text-2xl font-semibold tracking-[-0.05em]">{suggestion.probabilityLabel}</p>
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    Expected usable pups: {suggestion.expectedUsablePups} · Target sex split {suggestion.expectedSexSplit}
                  </p>
                  <p className="mt-2 text-sm text-amber-900">{suggestion.warnings[0] ?? "No immediate warning."}</p>
                </article>
              ))}
            </div>
          </Surface>
          <Surface className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Operational quick links</p>
                <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em]">Common actions</h2>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Link className="rounded-2xl border border-[var(--line)] p-4 transition hover:border-[var(--line-strong)] hover:bg-white" href="/scan/CM-A101-001">
                <p className="font-medium">Open breeding cage</p>
                <p className="mt-1 text-sm text-[var(--muted)]">Launch barcode workflow for CM-A101-001</p>
              </Link>
              <Link className="rounded-2xl border border-[var(--line)] p-4 transition hover:border-[var(--line-strong)] hover:bg-white" href="/animals">
                <p className="font-medium">Filter the colony</p>
                <p className="mt-1 text-sm text-[var(--muted)]">Search by genotype, age, room, or assignment state</p>
              </Link>
              <Link className="rounded-2xl border border-[var(--line)] p-4 transition hover:border-[var(--line-strong)] hover:bg-white" href="/experiments">
                <p className="font-medium">Review reserved animals</p>
                <p className="mt-1 text-sm text-[var(--muted)]">Check overlap conflicts and not-started reservations</p>
              </Link>
              <Link className="rounded-2xl border border-[var(--line)] p-4 transition hover:border-[var(--line-strong)] hover:bg-white" href="/notifications">
                <p className="font-medium">Open notification inbox</p>
                <p className="mt-1 text-sm text-[var(--muted)]">Triages overdue genotypes, welfare follow-up, and stale reservations</p>
              </Link>
              <Link className="rounded-2xl border border-[var(--line)] p-4 transition hover:border-[var(--line-strong)] hover:bg-white" href="/forecast">
                <p className="font-medium">Open forecast</p>
                <p className="mt-1 text-sm text-[var(--muted)]">Estimate breeder output, near-term runway, and frozen-backup coverage</p>
              </Link>
              <Link className="rounded-2xl border border-[var(--line)] p-4 transition hover:border-[var(--line-strong)] hover:bg-white" href="/settings">
                <p className="font-medium">Tune rule thresholds</p>
                <p className="mt-1 text-sm text-[var(--muted)]">Edit breeder age, occupancy, and genotype timing rules</p>
              </Link>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 text-sm text-[var(--muted)]">
              Seed dataset reference date: {formatDate(SEED_REFERENCE_DATE)}
            </div>
          </Surface>
        </div>
      </div>
    </AppShell>
  );
}
