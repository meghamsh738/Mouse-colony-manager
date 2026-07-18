import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { ScanLauncher } from "@/components/app/scan-launcher";
import { Surface } from "@/components/app/surface";
import { getCageListView } from "@/lib/cages-read";
import { requireUser } from "@/lib/session";

export default async function ScanPage() {
  const user = await requireUser({ capability: "scan:use" });
  const cages = await getCageListView(user);
  const quickCages = [...cages]
    .sort((left, right) => right.warningCount - left.warningCount || right.occupantCount - left.occupantCount || left.barcode.localeCompare(right.barcode))
    .slice(0, 6)
    .map((cage) => ({
      barcode: cage.barcode,
      label: `${cage.roomNumber} / ${cage.rackNumber} / ${cage.cageNumber}`,
      occupantCount: cage.occupantCount,
      status: cage.status,
      strainSummary: cage.strainSummary,
      warningCount: cage.warningCount,
    }));

  return (
    <AppShell currentPath="/scan" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Barcode scan"
          title="Scan cage"
        />
        <Surface>
          <ScanLauncher quickCages={quickCages} />
        </Surface>
      </div>
    </AppShell>
  );
}
