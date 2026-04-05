import Link from "next/link";
import { notFound } from "next/navigation";

import { AlertFeed } from "@/components/app/alert-feed";
import { AppShell } from "@/components/app/app-shell";
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
          </Surface>
          <div className="space-y-6">
            <CageQrCard barcode={snapshot.cage.barcode} />
            <AlertFeed alerts={snapshot.alerts} title="Cage alerts" />
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
