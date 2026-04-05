import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { ScanLauncher } from "@/components/app/scan-launcher";
import { Surface } from "@/components/app/surface";
import { requireUser } from "@/lib/session";

export default async function ScanPage() {
  const user = await requireUser();

  return (
    <AppShell currentPath="/scan" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Barcode scan"
          title="Fast cage lookup for mobile rounds."
          description="Scan a QR or barcode when the device supports it, or paste a barcode manually. The result opens a cage workspace optimized for quick welfare and husbandry actions."
        />
        <Surface>
          <ScanLauncher />
        </Surface>
      </div>
    </AppShell>
  );
}
