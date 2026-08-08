import { AppShell } from "@/components/app/app-shell";
import { CompactActionTray, type CompactActionItem } from "@/components/app/compact-action-tray";
import { PageHeader } from "@/components/app/page-header";
import {
  CreateStrainDirectoryListingForm,
  StrainDirectoryDiscovery,
  StrainDirectoryManagement,
  StrainDirectoryRequests,
} from "@/components/app/strain-directory-workspace";
import { WorksheetShell } from "@/components/app/worksheet-shell";
import { actorHasCapability } from "@/lib/capabilities";
import {
  getStrainDirectoryManagementView,
  getStrainDirectoryRequestViews,
  getStrainDirectoryView,
} from "@/lib/strain-directory-read";
import { requireUser } from "@/lib/session";

export default async function StrainDirectoryPage() {
  const user = await requireUser({ capability: "strains:discover" });
  const canManage = actorHasCapability(user, "strains:manage");
  const canRequest = actorHasCapability(user, "strains:request") && Boolean(user.activeLabId);
  const [listings, requests, management] = await Promise.all([
    getStrainDirectoryView(user),
    getStrainDirectoryRequestViews(user),
    canManage ? getStrainDirectoryManagementView(user) : Promise.resolve(null),
  ]);
  const actions: CompactActionItem[] = management
    ? [
        {
          id: "create-directory-draft",
          label: "Create private draft",
          description: "Choose a canonical strain and an owner or manager contact.",
          tone: "primary",
          panel: <CreateStrainDirectoryListingForm contacts={management.contacts} labs={management.labs} strains={management.strains} />,
        },
      ]
    : [];

  return (
    <AppShell currentPath="/strains" role={user.role} userName={user.name ?? user.email ?? "Unknown user"}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Unit directory"
          title="Strain directory"
          description="Discover strains shared by other labs, then contact the selected owner or manager privately in the app. Exact counts, locations, animals, health, genotype, project, and free-text records stay private."
        />
        {!canRequest ? <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">Select an active lab to send private directory requests.</div> : null}
        {actions.length ? <CompactActionTray actions={actions} eyebrow="Directory management" summary={<span>Drafts remain private until the selected contact confirms sharing.</span>} title="Manage a lab listing" /> : null}
        <section className="space-y-3"><div><p className="section-kicker">Shared unit-wide</p><h2 className="text-xl font-semibold">Discover available strains</h2></div><StrainDirectoryDiscovery canRequest={canRequest} listings={listings} /></section>
        {management ? <section className="space-y-3"><div><p className="section-kicker">Your management scope</p><h2 className="text-xl font-semibold">Private drafts and shared listings</h2></div><StrainDirectoryManagement contacts={management.contacts} listings={management.listings} /></section> : null}
        <WorksheetShell><StrainDirectoryRequests received={requests.received} sent={requests.sent} /></WorksheetShell>
      </div>
    </AppShell>
  );
}
