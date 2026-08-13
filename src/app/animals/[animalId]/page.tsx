import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound } from "next/navigation";

import { AlertFeed } from "@/components/app/alert-feed";
import { AnimalGenotypingForm } from "@/components/app/animal-genotyping-form";
import { AnimalLifecycleForm } from "@/components/app/animal-lifecycle-form";
import { AnimalPresenceForm } from "@/components/app/animal-presence-form";
import { AttachmentList } from "@/components/app/attachment-list";
import { AppShell } from "@/components/app/app-shell";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { ExperimentReservationForm } from "@/components/app/experiment-reservation-form";
import { HighImpactWorkflowShell } from "@/components/app/high-impact-workflow-shell";
import { LabTransferRequestForm } from "@/components/app/lab-transfer-workflow";
import { PageHeader } from "@/components/app/page-header";
import { SampleCreateForm } from "@/components/app/sample-create-form";
import { Surface } from "@/components/app/surface";
import { Badge } from "@/components/ui/badge";
import { getAnimalDetailView } from "@/lib/animals-read";
import { getAnimalPresenceCageOptions } from "@/lib/cages-read";
import { getLabTransferRequestOptions } from "@/lib/lab-transfer-read";
import { requireUser } from "@/lib/session";
import { getCurrentOperationalSopOptions } from "@/lib/sop-read";
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

  if (outcomeStatus === "missing") return [];

  if (outcomeStatus === "alive") {
    return [
      { value: "euthanized", label: "Mark euthanized" },
      { value: "dead", label: "Mark found dead" },
      { value: "transferred_out", label: "Mark transferred out" },
    ];
  }

  return [{ value: "archived", label: "Archive record" }];
}

export default async function AnimalDetailPage({ params, searchParams }: { params: Promise<{ animalId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser({ capability: "animals:read" });
  const { animalId } = await params;
  const snapshot = await getAnimalDetailView(animalId, user);

  if (!snapshot) {
    notFound();
  }

  const canReserveAnimal = user.capabilities.includes("experiments:manage");
  const canRecordGenotype = user.capabilities.includes("animals:manage") && snapshot.canRecordGenotype;
  const canRecordSample = user.capabilities.includes("biosamples:manage") && snapshot.canRecordSample;
  const canManageLifecycle = user.capabilities.includes("animals:manage");
  const query = (await searchParams) ?? {};
  const presenceCages = canManageLifecycle && snapshot.animal.outcomeStatus === "missing"
    ? await getAnimalPresenceCageOptions(snapshot.animal.id, user, query)
    : null;
  const lifecycleActions = getLifecycleActions(snapshot.animal.status, snapshot.animal.outcomeStatus);
  const lifecycleSopOptions = canManageLifecycle && lifecycleActions.some((action) => action.value === "euthanized")
    ? await getCurrentOperationalSopOptions(user, snapshot.animal.owningLabId)
    : [];
  const transferRequestOptions = snapshot.animal.outcomeStatus === "alive" && user.capabilities.includes("transfers:request")
    ? await getLabTransferRequestOptions(user)
    : null;
  const requestedAction = Array.isArray(query.action) ? query.action[0] : query.action;
  if (requestedAction === "lifecycle") {
    if (!canManageLifecycle) notFound();
    return (
      <AppShell currentPath="/animals" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
        <HighImpactWorkflowShell
          backHref={`/animals/${snapshot.animal.id}`}
          backLabel="Animal detail"
          context={[
            { label: "Animal", value: `${snapshot.animal.animalId} · ${snapshot.animal.labId}` },
            { label: "Current status", value: snapshot.animal.status },
            { label: "Current cage", value: snapshot.cageLabel },
            { label: "Open dependencies", value: `${snapshot.openBreedingCount} breeding · ${snapshot.openExperimentCount} experiments` },
          ]}
          description="Record a terminal disposition only after the event, dependencies, and exact SOP have been verified."
          title="Record terminal disposition"
        >
          {lifecycleActions.length ? <AnimalLifecycleForm
            animalId={snapshot.animal.id}
            animalLabel={`${snapshot.animal.animalId} · ${snapshot.animal.labId}`}
            allowedActions={lifecycleActions}
            commandNonce={randomUUID()}
            currentCageLabel={snapshot.cageLabel}
            defaultDate={snapshot.defaultLifecycleDate}
            openBreedingCount={snapshot.openBreedingCount}
            openExperimentCount={snapshot.openExperimentCount}
            sopOptions={lifecycleSopOptions}
            version={snapshot.animal.version}
          /> : snapshot.animal.status === "archived" ? <div className="worksheet-empty"><strong>Terminal disposition complete</strong><p>This animal is archived and has no further lifecycle action available.</p><Link className="table-action" href={`/animals/${snapshot.animal.id}`}>Return to animal detail</Link></div> : <div className="worksheet-empty"><strong>Resolve the missing-animal workflow first</strong><p>A missing animal cannot receive a terminal disposition until it is found or its status is resolved.</p><Link className="table-action" href={`/animals/${snapshot.animal.id}`}>Return to animal detail</Link></div>}
        </HighImpactWorkflowShell>
      </AppShell>
    );
  }
  const actions: CompactActionItem[] = [
    ...(canManageLifecycle && ["alive", "missing"].includes(snapshot.animal.outcomeStatus)
      ? [{
          id: "presence",
          label: snapshot.animal.outcomeStatus === "missing" ? "Mark found" : "Mark missing",
          description: "Location status",
          tone: snapshot.animal.outcomeStatus === "missing" ? "default" as const : "danger" as const,
          panel: (
            <div className="space-y-4">
              {snapshot.animal.outcomeStatus === "missing" && presenceCages ? <>
                <form action={`/animals/${snapshot.animal.id}`} className="flex flex-wrap items-end gap-3" method="get">
                  <input name="action" type="hidden" value="presence" />
                  <label className="min-w-64 flex-1 space-y-2 text-sm">
                    <span className="text-[var(--muted)]">Find a cage in this animal&apos;s lab</span>
                    <input className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4" defaultValue={presenceCages.search} name="presenceSearch" placeholder="Barcode, room, rack, or cage" />
                  </label>
                  <button className="table-action min-h-11" type="submit">Search cages</button>
                </form>
                <div className="flex items-center justify-between gap-3 text-sm text-[var(--muted)]">
                  <span>{presenceCages.totalCount} matches · page {presenceCages.page} of {presenceCages.pageCount}</span>
                  <div className="flex gap-2">
                    {presenceCages.page > 1 ? <Link className="table-action" href={`/animals/${snapshot.animal.id}?action=presence&presenceSearch=${encodeURIComponent(presenceCages.search)}&presencePage=${presenceCages.page - 1}`}>Previous</Link> : null}
                    {presenceCages.page < presenceCages.pageCount ? <Link className="table-action" href={`/animals/${snapshot.animal.id}?action=presence&presenceSearch=${encodeURIComponent(presenceCages.search)}&presencePage=${presenceCages.page + 1}`}>Next</Link> : null}
                  </div>
                </div>
              </> : null}
              <AnimalPresenceForm
                animalId={snapshot.animal.id}
                cages={presenceCages?.items ?? []}
                commandNonce={randomUUID()}
                defaultDate={snapshot.defaultLifecycleDate}
                isMissing={snapshot.animal.outcomeStatus === "missing"}
                key={presenceCages ? `${presenceCages.search}:${presenceCages.page}` : "present"}
                version={snapshot.animal.version}
              />
            </div>
          ),
        }]
      : []),
    ...(canManageLifecycle && lifecycleActions.length
      ? [
          {
            id: "lifecycle",
            label: "Record terminal disposition",
            description: "Death, euthanasia, transfer, or archive",
            href: `/animals/${snapshot.animal.id}?action=lifecycle`,
            tone: "danger" as const,
          },
        ]
      : []),
    ...(canRecordGenotype
      ? [
          {
            id: "genotype",
            label: "Record genotype",
            description: "Assay result",
            tone: "primary" as const,
            panel: (
              <AnimalGenotypingForm
                animalId={snapshot.animal.id}
                alleleOptions={snapshot.alleleOptions}
                defaultDate={snapshot.defaultGenotypeDate}
              />
            ),
          },
        ]
      : []),
    ...(canRecordSample
      ? [
          {
            id: "sample",
            label: "Record sample",
            description: "Inventory",
            panel: (
              <SampleCreateForm
                animalOptions={[
                  {
                    id: snapshot.animal.id,
                    label: `${snapshot.animal.animalId} · ${snapshot.animal.labId}`,
                  },
                ]}
                projectOptions={snapshot.projectOptions}
                experimentOptions={snapshot.experimentOptions}
                defaultAnimalId={snapshot.animal.id}
                animalSelectDisabled
                defaultCollectedAt={snapshot.defaultSampleDate}
                defaultProjectId={snapshot.defaultSampleProjectId}
              />
            ),
          },
        ]
      : []),
    ...(canReserveAnimal && snapshot.canReserve
      ? [
          {
            id: "reserve",
            label: "Reserve",
            description: "Experiment",
            panel: (
              <ExperimentReservationForm
                animalId={snapshot.animal.id}
                animalVersion={snapshot.animal.version}
                commandNonce={randomUUID()}
                defaultDate={snapshot.defaultLifecycleDate}
                experimentOptions={snapshot.experimentOptions}
              />
            ),
          },
        ]
      : []),
    ...(transferRequestOptions?.canRequest
      ? [
          {
            id: "request-lab-transfer",
            label: "Request lab transfer",
            description: "Destination approval",
            tone: "financial" as const,
            panel: (
              <div className="space-y-4">
                <div className="border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  The animal remains in this lab until destination acceptance and CMU finalization.
                </div>
                <LabTransferRequestForm
                  animalIds={[snapshot.animal.id]}
                  destinationLabs={transferRequestOptions.destinationLabs}
                  nonce={randomUUID()}
                  subjectType="animals"
                  today={snapshot.defaultLifecycleDate}
                />
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <AppShell currentPath="/animals" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Animal detail"
          title={`Animal ${snapshot.animal.animalId}`}
          badgeLabel={snapshot.animal.status}
        />
        {actions.length ? (
          <CompactActionTray
            actions={actions}
            defaultActionId={requestedAction === "presence" && presenceCages ? "presence" : undefined}
            eyebrow="Actions"
            key={requestedAction === "presence" && presenceCages ? "presence-open" : "animal-work-closed"}
            summary={
              <>
                <span>{snapshot.animal.labId}</span>
                <span>·</span>
                <span>{snapshot.cageLabel}</span>
              </>
            }
            title="Animal work"
          />
        ) : null}
        {snapshot.alerts.length ? <AlertFeed alerts={snapshot.alerts} title="Animal alerts" /> : null}
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
                    <p className="mt-2">{snapshot.animal.deathReason ?? snapshot.externalTransfer?.reason ?? "Captured in timeline event."}</p>
                  </div>
                  {snapshot.externalTransfer ? (
                    <>
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">External destination</p>
                        <p className="mt-2 wrap-value">{snapshot.externalTransfer.destination}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Transfer reference</p>
                        <p className="mt-2 wrap-value">{snapshot.externalTransfer.reference ?? "Not recorded"}</p>
                      </div>
                    </>
                  ) : null}
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
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Genotyping history</p>
                <p className="mt-2 text-sm text-[var(--muted)]">Showing up to the 50 most recent records.</p>
              </div>
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
                      <div className="mt-3">
                        <AttachmentList attachments={record.attachments} testId={`genotype-attachments-${record.id}`} />
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-[var(--muted)]">No genotyping records have been logged for this animal yet.</p>
                )}
              </div>
            </Surface>
            <Surface className="space-y-4" data-testid="sample-record-history">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Sample history</p>
                <p className="mt-2 text-sm text-[var(--muted)]">Showing up to the 50 most recent records.</p>
              </div>
              <div className="space-y-3">
                {snapshot.sampleRecords.length ? (
                  snapshot.sampleRecords.map((record) => (
                    <article key={record.id} className="rounded-2xl border border-[var(--line)] p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="font-medium">{record.sampleLabel}</p>
                        <Badge variant={record.status === "stored" ? "success" : record.status === "discarded" ? "danger" : "info"}>
                          {record.status}
                        </Badge>
                        <span className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                          {formatDate(record.collectedAt)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--muted)]">{record.sampleType}</p>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-[var(--muted)]">
                        {record.projectCode ? <span>{record.projectCode}</span> : null}
                        {record.storageLocation ? <span>{record.storageLocation}</span> : <span>Storage pending</span>}
                        {record.quantityLabel ? <span>{record.quantityLabel}</span> : null}
                      </div>
                      {record.notes ? <p className="mt-3 text-sm leading-6 text-[var(--ink)]">{record.notes}</p> : null}
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-[var(--muted)]">No sample records are linked to this animal yet.</p>
                )}
              </div>
            </Surface>
            <Surface className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Timeline</p>
                <p className="mt-2 text-sm text-[var(--muted)]">Built from the recent history shown on this page.</p>
              </div>
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
            <Surface className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Health notes</p>
                <p className="mt-2 text-sm text-[var(--muted)]">Showing up to the 50 most recent records.</p>
              </div>
              <div className="space-y-3">
                {snapshot.notes.length ? (
                  snapshot.notes.map((note) => (
                    <article key={note.id} className="rounded-2xl border border-[var(--line)] p-4">
                      <p className="font-medium">{note.note}</p>
                      <p className="mt-2 text-sm text-[var(--muted)]">
                        {note.noteType.replaceAll("_", " ")} · {formatDate(note.createdAt)}
                      </p>
                      <div className="mt-3">
                        <AttachmentList attachments={note.attachments} testId={`health-note-attachments-${note.id}`} />
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-[var(--muted)]">No health notes recorded.</p>
                )}
              </div>
            </Surface>
        </div>
      </div>
    </AppShell>
  );
}
