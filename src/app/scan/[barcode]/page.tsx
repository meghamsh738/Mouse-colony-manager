import Link from "next/link";
import { notFound } from "next/navigation";

import { AlertFeed } from "@/components/app/alert-feed";
import { AttachmentList } from "@/components/app/attachment-list";
import { AppShell } from "@/components/app/app-shell";
import { CageHealthNoteForm } from "@/components/app/cage-health-note-form";
import { CageMoveForm } from "@/components/app/cage-move-form";
import { PageHeader } from "@/components/app/page-header";
import { Surface } from "@/components/app/surface";
import { moveCageFromScanAction } from "@/app/scan/[barcode]/actions";
import { getScanCageViewByBarcode } from "@/lib/cages-read";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

export default async function ScanDetailPage({ params }: { params: Promise<{ barcode: string }> }) {
  const user = await requireUser();
  const { barcode } = await params;
  const snapshot = await getScanCageViewByBarcode(barcode);
  const canMoveCage = user.role === "admin" || user.role === "colony_manager" || user.role === "animal_staff";

  if (!snapshot) {
    notFound();
  }

  return (
    <AppShell currentPath="/scan" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Mobile cage workspace"
          title={`${snapshot.cage.roomNumber} / ${snapshot.cage.rackNumber} / ${snapshot.cage.cageNumber}`}
          description="This view is tuned for quick actions after scanning: occupancy, sex mix, open alerts, recent notes, and direct access to the matching cage record."
          badgeLabel={snapshot.cage.barcode}
        />
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Surface className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: "Status", value: snapshot.cage.status },
                { label: "Occupants", value: String(snapshot.occupants.length) },
                { label: "Flags", value: snapshot.cage.welfareFlags.join(", ") || "None" },
                { label: "Notes", value: snapshot.notes.length ? `${snapshot.notes.length} recorded` : "None" },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-[var(--line)] bg-white/70 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">{item.label}</p>
                  <p className="mt-2 font-medium capitalize">{item.value}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-3">
              {snapshot.occupants.map((animal) => (
                <article key={animal.id} className="rounded-2xl border border-[var(--line)] p-4">
                  <p className="font-medium">{animal.animalId}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {animal.sex} · {animal.status.replaceAll("_", " ")} · {animal.healthStatus}
                  </p>
                </article>
              ))}
            </div>
          </Surface>
          <div className="space-y-6">
            <AlertFeed alerts={snapshot.alerts} title="Open alerts" />
            <Surface className="space-y-3">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Quick note entry</p>
                <h2 className="font-display text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                  Log welfare context without leaving the cage round.
                </h2>
              </div>
              <CageHealthNoteForm barcode={snapshot.cage.barcode} cageId={snapshot.cage.id} />
            </Surface>
            <Surface className="space-y-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Recent notes</p>
              <div className="space-y-3">
                {snapshot.notes.length ? (
                  snapshot.notes.map((note) => (
                    <article key={note.id} className="rounded-2xl border border-[var(--line)] p-4">
                      <p className="font-medium">{note.note}</p>
                      <p className="mt-2 text-sm text-[var(--muted)]">{formatDate(note.createdAt)}</p>
                      <div className="mt-3">
                        <AttachmentList attachments={note.attachments} testId={`scan-note-attachments-${note.id}`} />
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-[var(--muted)]">No cage notes have been logged yet.</p>
                )}
              </div>
            </Surface>
            {canMoveCage ? (
              <Surface className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Move cage</p>
                  <h2 className="font-display text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                    Reassign the cage location during the room round.
                  </h2>
                  <p className="text-sm leading-7 text-[var(--muted)]">
                    This keeps the barcode stable while updating the live room, rack, and slot for the cage and its occupants.
                  </p>
                </div>
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
                  <div className="space-y-3 border-t border-[var(--line)] pt-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Recent moves</p>
                    {snapshot.movementHistory.map((movement) => (
                      <article key={movement.id} className="rounded-2xl border border-[var(--line)] p-4">
                        <p className="font-medium">
                          {movement.fromLocation} to {movement.toLocation}
                        </p>
                        <p className="mt-2 text-sm text-[var(--muted)]">{formatDate(movement.movedAt)}</p>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{movement.reason}</p>
                      </article>
                    ))}
                  </div>
                ) : null}
              </Surface>
            ) : null}
            <Surface className="space-y-3">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Linked workspaces</p>
              <div className="grid gap-3">
                <Link className="rounded-2xl border border-[var(--line)] p-4 hover:bg-white" href={`/cages/${snapshot.cage.id}`}>
                  Open full cage record
                </Link>
                {snapshot.occupants[0] ? (
                  <Link className="rounded-2xl border border-[var(--line)] p-4 hover:bg-white" href={`/animals/${snapshot.occupants[0].id}`}>
                    Open first occupant record
                  </Link>
                ) : null}
              </div>
            </Surface>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
