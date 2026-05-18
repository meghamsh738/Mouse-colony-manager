import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { ScanLauncher } from "@/components/app/scan-launcher";
import { Surface } from "@/components/app/surface";
import { getCageListView } from "@/lib/cages-read";
import { requireUser } from "@/lib/session";

export default async function ScanPage() {
  const user = await requireUser();
  const cages = await getCageListView();
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
          title="Fast cage lookup for mobile rounds."
          description="Scan a QR or barcode when the device supports it, or paste a barcode manually. The result opens a cage workspace optimized for quick welfare and husbandry actions."
        />
        <Surface>
          <ScanLauncher quickCages={quickCages} />
        </Surface>
      </div>
    </AppShell>
  );
}
