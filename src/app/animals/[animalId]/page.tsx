import { notFound } from "next/navigation";

import { AlertFeed } from "@/components/app/alert-feed";
import { AnimalGenotypingForm } from "@/components/app/animal-genotyping-form";
import { AnimalLifecycleForm } from "@/components/app/animal-lifecycle-form";
import { AppShell } from "@/components/app/app-shell";
import { ExperimentReservationForm } from "@/components/app/experiment-reservation-form";
import { PageHeader } from "@/components/app/page-header";
import { Surface } from "@/components/app/surface";
import { Badge } from "@/components/ui/badge";
import { getAnimalDetailView } from "@/lib/animals-read";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

function genotypeStatusVariant(status: "pending" | "provisional" | "confirmed" | "conflict") {
  if (status === "confirmed") {
    return "success";
  }

  if (status === "provisional") {
    return "info";
  }

  if (status === "conflict") {
    return "danger";
  }

  return "warning";
}

function getLifecycleActions(
  status: string,
  outcomeStatus: string,
): Array<{ value: "euthanized" | "dead" | "transferred_out" | "archived"; label: string }> {
  if (status === "archived") {
    return [];
  }

  if (outcomeStatus === "alive") {
    return [
      { value: "euthanized", label: "Mark euthanized" },
      { value: "dead", label: "Mark found dead" },
      { value: "transferred_out", label: "Mark transferred out" },
    ];
  }

  return [{ value: "archived", label: "Archive record" }];
}

export default async function AnimalDetailPage({ params }: { params: Promise<{ animalId: string }> }) {
  const user = await requireUser();
  const { animalId } = await params;
  const snapshot = await getAnimalDetailView(animalId);

  if (!snapshot) {
    notFound();
  }

  const canReserveAnimal = user.role === "admin" || user.role === "colony_manager" || user.role === "researcher";
  const canRecordGenotype = user.role !== "read_only" && snapshot.canRecordGenotype;
  const canManageLifecycle = user.role === "admin" || user.role === "colony_manager" || user.role === "animal_staff";
  const lifecycleActions = getLifecycleActions(snapshot.animal.status, snapshot.animal.outcomeStatus);

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
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Experimental status</p>
                  <p className="mt-2">{snapshot.animal.experimentalStatus}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Outcome</p>
                  <p className="mt-2">{snapshot.animal.outcomeStatus.replaceAll("_", " ")}</p>
                </div>
              </div>
              <div className="space-y-2 border-t border-[var(--line)] pt-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Genotype summary</p>
                <p className="font-mono text-sm text-[var(--muted)]">{snapshot.genotypeSummary}</p>
              </div>
              {snapshot.animal.outcomeStatus !== "alive" || snapshot.animal.status === "archived" ? (
                <div className="grid gap-4 border-t border-[var(--line)] pt-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Disposition date</p>
                    <p className="mt-2">{snapshot.animal.deathDate ? formatDate(snapshot.animal.deathDate) : "See timeline"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Disposition note</p>
                    <p className="mt-2">{snapshot.animal.deathReason ?? "Captured in timeline event."}</p>
                  </div>
                </div>
              ) : null}
              <div className="space-y-3 border-t border-[var(--line)] pt-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Effective allele calls</p>
                {snapshot.effectiveAlleles.length ? (
                  <div className="flex flex-wrap gap-2">
                    {snapshot.effectiveAlleles.map((allele) => (
                      <div
                        key={allele.id}
                        className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink)]"
                      >
                        <span className="font-medium">{allele.alleleName}</span>
                        <span className="ml-2 font-mono text-[var(--muted)]">{allele.zygosity}</span>
                        <Badge className="ml-3" variant={genotypeStatusVariant(allele.callStatus)}>
                          {allele.callStatus}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--muted)]">No effective allele calls are recorded for this animal yet.</p>
                )}
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
            <Surface className="space-y-4" data-testid="genotype-record-history">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Genotyping history</p>
              <div className="space-y-3">
                {snapshot.genotypingRecords.length ? (
                  snapshot.genotypingRecords.map((record) => (
                    <article key={record.id} className="rounded-2xl border border-[var(--line)] p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="font-medium">{record.markerTested}</p>
                        <Badge variant={genotypeStatusVariant(record.status)}>{record.status}</Badge>
                        <span className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                          {formatDate(record.resultDate)}
                        </span>
                      </div>
                      <p className="mt-2 font-mono text-sm text-[var(--muted)]">{record.finalCall}</p>
                      <p className="mt-3 text-sm leading-6 text-[var(--ink)]">{record.resultText}</p>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-[var(--muted)]">
                        <span>{record.sourceType}</span>
                        <span>{record.assayType}</span>
                        <span>Sampled {formatDate(record.sampleDate)}</span>
                        {record.confidence ? <span>Confidence {record.confidence}</span> : null}
                        {record.sampleId ? <span>Sample {record.sampleId}</span> : null}
                        {record.provider ? <span>{record.provider}</span> : null}
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-[var(--muted)]">No genotyping records have been logged for this animal yet.</p>
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
            {canManageLifecycle ? (
              <Surface className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Lifecycle control</p>
                  <h2 className="font-display text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                    Record terminal disposition without deleting the mouse.
                  </h2>
                  <p className="text-sm leading-7 text-[var(--muted)]">
                    Lifecycle changes remove the animal from active colony views, clear cage occupancy, end open allocations,
                    and preserve a full status-event trail for audits.
                  </p>
                </div>
                {lifecycleActions.length ? (
                  <AnimalLifecycleForm
                    animalId={snapshot.animal.id}
                    allowedActions={lifecycleActions}
                    defaultDate={snapshot.defaultLifecycleDate}
                  />
                ) : (
                  <p className="text-sm text-[var(--muted)]">This animal is already archived and cannot move to another lifecycle state.</p>
                )}
              </Surface>
            ) : null}
            {canRecordGenotype ? (
              <Surface className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Genotype entry</p>
                  <h2 className="font-display text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                    Record one assay and update the active allele call.
                  </h2>
                  <p className="text-sm leading-7 text-[var(--muted)]">
                    Each submission creates a full genotyping record, updates the current allele state, and clears pending
                    genotype blockers once all active loci are confirmed.
                  </p>
                </div>
                <AnimalGenotypingForm
                  animalId={snapshot.animal.id}
                  alleleOptions={snapshot.alleleOptions}
                  defaultDate={snapshot.defaultGenotypeDate}
                />
              </Surface>
            ) : null}
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
