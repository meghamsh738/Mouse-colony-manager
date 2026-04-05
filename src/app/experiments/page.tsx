import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { Surface } from "@/components/app/surface";
import { getColonyData, getExperimentCandidates, getExperimentOverview } from "@/lib/colony";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

export default async function ExperimentsPage() {
  const user = await requireUser();
  await getColonyData();
  const overview = getExperimentOverview();
  const candidates = getExperimentCandidates();

  return (
    <AppShell currentPath="/experiments" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Experiments"
          title="Assignment conflicts and candidate selection."
          description="Review active and planned experiments, then use the distribution helper output to pick balanced animals without colliding with welfare, genotype, or reservation constraints."
        />
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Surface className="space-y-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Experiment overview</p>
            <div className="space-y-3">
              {overview.map((experiment) => (
                <article key={experiment.id} className="rounded-2xl border border-[var(--line)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{experiment.experimentCode}</p>
                      <p className="text-sm text-[var(--muted)]">{experiment.title}</p>
                    </div>
                    <p className="text-sm capitalize text-[var(--muted)]">{experiment.status}</p>
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted)]">{experiment.project?.projectCode}</p>
                  <div className="mt-3 space-y-2">
                    {experiment.assignments.map((assignment) => (
                      <div key={assignment.id} className="rounded-2xl bg-[var(--surface-2)] px-4 py-3 text-sm">
                        <p>{assignment.animalId}</p>
                        <p className="text-[var(--muted)]">
                          {assignment.status} · starts {formatDate(assignment.startDate)}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </Surface>
          <Surface className="space-y-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Distribution helper</p>
            <div className="space-y-3">
              {candidates.map((candidate) => (
                <article key={candidate.animalId} className="rounded-2xl border border-[var(--line)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{candidate.animalId}</p>
                    <p className="font-display text-2xl font-semibold tracking-[-0.05em]">{candidate.score}</p>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">{candidate.inclusionReason}</p>
                  <p className="mt-2 text-sm text-[var(--muted)]">{candidate.cageLabel}</p>
                  {candidate.warnings.length ? (
                    <p className="mt-2 text-sm text-amber-900">{candidate.warnings.join(" · ")}</p>
                  ) : null}
                </article>
              ))}
            </div>
          </Surface>
        </div>
      </div>
    </AppShell>
  );
}
