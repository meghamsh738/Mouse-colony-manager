import { AppShell } from "@/components/app/app-shell";
import { AnimalCreateForm } from "@/components/app/animal-create-form";
import { ColonyTable } from "@/components/app/colony-table";
import { PageHeader } from "@/components/app/page-header";
import { Surface } from "@/components/app/surface";
import { getAnimalListView, getAnimalPageOptions } from "@/lib/animals-read";
import { requireUser } from "@/lib/session";

export default async function AnimalsPage() {
  const user = await requireUser();
  const [animals, options] = await Promise.all([getAnimalListView(), getAnimalPageOptions()]);
  const canCreateAnimal = user.role === "admin" || user.role === "colony_manager" || user.role === "animal_staff";

  return (
    <AppShell currentPath="/animals" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Colony table"
          title="Search and filter the active colony."
          description="This workspace is optimized for daily lookup, experiment selection, and welfare review. Archived animals stay searchable through their detail pages and audit history, but stay out of the default active table."
        />
        <div className="grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
          {canCreateAnimal ? (
            <Surface className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">New animal</p>
                <h2 className="font-display text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                  Add a weaned mouse into the live colony.
                </h2>
                <p className="text-sm leading-7 text-[var(--muted)]">
                  Use this during litter split or transfer intake to place a mouse into a real cage with project attribution and a traceable creation event.
                </p>
              </div>
              <AnimalCreateForm
                cageOptions={options.cageOptions}
                projectOptions={options.projectOptions}
                strainOptions={options.strainOptions}
              />
            </Surface>
          ) : null}
          <Surface>
            <ColonyTable data={animals} />
          </Surface>
        </div>
      </div>
    </AppShell>
  );
}
