import Link from "next/link";

import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { StatStrip } from "@/components/app/stat-strip";
import { Surface } from "@/components/app/surface";
import { getForecastCalloutsView, getForecastSummaryView } from "@/lib/forecast-read";
import { requireUser } from "@/lib/session";

export default async function ForecastPage() {
  const user = await requireUser();
  const [summary, rows] = await Promise.all([getForecastSummaryView(), getForecastCalloutsView()]);

  return (
    <AppShell currentPath="/forecast" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Forecast"
          title="Projected breeding output and experiment-ready runway."
          description="This read-only planning surface estimates short-horizon colony supply from active breedings, recent litter performance, configured weaning timing, and available cryostorage backups."
        />
        <StatStrip
          stats={[
            { label: "Forecast rows", value: summary.activeBreedingForecasts, hint: "Active breedings with forward projections", emphasis: "info" },
            { label: "Pups in 30d", value: summary.projectedPups30Days, hint: "Projected births in the next 30 days", emphasis: "warning" },
            {
              label: "Ready in 45d",
              value: summary.projectedExperimentReady45Days,
              hint: "Estimated experiment-ready animals on current trend",
              emphasis: "success",
            },
            { label: "Available now", value: summary.availableNow, hint: "Current colony-holding mice", emphasis: "neutral" },
            { label: "Reserved now", value: summary.reservedPressure, hint: "Animals already under reservation pressure", emphasis: "warning" },
            { label: "Cryo backups", value: summary.cryostorageBackups, hint: "Stored or reserved frozen line backups", emphasis: "info" },
          ]}
        />
        <div className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
          <Surface className="space-y-4" data-testid="forecast-table">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Breeding outlook</p>
                <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em]">Projected supply by active pair</h2>
              </div>
              <Link className="text-sm text-[var(--accent)]" href="/breeding">
                Open breeding
              </Link>
            </div>
            <div className="space-y-3">
              {rows.map((row) => (
                <article key={row.id} className="rounded-2xl border border-[var(--line)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{row.pairLabel}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">{row.targetGenotype}</p>
                    </div>
                    <p className="font-display text-2xl font-semibold tracking-[-0.05em]">{row.probabilityLabel}</p>
                  </div>
                  <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                    <div>
                      <p className="text-[var(--muted)]">Next litter</p>
                      <p className="mt-1 font-medium">{row.nextLitterLabel}</p>
                    </div>
                    <div>
                      <p className="text-[var(--muted)]">Experiment-ready</p>
                      <p className="mt-1 font-medium">{row.readyLabel}</p>
                    </div>
                    <div>
                      <p className="text-[var(--muted)]">Usable pups</p>
                      <p className="mt-1 font-medium">
                        {row.expectedUsablePups} / {row.expectedLitterSize}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    Estimated from recent litter size, target genotype token match, and current breeder age state.
                  </p>
                  <p className="mt-2 text-sm text-amber-900">{row.warnings[0] ?? "No immediate forecast warning."}</p>
                </article>
              ))}
            </div>
          </Surface>
          <div className="space-y-6">
            <Surface className="space-y-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Interpretation</p>
              <div className="space-y-3 text-sm leading-7 text-[var(--muted)]">
                <p>
                  Use this page to decide whether current active breedings are enough to cover near-term study demand without overproducing surplus animals.
                </p>
                <p>
                  Forecasts are intentionally conservative. They use actual breeding records and current rule timings, but they do not assume perfect fertility or 100% genotype success.
                </p>
                <p>
                  Cryostorage counts are shown here to make recovery options visible when live supply starts to tighten.
                </p>
              </div>
            </Surface>
            <Surface className="space-y-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Planning links</p>
              <div className="grid gap-3">
                <Link className="rounded-2xl border border-[var(--line)] p-4 transition hover:border-[var(--line-strong)] hover:bg-white" href="/breeding">
                  <p className="font-medium">Adjust active pairings</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">Open the breeding workspace to start, pause, or review current setups.</p>
                </Link>
                <Link className="rounded-2xl border border-[var(--line)] p-4 transition hover:border-[var(--line-strong)] hover:bg-white" href="/experiments">
                  <p className="font-medium">Check current demand</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">Review reserved animals and experiment pressure against the projected supply.</p>
                </Link>
                <Link className="rounded-2xl border border-[var(--line)] p-4 transition hover:border-[var(--line-strong)] hover:bg-white" href="/cryostorage">
                  <p className="font-medium">Inspect frozen backups</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">Check reserve sperm or embryo stock when live colony output is not enough.</p>
                </Link>
              </div>
            </Surface>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
