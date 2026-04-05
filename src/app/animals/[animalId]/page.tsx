import { notFound } from "next/navigation";

import { AlertFeed } from "@/components/app/alert-feed";
import { AppShell } from "@/components/app/app-shell";
import { ExperimentReservationForm } from "@/components/app/experiment-reservation-form";
import { PageHeader } from "@/components/app/page-header";
import { Surface } from "@/components/app/surface";
import { getAnimalDetailView } from "@/lib/animals-read";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

export default async function AnimalDetailPage({ params }: { params: Promise<{ animalId: string }> }) {
  const user = await requireUser();
  const { animalId } = await params;
  const snapshot = await getAnimalDetailView(animalId);

  if (!snapshot) {
    notFound();
  }

  const canReserveAnimal = user.role === "admin" || user.role === "colony_manager" || user.role === "researcher";

  return (
    <AppShell currentPath="/animals" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Animal detail"
          title={snapshot.animal.animalId}
          description="Scientific view of one mouse with lineage, genotype history, experiment assignments, welfare notes, and audit-safe lifecycle context."
          badgeLabel={snapshot.animal.status}
        />
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <Surface className="space-y-5">
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Lab ID</p>
                  <p className="mt-2 font-medium">{snapshot.animal.labId}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Current cage</p>
                  <p className="mt-2 font-medium">{snapshot.cageLabel}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">DOB</p>
                  <p className="mt-2">{formatDate(snapshot.animal.dob)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Strain</p>
                  <p className="mt-2">{snapshot.strainName}</p>
                </div>
              </div>
              <div className="space-y-2 border-t border-[var(--line)] pt-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Genotype summary</p>
                <p className="font-mono text-sm text-[var(--muted)]">{snapshot.genotypeSummary}</p>
              </div>
              <div className="grid gap-4 border-t border-[var(--line)] pt-4 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Sire</p>
                  <p className="mt-2">{snapshot.sireAnimalId ?? "Not recorded"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Dam</p>
                  <p className="mt-2">{snapshot.damAnimalId ?? "Not recorded"}</p>
                </div>
              </div>
            </Surface>
            <Surface className="space-y-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Experiment history</p>
              <div className="space-y-3">
                {snapshot.assignments.length ? (
                  snapshot.assignments.map((assignment) => (
                    <article key={assignment.id} className="rounded-2xl border border-[var(--line)] p-4">
                      <p className="font-medium">{assignment.experimentCode}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {assignment.status} · {assignment.treatmentGroup ?? "No treatment group"}
                      </p>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-[var(--muted)]">No experiment assignments recorded.</p>
                )}
              </div>
            </Surface>
            <Surface className="space-y-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Timeline</p>
              <div className="space-y-3">
                {snapshot.timeline.map((event) => (
                  <article key={event.id} className="rounded-2xl border border-[var(--line)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{event.label}</p>
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">{formatDate(event.date)}</p>
                    </div>
                    <p className="mt-2 text-sm text-[var(--muted)]">{event.description}</p>
                  </article>
                ))}
              </div>
            </Surface>
          </div>
          <div className="space-y-6">
            <AlertFeed alerts={snapshot.alerts} title="Animal alerts" />
            {canReserveAnimal && snapshot.canReserve ? (
              <Surface className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Experiment reservation</p>
                  <h2 className="font-display text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                    Reserve this mouse for downstream study work.
                  </h2>
                  <p className="text-sm leading-7 text-[var(--muted)]">
                    Reservation runs conflict checks against current status, genotype confirmation, and existing experiment assignments before saving.
                  </p>
                </div>
                <ExperimentReservationForm animalId={snapshot.animal.id} experimentOptions={snapshot.experimentOptions} />
              </Surface>
            ) : null}
            <Surface className="space-y-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Health notes</p>
              <div className="space-y-3">
                {snapshot.notes.length ? (
                  snapshot.notes.map((note) => (
                    <article key={note.id} className="rounded-2xl border border-[var(--line)] p-4">
                      <p className="font-medium">{note.note}</p>
                      <p className="mt-2 text-sm text-[var(--muted)]">
                        {note.noteType.replaceAll("_", " ")} · {formatDate(note.createdAt)}
                      </p>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-[var(--muted)]">No health notes recorded.</p>
                )}
              </div>
            </Surface>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
