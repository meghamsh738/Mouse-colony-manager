import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound } from "next/navigation";

import { moveAnimalTransferAction } from "@/app/cages/animal-transfer-actions";
import {
  exitCageAction,
  moveCageAction,
  updateCageDetailsAction,
  updateCageResponsibilityAction,
} from "@/app/cages/[cageId]/actions";
import { AlertFeed } from "@/components/app/alert-feed";
import { AnimalTransferPanel } from "@/components/app/animal-transfer-panel";
import { AttachmentList } from "@/components/app/attachment-list";
import { AppShell } from "@/components/app/app-shell";
import { CageMoveForm } from "@/components/app/cage-move-form";
import { CageEditForm, CageExitForm } from "@/components/app/cage-operations-forms";
import { CageQrCard } from "@/components/app/cage-qr-card";
import { CageResponsibilityForm } from "@/components/app/cage-responsibility-form";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { ContextBand, InlineSection } from "@/components/app/layout-primitives";
import { HighImpactWorkflowShell } from "@/components/app/high-impact-workflow-shell";
import { LabTransferRequestForm } from "@/components/app/lab-transfer-workflow";
import { OperationalSection } from "@/components/app/operational-section";
import { PageHeader } from "@/components/app/page-header";
import { getAnimalTransferWorkspacePageView, getCageClosureDestinationOptions, getCageDetailView } from "@/lib/cages-read";
import { getLabTransferRequestOptions } from "@/lib/lab-transfer-read";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

export default async function CageDetailPage({ params, searchParams }: { params: Promise<{ cageId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser({ capability: "cages:read" });
  const { cageId } = await params;
  const snapshot = await getCageDetailView(cageId, user);
  const canManageCages = user.capabilities.includes("cages:manage");
  const canMoveCage = canManageCages;
  const canTransferAnimals = canManageCages;

  if (!snapshot) {
    notFound();
  }

  const isOperational = snapshot.cage.active && snapshot.cage.status !== "closed";
  const query = (await searchParams) ?? {};
  const requestedAction = Array.isArray(query.action) ? query.action[0] : query.action;
  const transferWorkspace = canTransferAnimals && isOperational && requestedAction === "move-mouse"
    ? await getAnimalTransferWorkspacePageView(cageId, user, query)
    : null;
  const closureDestinations = canMoveCage && isOperational && requestedAction === "close"
    ? await getCageClosureDestinationOptions(cageId, user, query)
    : null;
  const transferRequestOptions = isOperational && user.capabilities.includes("transfers:request")
    ? await getLabTransferRequestOptions(user)
    : null;
  const canRequestCageTransfer = Boolean(
    transferRequestOptions?.canRequest
    && transferRequestOptions.sourceLab.id === snapshot.cage.labId,
  );
  const closureChargePeriod = snapshot.cage.chargePeriodId && snapshot.cage.chargePeriodStartedAt && snapshot.cage.chargeCategoryId && snapshot.cage.chargeCategoryName && snapshot.cage.dailyRateCents !== null && snapshot.cage.currencyCode
    ? {
        id: snapshot.cage.chargePeriodId,
        categoryId: snapshot.cage.chargeCategoryId,
        categoryName: snapshot.cage.chargeCategoryName,
        dailyRateCents: snapshot.cage.dailyRateCents,
        currencyCode: snapshot.cage.currencyCode,
        startedAt: snapshot.cage.chargePeriodStartedAt,
      }
    : null;
  if (requestedAction === "close") {
    if (!canMoveCage) notFound();
    return (
      <AppShell currentPath="/cages" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
        <HighImpactWorkflowShell
          backHref={`/cages/${snapshot.cage.id}`}
          backLabel="Cage detail"
          context={[
            { label: "Cage", value: snapshot.cage.barcode },
            { label: "Location", value: snapshot.currentLocationLabel },
            { label: "Live occupants", value: snapshot.occupants.length },
            { label: "Active charge", value: closureChargePeriod ? `${closureChargePeriod.categoryName} · ${closureChargePeriod.currencyCode} ${(closureChargePeriod.dailyRateCents / 100).toFixed(2)}/day` : "Billing reconciliation required" },
          ]}
          description="Move every live occupant, review the billing cutoff, and acknowledge the permanent closure before submitting."
          title={`Permanently close ${snapshot.cage.barcode}`}
        >
          {isOperational ? <div className="space-y-4">
            <form action={`/cages/${snapshot.cage.id}`} className="flex flex-wrap items-end gap-3" method="get">
              <input name="action" type="hidden" value="close" />
              <label className="min-w-64 flex-1 space-y-2 text-sm">
                <span className="text-[var(--muted)]">Find same-lab destination cages</span>
                <input className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4" defaultValue={closureDestinations?.search ?? ""} name="destinationSearch" placeholder="Barcode, room, rack, cage, or lab" />
              </label>
              <button className="table-action min-h-11" type="submit">Search destinations</button>
            </form>
            {closureDestinations ? <div className="flex items-center justify-between gap-3 text-sm text-[var(--muted)]">
              <span>{closureDestinations.totalCount} matches · page {closureDestinations.page} of {closureDestinations.pageCount}</span>
              <div className="flex gap-2">
                {closureDestinations.page > 1 ? <Link className="table-action" href={`/cages/${snapshot.cage.id}?action=close&destinationSearch=${encodeURIComponent(closureDestinations.search)}&destinationPage=${closureDestinations.page - 1}`}>Previous</Link> : null}
                {closureDestinations.page < closureDestinations.pageCount ? <Link className="table-action" href={`/cages/${snapshot.cage.id}?action=close&destinationSearch=${encodeURIComponent(closureDestinations.search)}&destinationPage=${closureDestinations.page + 1}`}>Next</Link> : null}
              </div>
            </div> : null}
            <CageExitForm
              activeChargePeriod={closureChargePeriod}
              action={exitCageAction}
              barcode={snapshot.cage.barcode}
              cageId={snapshot.cage.id}
              commandNonce={snapshot.closureCommandNonce}
              defaultDate={snapshot.moveForm.defaultDate}
              destinationOptions={closureDestinations?.items ?? []}
              occupants={snapshot.occupants}
              version={snapshot.cage.version}
            />
          </div> : <div className="worksheet-empty"><strong>Cage already closed</strong><p>The permanent closure and billing cutoff are recorded.</p><Link className="table-action" href={`/cages/${snapshot.cage.id}`}>Return to cage detail</Link></div>}
        </HighImpactWorkflowShell>
      </AppShell>
    );
  }
  const operations: CompactActionItem[] = [
    {
      id: "qr",
      label: "QR",
      description: "Barcode card",
      panel: <CageQrCard barcode={snapshot.cage.barcode} />,
    },
    ...(canMoveCage && isOperational
      ? [
          {
            id: "edit-cage",
            label: "Edit cage",
            description: "Status and billing",
            tone: "primary" as const,
            panel: (
              <CageEditForm
                action={updateCageDetailsAction}
                canManageBilling={user.capabilities.includes("billing:manage")}
                cage={snapshot.cage}
                chargeCategoryOptions={snapshot.chargeCategoryOptions}
              />
            ),
          },
        ]
      : []),
    ...(canManageCages && isOperational
      ? [
          {
            id: "responsibility",
            label: "Assign staff",
            description: "Responsible users",
            panel: (
              <CageResponsibilityForm
                action={updateCageResponsibilityAction}
                assignments={snapshot.responsibility.assignments}
                cage={snapshot.cage}
                nonce={randomUUID()}
                options={snapshot.responsibility.options}
              />
            ),
          },
        ]
      : []),
    ...(canTransferAnimals && isOperational
      ? [
          requestedAction === "move-mouse" && transferWorkspace ? {
            id: "move-mouse",
            label: "Move mouse",
            description: "Transfer animal",
            panel: <AnimalTransferPanel action={moveAnimalTransferAction} basePath={`/cages/${snapshot.cage.id}`} key={JSON.stringify(transferWorkspace.query)} workspace={transferWorkspace} />,
          } : {
            id: "move-mouse",
            label: "Move mouse",
            description: "Transfer animal",
            href: `/cages/${snapshot.cage.id}?action=move-mouse`,
          },
        ]
      : []),
    ...(canMoveCage && isOperational
      ? [
          {
            id: "move-location",
            label: "Move location",
            description: "Room/rack/cage",
            panel: (
              <CageMoveForm
                key={snapshot.currentLocationLabel}
                action={moveCageAction}
                cageId={snapshot.cage.id}
                currentLocationLabel={snapshot.currentLocationLabel}
                defaultDate={snapshot.moveForm.defaultDate}
                defaultRoomId={snapshot.moveForm.defaultRoomId}
                defaultRackId={snapshot.moveForm.defaultRackId}
                defaultCageNumber={snapshot.moveForm.defaultCageNumber}
                roomOptions={snapshot.moveForm.roomOptions}
                rackOptions={snapshot.moveForm.rackOptions}
              />
            ),
          },
        ]
      : []),
    ...(canRequestCageTransfer && transferRequestOptions?.canRequest
      ? [
          {
            id: "transfer-lab",
            label: "Request lab transfer",
            description: "Destination approval",
            tone: "financial" as const,
            panel: (
              <div className="space-y-4">
                <div className="border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  Ownership and billing remain unchanged until the destination lab accepts and CMU finalizes.
                </div>
                <LabTransferRequestForm
                  destinationLabs={transferRequestOptions.destinationLabs}
                  nonce={randomUUID()}
                  sourceProtocols={transferRequestOptions.sourceProtocols}
                  sourceCageId={snapshot.cage.id}
                  subjectType="cage"
                  today={snapshot.moveForm.defaultDate}
                />
              </div>
            ),
          },
        ]
      : []),
    ...(canMoveCage && isOperational
      ? [
          {
            id: "close-cage",
            label: "Close cage",
            description: "Permanent closure and billing cutoff",
            href: `/cages/${snapshot.cage.id}?action=close`,
            tone: "danger" as const,
          },
        ]
      : []),
    {
      id: "links",
      label: "Links",
      description: "Open related",
      panel: (
        <div className="row-list">
          <Link className="record-row hover:bg-white" href={`/scan/${snapshot.cage.barcode}`}>
            Open mobile scan view
          </Link>
          <Link className="record-row hover:bg-white" href={`/cages/labels?cageId=${snapshot.cage.id}`}>
            Print this cage label
          </Link>
          <Link className="record-row hover:bg-white" href="/settings">
            Review rule thresholds
          </Link>
        </div>
      ),
    },
  ];

  return (
    <AppShell currentPath="/cages" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader
          breadcrumbs={[
            { href: "/cages", label: "Cages" },
            { label: snapshot.cage.barcode },
          ]}
          title={`Cage ${snapshot.cageLabel}`}
          badgeLabel={snapshot.cage.status}
        />
        <ContextBand
          sticky
          title={snapshot.cage.barcode}
          subtitle={snapshot.currentLocationLabel}
          items={[
            { label: "status", value: snapshot.cage.status },
            { label: "occupants", value: snapshot.occupants.length },
            { label: "capacity", value: `${snapshot.occupants.length} / ${snapshot.cage.capacity}` },
            {
              label: "alerts",
              value: snapshot.alerts.length,
              tone: snapshot.alerts.length ? "danger" : "success",
            },
            { label: "lab", value: snapshot.cage.labName ?? snapshot.cage.labCode ?? "Unassigned" },
            {
              label: "responsible",
              value: snapshot.responsibility.assignments.map((assignment) => assignment.name).join(", ") || "Unassigned",
            },
            {
              label: snapshot.cage.closure ? "billing cutoff" : "updated",
              value: formatDate(snapshot.cage.closure?.billingCutoffAt ?? snapshot.cage.lastUpdatedAt),
            },
          ]}
          actions={
            <>
            <Link className="action-chip action-chip-primary" href={`/scan/${snapshot.cage.barcode}`}>
              Scan
            </Link>
            {isOperational ? (
              <Link className="action-chip" href={`/scan/${snapshot.cage.barcode}#add-note`}>
                Add note
              </Link>
            ) : null}
            {canTransferAnimals && isOperational ? (
              <Link className="action-chip" href={`/cages/${snapshot.cage.id}?action=move-mouse`}>
                Move mouse
              </Link>
            ) : null}
            <Link className="action-chip" href={`/cages/labels?cageId=${snapshot.cage.id}`}>
              Print
            </Link>
            </>
          }
        />
        <CompactActionTray
          actions={operations}
          defaultActionId={requestedAction === "move-mouse" && transferWorkspace ? "move-mouse" : undefined}
          eyebrow="Operations"
          key={requestedAction === "move-mouse" && transferWorkspace ? "move-mouse-open" : "operations-closed"}
          summary={
            <>
              <span>{snapshot.cage.barcode}</span>
              <span>·</span>
              <span>{snapshot.occupants.length} occupants</span>
              <span>·</span>
              <span>{snapshot.cage.remainingCapacity} spaces</span>
            </>
          }
          title="Cage work"
        />
        <div className="min-w-0 space-y-1">
            {snapshot.cage.closure ? (
              <InlineSection title="Closure" tone="warning" meta={<><span>permanent</span><span>·</span><span>billing ended</span></>}>
                <div className="metadata-grid text-sm">
                  <div><span className="text-[var(--muted)]">Closed</span><strong className="mt-1 block">{formatDate(snapshot.cage.closure.closedAt)}</strong></div>
                  <div><span className="text-[var(--muted)]">Billing cutoff</span><strong className="mt-1 block">Start of {snapshot.cage.closure.billingCutoffAt.slice(0, 10)}</strong></div>
                  <div><span className="text-[var(--muted)]">Closed by</span><strong className="mt-1 block wrap-value">{snapshot.cage.closure.closedBy}</strong></div>
                  <div><span className="text-[var(--muted)]">Final charge period</span><strong className="mt-1 block wrap-value">{snapshot.cage.closure.chargePeriodId}</strong></div>
                  <div><span className="text-[var(--muted)]">Final rate</span><strong className="mt-1 block">{snapshot.cage.closure.chargeCategoryCode} · {snapshot.cage.closure.currencyCode} {(snapshot.cage.closure.dailyRateCents / 100).toFixed(2)}/day</strong></div>
                </div>
                <p className="mt-4 wrap-value text-sm text-[var(--muted)]">{snapshot.cage.closure.reason}</p>
              </InlineSection>
            ) : null}
            {snapshot.cage.notes ? (
              <InlineSection title="Overview">
                <p className="wrap-value text-sm leading-7 text-[var(--muted)]">{snapshot.cage.notes}</p>
              </InlineSection>
            ) : null}
            <InlineSection
              title="Animals"
              meta={
                <>
                  <span>{snapshot.occupants.length} occupants</span>
                  <span>·</span>
                  <span>{snapshot.cage.status}</span>
                </>
              }
            >
              {snapshot.occupants.length ? (
                <>
                  <div className="data-table-wrap hidden md:block">
                    <table className="data-table compact-table min-w-[680px]">
                      <thead>
                        <tr>
                          <th>Animal</th>
                          <th>Sex</th>
                          <th>Age</th>
                          <th>Status</th>
                          <th>Genotype</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.occupants.map((animal) => (
                          <tr key={animal.id}>
                            <td>
                              <Link className="wrap-value font-semibold hover:text-[var(--accent)]" href={`/animals/${animal.id}`}>
                                {animal.animalId}
                              </Link>
                            </td>
                            <td className="capitalize">{animal.sex}</td>
                            <td>{animal.ageLabel}</td>
                            <td className="capitalize">{animal.status.replaceAll("_", " ")}</td>
                            <td className="wrap-value text-sm text-[var(--muted)]">{animal.genotypeSummary}</td>
                            <td>
                              <Link className="table-action" href={`/animals/${animal.id}`}>
                                Open
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="md:hidden">
                    <div className="row-list">
                      {snapshot.occupants.map((animal) => (
                        <article className="record-row" key={animal.id}>
                          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <Link className="wrap-value font-semibold hover:text-[var(--accent)]" href={`/animals/${animal.id}`}>
                                {animal.animalId}
                              </Link>
                              <p className="metadata-line mt-1">
                                <span>{animal.sex}</span>
                                <span>·</span>
                                <span>{animal.ageLabel}</span>
                                <span>·</span>
                                <span>{animal.status.replaceAll("_", " ")}</span>
                              </p>
                            </div>
                            <Link className="table-action" href={`/animals/${animal.id}`}>
                              Open
                            </Link>
                          </div>
                          <p className="wrap-value font-mono text-xs text-[var(--muted)]">{animal.genotypeSummary}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-[var(--muted)]">No occupants are currently assigned to this cage.</p>
              )}
            </InlineSection>
            <InlineSection
              title="Warnings"
              meta={
                <>
                  <span>{snapshot.alerts.length} open</span>
                  <span>·</span>
                  <span>{snapshot.alerts.length ? "review required" : "clear"}</span>
                </>
              }
              tone={snapshot.alerts.length ? "warning" : "default"}
            >
              {snapshot.alerts.length ? (
                <AlertFeed alerts={snapshot.alerts} title="Cage alerts" />
              ) : (
                <p className="status-band text-sm text-[var(--muted)]">No open warnings for this cage.</p>
              )}
            </InlineSection>
            <OperationalSection eyebrow="Notes" title="Staff notes">
              <p className="mb-3 text-sm text-[var(--muted)]">Showing up to the 50 most recent notes.</p>
              <div className="row-list">
                {snapshot.notes.length ? (
                  snapshot.notes.map((note) => (
                    <article key={note.id} className="record-row">
                      <p className="wrap-value font-medium">{note.note}</p>
                      <p className="text-sm text-[var(--muted)]">{formatDate(note.createdAt)}</p>
                      <div className="mt-3">
                        <AttachmentList attachments={note.attachments} testId={`cage-note-attachments-${note.id}`} />
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-[var(--muted)]">No staff notes have been logged yet.</p>
                )}
              </div>
            </OperationalSection>
            <OperationalSection eyebrow="History" title="Movement history">
              <p className="mb-3 text-sm text-[var(--muted)]">Showing up to the 50 most recent cage moves.</p>
              <div className="row-list">
                {snapshot.movementHistory.length ? (
                  snapshot.movementHistory.map((movement) => (
                    <article key={movement.id} className="record-row">
                      <p className="wrap-value font-medium">
                        {movement.fromLocation} to {movement.toLocation}
                      </p>
                      <p className="metadata-line">
                        <span>{formatDate(movement.movedAt)}</span>
                        <span>·</span>
                        <span>{movement.movedBy}</span>
                      </p>
                      <p className="wrap-value text-sm leading-6 text-[var(--muted)]">{movement.reason}</p>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-[var(--muted)]">No cage moves have been recorded yet.</p>
                )}
              </div>
            </OperationalSection>
        </div>
      </div>
    </AppShell>
  );
}
