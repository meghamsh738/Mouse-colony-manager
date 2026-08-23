import { Dna, MousePointer2, ShoppingCart } from "lucide-react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { AnimalCreateForm } from "@/components/app/animal-create-form";
import { AnimalGenotypeImportForm } from "@/components/app/animal-genotype-import-form";
import { ColonyTable } from "@/components/app/colony-table";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { PageHeader } from "@/components/app/page-header";
import { WorksheetShell } from "@/components/app/worksheet-shell";
import { getRequestedAction, withActionQuery } from "@/lib/action-route";
import {
  ANIMAL_INVENTORY_DEFAULT_PAGE_SIZE,
  getAnimalInventoryPageView,
  getAnimalPageOptions,
} from "@/lib/animals-read";
import { requireUser } from "@/lib/session";

type AnimalsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function canonicalAnimalsHref(query: Awaited<ReturnType<typeof getAnimalInventoryPageView>>["query"], page: number) {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.status !== "all") params.set("status", query.status);
  if (query.availableOnly) params.set("availableOnly", "true");
  if (query.pageSize !== ANIMAL_INVENTORY_DEFAULT_PAGE_SIZE) params.set("pageSize", String(query.pageSize));
  if (page > 1) params.set("page", String(page));
  const serialized = params.toString();
  return serialized ? `/animals?${serialized}` : "/animals";
}

export default async function AnimalsPage({ searchParams }: AnimalsPageProps) {
  const user = await requireUser({ capability: "animals:read" });
  const canCreateAnimal = user.role === "admin" || user.role === "colony_manager" || user.role === "animal_staff";
  const canImportGenotypes = user.role !== "read_only";
  const rawQuery = (await searchParams) ?? {};
  const requestedAction = getRequestedAction(rawQuery, ["add-mouse"] as const);
  const shouldLoadCreateOptions = canCreateAnimal && requestedAction === "add-mouse";
  const [inventory, options] = await Promise.all([
    getAnimalInventoryPageView(user, rawQuery),
    shouldLoadCreateOptions ? getAnimalPageOptions(user) : Promise.resolve(null),
  ]);
  if (inventory.page > inventory.pageCount) {
    redirect(canonicalAnimalsHref(inventory.query, inventory.pageCount));
  }
  const animals = inventory.items;
  const showCreateAnimal = canCreateAnimal && options !== null;
  const showOperations = canCreateAnimal || canImportGenotypes;
  const inventoryHref = canonicalAnimalsHref(inventory.query, inventory.page);
  const actions: CompactActionItem[] = [
    ...(canCreateAnimal
      ? [
          {
            id: "add-mouse",
            label: "Add mouse",
            description: "New animal",
            icon: <MousePointer2 size={16} />,
            tone: "primary" as const,
            ...(showCreateAnimal
              ? {
                  panel: (
                    <AnimalCreateForm
                      cageOptions={options.cageOptions}
                      projectOptions={options.projectOptions}
                      strainOptions={options.strainOptions}
                    />
                  ),
                }
              : { href: withActionQuery(inventoryHref, "add-mouse") }),
          },
        ]
      : []),
    ...(canImportGenotypes
      ? [
          {
            id: "import-genotypes",
            label: "Import genotype results",
            description: "CSV update",
            icon: <Dna size={16} />,
            panel: <AnimalGenotypeImportForm />,
          },
        ]
      : []),
    ...(canCreateAnimal
      ? [
          {
            id: "receive-mice",
            label: "Receive mice",
            description: "Purchased delivery",
            href: "/cages/intake?mode=purchase",
            icon: <ShoppingCart size={16} />,
          },
        ]
      : []),
  ];

  return (
    <AppShell currentPath="/animals" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-5">
        <PageHeader
          eyebrow="Colony table"
          title="Animals"
        />
        {showOperations ? (
          <CompactActionTray
            actions={actions}
            closeHref={showCreateAnimal ? inventoryHref : undefined}
            defaultActionId={showCreateAnimal ? "add-mouse" : undefined}
            eyebrow="Actions"
            key={requestedAction ?? "inventory"}
            summary={<span>{inventory.totalCount} mice in current filtered view</span>}
            title="Record work"
          />
        ) : null}
        <WorksheetShell>
          <ColonyTable
            data={animals}
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
