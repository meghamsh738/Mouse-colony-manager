import Link from "next/link";

import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { Surface } from "@/components/app/surface";
import { getCageListView } from "@/lib/cages-read";
import { requireUser } from "@/lib/session";

export default async function CagesPage() {
  const user = await requireUser();
  const cages = await getCageListView();

  return (
    <AppShell currentPath="/cages" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Cages"
          title="Room and rack view of operational cages."
          description="Animal staff can start here for occupancy, sex composition, strain summary, and warning counts before moving into a specific cage workspace."
        />
        <Surface className="overflow-x-auto p-0">
          <table className="min-w-full border-collapse">
            <thead className="bg-[var(--surface-2)] text-left text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
              <tr>
                {["Cage", "Barcode", "Status", "Occupants", "Sex mix", "Strain summary", "Warnings"].map((header) => (
                  <th key={header} className="px-5 py-4 font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)] bg-white/70">
              {cages.map((cage) => (
                <tr key={cage.id}>
                  <td className="px-5 py-4">
                    <Link className="font-medium hover:text-[var(--accent)]" href={`/cages/${cage.id}`}>
                      {cage.roomNumber} / {cage.rackNumber} / {cage.cageNumber}
                    </Link>
                  </td>
                  <td className="px-5 py-4 font-mono text-sm text-[var(--muted)]">{cage.barcode}</td>
                  <td className="px-5 py-4 capitalize">{cage.status}</td>
                  <td className="px-5 py-4">{cage.occupantCount}</td>
                  <td className="px-5 py-4">{cage.sexComposition}</td>
                  <td className="px-5 py-4 text-sm text-[var(--muted)]">{cage.strainSummary}</td>
                  <td className="px-5 py-4">{cage.warningCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      </div>
    </AppShell>
  );
}
