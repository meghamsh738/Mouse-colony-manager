import { AppShell } from "@/components/app/app-shell";
import { CageTable } from "@/components/app/cage-table";
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
        <Surface>
          <CageTable data={cages} />
        </Surface>
      </div>
    </AppShell>
  );
}
