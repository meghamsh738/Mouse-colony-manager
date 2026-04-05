import Link from "next/link";
import { notFound } from "next/navigation";

import { AlertFeed } from "@/components/app/alert-feed";
import { AppShell } from "@/components/app/app-shell";
import { CageHealthNoteForm } from "@/components/app/cage-health-note-form";
import { PageHeader } from "@/components/app/page-header";
import { Surface } from "@/components/app/surface";
import { getCageByBarcode, getCageSnapshot, getColonyData } from "@/lib/colony";
import { requireUser } from "@/lib/session";

export default async function ScanDetailPage({ params }: { params: Promise<{ barcode: string }> }) {
  const user = await requireUser();
  await getColonyData();
  const { barcode } = await params;
  const cage = getCageByBarcode(barcode);
  const snapshot = getCageSnapshot(cage?.id ?? "");

  if (!snapshot) {
    notFound();
  }

  return (
    <AppShell currentPath="/scan" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Mobile cage workspace"
          title={`${snapshot.room?.roomNumber} / ${snapshot.rack?.rackNumber} / ${snapshot.cage.cageNumber}`}
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
