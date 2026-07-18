import { AppShell } from "@/components/app/app-shell";
import { PageHeader } from "@/components/app/page-header";
import { SopWorkspace } from "@/components/app/sop-workspace";
import { getSopWorkspace } from "@/lib/sop-read";
import { requireUser } from "@/lib/session";

export default async function SopsPage({ searchParams }: { searchParams: Promise<{ sopId?: string }> }) {
  const user = await requireUser({ capability: "sops:read" });
  const [workspace, query] = await Promise.all([getSopWorkspace(user), searchParams]);

  return (
    <AppShell currentPath="/sops" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="min-w-0 space-y-5">
        <PageHeader
          description="Create, approve, assign, and acknowledge exact immutable SOP versions."
          title="Standard operating procedures"
        />
        <SopWorkspace selectedSopId={query.sopId} workspace={workspace} />
      </div>
    </AppShell>
  );
}
