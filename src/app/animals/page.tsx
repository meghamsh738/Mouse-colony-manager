import { Dna, MousePointer2, ShoppingCart } from "lucide-react";

import { AppShell } from "@/components/app/app-shell";
import { AnimalCreateForm } from "@/components/app/animal-create-form";
import { AnimalGenotypeImportForm } from "@/components/app/animal-genotype-import-form";
import { ColonyTable } from "@/components/app/colony-table";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { PageHeader } from "@/components/app/page-header";
import { WorksheetShell } from "@/components/app/worksheet-shell";
import { getAnimalListView, getAnimalPageOptions } from "@/lib/animals-read";
import { requireUser } from "@/lib/session";

export default async function AnimalsPage() {
  const user = await requireUser({ capability: "animals:read" });
  const [animals, options] = await Promise.all([getAnimalListView(user), getAnimalPageOptions(user)]);
  const canCreateAnimal = user.role === "admin" || user.role === "colony_manager" || user.role === "animal_staff";
  const canImportGenotypes = user.role !== "read_only";
  const showOperations = canCreateAnimal || canImportGenotypes;
  const actions: CompactActionItem[] = [
    ...(canCreateAnimal
      ? [
          {
            id: "add-mouse",
            label: "Add mouse",
            description: "New animal",
            icon: <MousePointer2 size={16} />,
            tone: "primary" as const,
            panel: (
              <AnimalCreateForm
                cageOptions={options.cageOptions}
                projectOptions={options.projectOptions}
                strainOptions={options.strainOptions}
              />
            ),
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
            eyebrow="Actions"
            summary={<span>{animals.length} mice in current view</span>}
            title="Record work"
          />
        ) : null}
        <WorksheetShell>
          <ColonyTable data={animals} />
        </WorksheetShell>
      </div>
    </AppShell>
  );
}
