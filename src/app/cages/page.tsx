import { Boxes, Printer, ShoppingCart } from "lucide-react";

import { AppShell } from "@/components/app/app-shell";
import { CageTable } from "@/components/app/cage-table";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { PageHeader } from "@/components/app/page-header";
import { WorksheetShell } from "@/components/app/worksheet-shell";
import { getCageListView } from "@/lib/cages-read";
import { requireUser } from "@/lib/session";

export default async function CagesPage() {
  const user = await requireUser({ capability: "cages:read" });
  const cages = await getCageListView(user);
  const canManage = user.role === "admin" || user.role === "colony_manager" || user.role === "animal_staff";
  const actions: CompactActionItem[] = [
    ...(canManage
      ? [
          { id: "new-cage", label: "New cage", href: "/cages/intake?mode=new", icon: <Boxes size={16} />, tone: "primary" as const },
          { id: "receive-mice", label: "Receive mice", href: "/cages/intake?mode=purchase", icon: <ShoppingCart size={16} /> },
        ]
      : []),
    { id: "print-labels", label: "Print labels", href: "/cages/labels", icon: <Printer size={16} /> },
  ];

  return (
    <AppShell currentPath="/cages" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader
          breadcrumbs={[{ label: "Cages" }]}
          title="Cages"
        />
        <CompactActionTray actions={actions} summary={<span>{cages.length} cages</span>} title="Cage work" />
        <WorksheetShell>
          <CageTable data={cages} />
        </WorksheetShell>
      </div>
    </AppShell>
  );
}
