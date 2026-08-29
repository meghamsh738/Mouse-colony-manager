import { randomUUID } from "node:crypto";

import Link from "next/link";
import { Building2, CircleX, ExternalLink, HeartPulse, MapPin, MoveRight, Pencil, Printer } from "lucide-react";
import { notFound } from "next/navigation";

import { updateCageDetailsAction, updateCageResponsibilityAction } from "@/app/cages/[cageId]/actions";
import { moveAnimalTransferAction } from "@/app/cages/animal-transfer-actions";
import { moveCageFromScanAction } from "@/app/scan/[barcode]/actions";
import { AlertFeed } from "@/components/app/alert-feed";
import { AnimalTransferPanel } from "@/components/app/animal-transfer-panel";
import { AttachmentList } from "@/components/app/attachment-list";
import { AppShell } from "@/components/app/app-shell";
import { CageHealthNoteForm } from "@/components/app/cage-health-note-form";
import { CageMoveForm } from "@/components/app/cage-move-form";
import { CageEditForm } from "@/components/app/cage-operations-forms";
import { CageResponsibilityForm } from "@/components/app/cage-responsibility-form";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { ContextBand, InlineSection } from "@/components/app/layout-primitives";
import { LabTransferRequestForm } from "@/components/app/lab-transfer-workflow";
import { OperationalSection } from "@/components/app/operational-section";
import { PageHeader } from "@/components/app/page-header";
import { getAnimalTransferWorkspacePageView, getScanCageViewByBarcode } from "@/lib/cages-read";
import { getLabTransferRequestOptions } from "@/lib/lab-transfer-read";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

export default async function ScanDetailPage({ params, searchParams }: { params: Promise<{ barcode: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser({ capability: "scan:use" });
  const { barcode } = await params;
  const snapshot = await getScanCageViewByBarcode(barcode, user);
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
    ? await getAnimalTransferWorkspacePageView(snapshot.cage.id, user, query)
    : null;
  const transferRequestOptions = isOperational && user.capabilities.includes("transfers:request")
    ? await getLabTransferRequestOptions(user)
    : null;
  const canRequestCageTransfer = Boolean(
    transferRequestOptions?.canRequest
    && transferRequestOptions.sourceLab.id === snapshot.cage.labId,
  );
  const alertCountLabel = snapshot.alerts.length === 1 ? "1 alert" : `${snapshot.alerts.length} alerts`;
  const routineOperations: CompactActionItem[] = isOperational ? [
    {
      id: "add-note",
      label: "Add note",
      description: "Health check",
      icon: <HeartPulse aria-hidden="true" size={16} />,
      tone: "primary",
      panel: (
        <CageHealthNoteForm
          barcode={snapshot.cage.barcode}
          cageId={snapshot.cage.id}
          identityLabel={`${snapshot.cage.currentLocationLabel} · ${snapshot.occupants.length} occupants · ${alertCountLabel}`}
        />
      ),
    },
    ...(canTransferAnimals
      ? [
          requestedAction === "move-mouse" && transferWorkspace ? {
            id: "move-mouse",
            label: "Move mouse",
            description: "Transfer animal",
            icon: <MoveRight aria-hidden="true" size={16} />,
            panel: <AnimalTransferPanel action={moveAnimalTransferAction} basePath={`/scan/${encodeURIComponent(snapshot.cage.barcode)}`} key={JSON.stringify(transferWorkspace.query)} workspace={transferWorkspace} />,
          } : {
            id: "move-mouse",
            label: "Move mouse",
            description: "Transfer animal",
            href: `/scan/${encodeURIComponent(snapshot.cage.barcode)}?action=move-mouse`,
            icon: <MoveRight aria-hidden="true" size={16} />,
          },
        ]
      : []),
  ] : [];
  const adminOperations: CompactActionItem[] = [
    ...(canMoveCage && isOperational
      ? [
          {
            id: "edit-cage",
            label: "Edit cage",
            description: "Status and billing",
            icon: <Pencil aria-hidden="true" size={16} />,
            panel: (
              <div className="space-y-3">
                <p className="text-sm text-[var(--muted)]">
                  Barcode stays fixed. Use move location for room/rack/cage changes.
                </p>
                <CageEditForm
                  action={updateCageDetailsAction}
                  canManageBilling={user.capabilities.includes("billing:manage")}
                  cage={snapshot.cage}
                  chargeCategoryOptions={snapshot.chargeCategoryOptions}
                />
              </div>
            ),
          },
          {
            id: "move-location",
            label: "Move location",
            description: "Room/rack/cage",
            icon: <MapPin aria-hidden="true" size={16} />,
            panel: (
              <div className="space-y-4">
                <CageMoveForm
                  key={snapshot.cage.currentLocationLabel}
                  action={moveCageFromScanAction.bind(null, barcode)}
                  cageId={snapshot.cage.id}
                  currentLocationLabel={snapshot.cage.currentLocationLabel}
                  defaultDate={snapshot.moveForm.defaultDate}
                  defaultRoomId={snapshot.moveForm.defaultRoomId}
                  defaultRackId={snapshot.moveForm.defaultRackId}
                  defaultCageNumber={snapshot.moveForm.defaultCageNumber}
                  roomOptions={snapshot.moveForm.roomOptions}
                  rackOptions={snapshot.moveForm.rackOptions}
                />
                {snapshot.movementHistory.length ? (
                  <div className="border-t border-[var(--line)] pt-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Recent moves</p>
                    <div className="row-list mt-3">
                      {snapshot.movementHistory.map((movement) => (
                        <article key={movement.id} className="record-row">
                          <p className="wrap-value font-medium">
                            {movement.fromLocation} to {movement.toLocation}
                          </p>
                          <p className="metadata-line">
                            <span>{formatDate(movement.movedAt)}</span>
                            <span>·</span>
                            <span>{movement.reason}</span>
                          </p>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ),
          },
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
    ...(canRequestCageTransfer && transferRequestOptions?.canRequest
      ? [
          {
            id: "transfer-lab",
            label: "Request lab transfer",
            description: "Destination approval",
            icon: <Building2 aria-hidden="true" size={16} />,
            tone: "financial" as const,
            panel: (
              <div className="space-y-4">
                <div className="border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  Ownership and billing remain unchanged until destination acceptance and CMU finalization.
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
    {
      id: "print-label",
      label: "Print cage label",
      description: "Barcode and QR",
      href: `/cages/labels?cageId=${snapshot.cage.id}`,
      icon: <Printer aria-hidden="true" size={16} />,
    },
    {
      id: "links",
      label: "Links",
      description: "Open related",
      icon: <ExternalLink aria-hidden="true" size={16} />,
      panel: (
        <div className="row-list">
          <Link className="record-row hover:bg-white" href={`/cages/${snapshot.cage.id}`}>
            Open full cage record
          </Link>
          {snapshot.occupants[0] ? (
            <Link className="record-row hover:bg-white" href={`/animals/${snapshot.occupants[0].id}`}>
              Open first occupant record
            </Link>
          ) : null}
        </div>
      ),
    },
  ];
  const dangerOperations: CompactActionItem[] = canMoveCage && isOperational
    ? [
        {
          id: "close-cage",
          label: "Close cage",
          description: `${snapshot.occupants.length} live occupant${snapshot.occupants.length === 1 ? "" : "s"} · ends charging`,
          href: `/cages/${snapshot.cage.id}?action=close`,
          icon: <CircleX aria-hidden="true" size={16} />,
          tone: "danger",
        },
      ]
    : [];

  return (
    <AppShell currentPath="/scan" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader
          breadcrumbs={[
            { href: "/scan", label: "Scan" },
            { href: "/cages", label: "Cages" },
            { label: snapshot.cage.barcode },
          ]}
          title={`Cage ${snapshot.cage.roomNumber} / ${snapshot.cage.rackNumber} / ${snapshot.cage.cageNumber}`}
          badgeLabel={snapshot.cage.barcode}
        />
        <ContextBand
          sticky
          title={snapshot.cage.barcode}
          subtitle={snapshot.cage.currentLocationLabel}
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
            ...(snapshot.cage.closure
              ? [{ label: "billing cutoff", value: formatDate(snapshot.cage.closure.billingCutoffAt) }]
              : []),
          ]}
          actions={
            <>
              <Link className="action-chip action-chip-primary" href="/scan">
                Scan next
              </Link>
              <Link className="action-chip" href="/scan">
                Rescan
              </Link>
              <Link className="action-chip" href={`/cages/${snapshot.cage.id}`}>
                Open cage
              </Link>
            </>
          }
        />
        <div className="space-y-1">
          {snapshot.cage.closure ? (
            <InlineSection title="Closure" tone="warning" meta={<><span>permanent</span><span>·</span><span>billing ended</span></>}>
              <div className="metadata-grid text-sm">
                <div><span className="text-[var(--muted)]">Closed</span><strong className="mt-1 block">{formatDate(snapshot.cage.closure.closedAt)}</strong></div>
                <div><span className="text-[var(--muted)]">Billing cutoff</span><strong className="mt-1 block">Start of {snapshot.cage.closure.billingCutoffAt.slice(0, 10)}</strong></div>
                <div><span className="text-[var(--muted)]">Closed by</span><strong className="mt-1 block wrap-value">{snapshot.cage.closure.closedBy}</strong></div>
                <div><span className="text-[var(--muted)]">Final rate</span><strong className="mt-1 block">{snapshot.cage.closure.chargeCategoryCode} · {snapshot.cage.closure.currencyCode} {(snapshot.cage.closure.dailyRateCents / 100).toFixed(2)}/day</strong></div>
              </div>
              <p className="mt-4 wrap-value text-sm text-[var(--muted)]">{snapshot.cage.closure.reason}</p>
            </InlineSection>
          ) : null}
          {snapshot.alerts.length ? (
            <OperationalSection defaultOpen eyebrow="Priority" title="Warnings">
              <AlertFeed alerts={snapshot.alerts} title="Open alerts" />
            </OperationalSection>
          ) : null}
          <InlineSection
            title="Animals"
            meta={
              <>
                <span>{snapshot.occupants.length} occupants</span>
                <span>·</span>
                <span>{snapshot.cage.status}</span>
                <span>·</span>
                <span>{snapshot.cage.remainingCapacity} spaces</span>
              </>
            }
          >
            <div className="row-list">
              {snapshot.occupants.length ? (
                snapshot.occupants.map((animal) => (
                  <article key={animal.id} className="record-row md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <div className="flex min-w-0 flex-wrap items-start gap-3">
                      <div className="min-w-0">
                        <p className="wrap-value font-medium">{animal.animalId}</p>
                        <p className="metadata-line mt-1">
                          <span>{animal.sex}</span>
                          <span>·</span>
                          <span>{animal.status.replaceAll("_", " ")}</span>
                          <span>·</span>
                          <span>{animal.healthStatus}</span>
                        </p>
                      </div>
                    </div>
                    <Link className="table-action justify-self-start md:justify-self-end" href={`/animals/${animal.id}`}>
                      Open
                    </Link>
                  </article>
                ))
              ) : (
                <p className="p-4 text-sm text-[var(--muted)]">No occupants are currently assigned to this cage.</p>
              )}
            </div>
          </InlineSection>
          {routineOperations.length ? (
            <CompactActionTray
              actions={routineOperations}
              defaultActionId={requestedAction === "move-mouse" && transferWorkspace ? "move-mouse" : undefined}
              eyebrow="Daily work"
              key={requestedAction === "move-mouse" && transferWorkspace ? "move-mouse-open" : "daily-work-closed"}
              summary={<span>{snapshot.occupants.length} occupants · {alertCountLabel}</span>}
              title="Cage work"
            />
          ) : null}
          <CompactActionTray
            actions={adminOperations}
            className="scan-admin-actions"
            eyebrow="Secondary"
            title="Admin operations"
          />
          {dangerOperations.length ? (
            <CompactActionTray
              actions={dangerOperations}
              className="scan-danger-actions"
              eyebrow="High impact"
              title="Danger zone"
            />
          ) : null}
          {snapshot.notes.length ? (
            <OperationalSection eyebrow="History" title="Recent notes">
              <p className="mb-3 text-sm text-[var(--muted)]">
                Showing up to 15 recent notes. <Link className="font-medium underline" href={`/cages/${snapshot.cage.id}`}>Open the cage record</Link> for more history.
              </p>
              <div className="row-list">
                {snapshot.notes.map((note) => (
                  <article key={note.id} className="record-row">
                    <p className="wrap-value font-medium">{note.note}</p>
                    <p className="text-sm text-[var(--muted)]">{formatDate(note.createdAt)}</p>
                    <div className="mt-3">
                      <AttachmentList attachments={note.attachments} testId={`scan-note-attachments-${note.id}`} />
                    </div>
                  </article>
                ))}
              </div>
            </OperationalSection>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
