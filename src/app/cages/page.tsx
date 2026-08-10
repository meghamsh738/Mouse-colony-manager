import { Boxes, Printer, ShoppingCart } from "lucide-react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { CageTable } from "@/components/app/cage-table";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { PageHeader } from "@/components/app/page-header";
import { WorksheetShell } from "@/components/app/worksheet-shell";
import {
  CAGE_INVENTORY_DEFAULT_PAGE_SIZE,
  getCageInventoryPageView,
} from "@/lib/cages-read";
import { requireUser } from "@/lib/session";

type CagesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function canonicalCagesHref(query: Awaited<ReturnType<typeof getCageInventoryPageView>>["query"], page: number) {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.status !== "all") params.set("status", query.status);
  if (query.labId !== "all") params.set("labId", query.labId);
  if (query.chargeCategoryId !== "all") params.set("chargeCategoryId", query.chargeCategoryId);
  if (query.chargeState !== "all") params.set("chargeState", query.chargeState);
  if (query.occupancy !== "all") params.set("occupancy", query.occupancy);
  if (query.sex !== "all") params.set("sex", query.sex);
  if (query.warningsOnly) params.set("warningsOnly", "true");
  if (query.pageSize !== CAGE_INVENTORY_DEFAULT_PAGE_SIZE) params.set("pageSize", String(query.pageSize));
  if (page > 1) params.set("page", String(page));
  const serialized = params.toString();
  return serialized ? `/cages?${serialized}` : "/cages";
}

export default async function CagesPage({ searchParams }: CagesPageProps) {
  const user = await requireUser({ capability: "cages:read" });
  const inventory = await getCageInventoryPageView(user, (await searchParams) ?? {});
  if (inventory.page > inventory.pageCount) {
    redirect(canonicalCagesHref(inventory.query, inventory.pageCount));
  }
  const cages = inventory.items;
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
        <CompactActionTray actions={actions} summary={<span>{inventory.totalCount} cages in current filtered view</span>} title="Cage work" />
        <WorksheetShell>
          <CageTable
            data={cages}
            filterOptions={inventory.filterOptions}
            key={JSON.stringify(inventory.query)}
            page={inventory.page}
            pageCount={inventory.pageCount}
            pageSize={inventory.pageSize}
            query={inventory.query}
            totalCount={inventory.totalCount}
          />
        </WorksheetShell>
      </div>
    </AppShell>
  );
}
