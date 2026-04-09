import Link from "next/link";
import { notFound } from "next/navigation";

import { moveCageAction } from "@/app/cages/[cageId]/actions";
import { AlertFeed } from "@/components/app/alert-feed";
import { AppShell } from "@/components/app/app-shell";
import { CageMoveForm } from "@/components/app/cage-move-form";
import { CageQrCard } from "@/components/app/cage-qr-card";
import { PageHeader } from "@/components/app/page-header";
import { Surface } from "@/components/app/surface";
import { getCageDetailView } from "@/lib/cages-read";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

export default async function CageDetailPage({ params }: { params: Promise<{ cageId: string }> }) {
  const user = await requireUser();
  const { cageId } = await params;
  const snapshot = await getCageDetailView(cageId);
  const canMoveCage = user.role === "admin" || user.role === "colony_manager" || user.role === "animal_staff";

  if (!snapshot) {
    notFound();
  }

  return (
    <AppShell currentPath="/cages" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Cage detail"
          title={snapshot.cageLabel}
          description="Barcode-oriented cage workspace with occupancy, strain/genotype rollups, notes, and direct access to the linked animal records."
          badgeLabel={snapshot.cage.status}
        />
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Surface className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Barcode</p>
                <p className="mt-2 font-mono text-base">{snapshot.cage.barcode}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Last updated</p>
                <p className="mt-2 text-base">{formatDate(snapshot.cage.lastUpdatedAt)}</p>
              </div>
            </div>
            <p className="text-sm leading-7 text-[var(--muted)]">{snapshot.cage.notes}</p>
            <div className="overflow-x-auto rounded-[24px] border border-[var(--line)]">
              <table className="min-w-full border-collapse">
                <thead className="bg-[var(--surface-2)] text-left text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                  <tr>
                    {["Animal", "Sex", "Age", "Status", "Genotype", "Actions"].map((header) => (
                      <th key={header} className="px-4 py-3 font-medium">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)] bg-white/70">
                  {snapshot.occupants.map((animal) => (
                    <tr key={animal.id}>
                      <td className="px-4 py-4 font-medium">{animal.animalId}</td>
                      <td className="px-4 py-4 capitalize">{animal.sex}</td>
                      <td className="px-4 py-4">{animal.ageLabel}</td>
                      <td className="px-4 py-4 capitalize">{animal.status.replaceAll("_", " ")}</td>
                      <td className="px-4 py-4 font-mono text-xs text-[var(--muted)]">{animal.genotypeSummary}</td>
                      <td className="px-4 py-4">
                        <Link className="text-sm text-[var(--accent)]" href={`/animals/${animal.id}`}>
                          Open animal
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 border-t border-[var(--line)] pt-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Staff notes</p>
              {snapshot.notes.map((note) => (
                <article key={note.id} className="rounded-2xl border border-[var(--line)] p-4">
                  <p className="font-medium">{note.note}</p>
                  <p className="mt-2 text-sm text-[var(--muted)]">{formatDate(note.createdAt)}</p>
                </article>
              ))}
            </div>
            <div className="space-y-3 border-t border-[var(--line)] pt-4">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Movement history</p>
                <p className="text-sm text-[var(--muted)]">
                  Every cage relocation is recorded with the prior slot, destination, date, and operator-facing reason.
                </p>
              </div>
              {snapshot.movementHistory.length ? (
                snapshot.movementHistory.map((movement) => (
                  <article key={movement.id} className="rounded-2xl border border-[var(--line)] p-4">
                    <p className="font-medium">
                      {movement.fromLocation} to {movement.toLocation}
                    </p>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      {formatDate(movement.movedAt)} by {movement.movedBy}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{movement.reason}</p>
                  </article>
                ))
              ) : (
                <p className="text-sm text-[var(--muted)]">No cage moves have been recorded yet.</p>
              )}
            </div>
          </Surface>
          <div className="space-y-6">
            <CageQrCard barcode={snapshot.cage.barcode} />
            <AlertFeed alerts={snapshot.alerts} title="Cage alerts" />
            {canMoveCage ? (
              <Surface className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Cage movement</p>
                  <h2 className="font-display text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                    Move this cage and log the reason in one step.
                  </h2>
                  <p className="text-sm leading-7 text-[var(--muted)]">
                    Use this when the same barcode-tagged cage is reassigned to a new room, rack, or slot and the occupants stay with it.
                  </p>
                </div>
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
              </Surface>
            ) : null}
            <Surface className="space-y-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Quick actions</p>
              <div className="grid gap-3">
                <Link className="rounded-2xl border border-[var(--line)] p-4 hover:bg-white" href={`/scan/${snapshot.cage.barcode}`}>
                  Open mobile scan view
                </Link>
                <Link className="rounded-2xl border border-[var(--line)] p-4 hover:bg-white" href="/settings">
                  Review rule thresholds
                </Link>
              </div>
            </Surface>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
