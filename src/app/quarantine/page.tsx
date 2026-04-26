import Link from "next/link";

import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { StatStrip } from "@/components/app/stat-strip";
import { Surface } from "@/components/app/surface";
import { Badge } from "@/components/ui/badge";
import { getQuarantineSentinelView } from "@/lib/quarantine-read";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

function boolLabel(value: boolean) {
  return value ? "due" : "current";
}

export default async function QuarantinePage() {
  const user = await requireUser();
  const view = await getQuarantineSentinelView();

  return (
    <AppShell currentPath="/quarantine" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Quarantine"
          title="Quarantine and sentinel tracking."
          description="Review quarantine cages, open welfare follow-up, sentinel check timing, and review age before moving animals back into standard colony workflows."
          badgeLabel={`${view.rules.sentinelCheckIntervalDays}d sentinel interval`}
        />
        <StatStrip
          stats={[
            { label: "Quarantine cages", value: view.summary.quarantineCages, hint: "Cages currently marked quarantine", emphasis: "info" },
            { label: "Animals", value: view.summary.quarantineAnimals, hint: "Live occupants in quarantine cages", emphasis: "neutral" },
            { label: "Sentinel due", value: view.summary.sentinelDue, hint: "Need a fresh sentinel or welfare check", emphasis: view.summary.sentinelDue ? "warning" : "success" },
            { label: "Review due", value: view.summary.reviewDue, hint: "Past quarantine review threshold", emphasis: view.summary.reviewDue ? "warning" : "success" },
            { label: "Open follow-up", value: view.summary.openFollowups, hint: "Unresolved notes or required follow-up", emphasis: "warning" },
            { label: "Critical", value: view.summary.criticalConcerns, hint: "Critical unresolved concerns", emphasis: view.summary.criticalConcerns ? "danger" : "success" },
          ]}
        />
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Surface className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line)] pb-4">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Cage queue</p>
                <h2 className="font-display text-2xl font-semibold tracking-[-0.04em]">Quarantine cages</h2>
              </div>
              <Link className="text-sm font-medium text-[var(--accent)]" href="/cages">
                Open cage list
              </Link>
            </div>
            <div className="space-y-3" data-testid="quarantine-cage-list">
              {view.cages.map((cage) => (
                <article key={cage.id} className="rounded-[24px] border border-[var(--line)] bg-white/70 p-4" data-testid={`quarantine-cage-${cage.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-[var(--ink)]">{cage.label}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">{cage.barcode}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={cage.sentinelDue ? "warning" : "success"}>sentinel {boolLabel(cage.sentinelDue)}</Badge>
                      <Badge variant={cage.reviewDue ? "warning" : "success"}>review {boolLabel(cage.reviewDue)}</Badge>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Occupants</p>
                      <p className="mt-1 text-[var(--ink)]">{cage.occupantCount}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Last check</p>
                      <p className="mt-1 text-[var(--ink)]">
                        {cage.daysSinceLastCheck === null ? "No note" : `${cage.daysSinceLastCheck} days ago`}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Follow-up</p>
                      <p className="mt-1 text-[var(--ink)]">{cage.unresolvedNoteCount} open</p>
                    </div>
                  </div>
                  {cage.latestNote ? (
                    <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={cage.latestNote.severity === "critical" ? "danger" : cage.latestNote.severity === "warning" ? "warning" : "info"}>
                          {cage.latestNote.severity}
                        </Badge>
                        <span className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                          {cage.latestNote.noteType.replaceAll("_", " ")} · {formatDate(cage.latestNote.createdAt)}
                        </span>
                      </div>
                      <p className="mt-2 leading-6 text-[var(--ink)]">{cage.latestNote.note}</p>
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {cage.welfareFlags.map((flag) => (
                      <Badge key={flag} variant="neutral">{flag}</Badge>
                    ))}
                  </div>
                  <div className="mt-4">
                    <Link className="text-sm font-medium text-[var(--accent)]" href={`/cages/${cage.id}`}>
                      Open cage workspace
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </Surface>
          <div className="space-y-6">
            <Surface className="space-y-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Sentinel rules</p>
              <div className="grid gap-4 text-sm">
                <div>
                  <p className="font-medium text-[var(--ink)]">Sentinel interval</p>
                  <p className="mt-1 text-[var(--muted)]">{view.rules.sentinelCheckIntervalDays} days between checks</p>
                </div>
                <div>
                  <p className="font-medium text-[var(--ink)]">Quarantine review</p>
                  <p className="mt-1 text-[var(--muted)]">{view.rules.quarantineReviewDays} days before manager review is due</p>
                </div>
              </div>
              <Link className="inline-flex text-sm font-medium text-[var(--accent)]" href="/settings">
                Edit thresholds
              </Link>
            </Surface>
            <Surface className="space-y-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Occupants</p>
              <div className="space-y-3">
                {view.cages.flatMap((cage) =>
                  cage.occupants.map((animal) => (
                    <Link
                      key={animal.id}
                      className="block rounded-2xl border border-[var(--line)] bg-white/70 p-4 transition hover:border-[var(--line-strong)] hover:bg-white"
                      href={`/animals/${animal.id}`}
                    >
                      <p className="font-medium text-[var(--ink)]">{animal.animalId}</p>
                      <p className="mt-1 text-sm capitalize text-[var(--muted)]">
                        {animal.sex} · {animal.strain}
                      </p>
                    </Link>
                  )),
                )}
              </div>
            </Surface>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
