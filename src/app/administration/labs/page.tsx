import { Building2, UserPlus } from "lucide-react";

import {
  createLabAction,
  setLabActiveStateAction,
  setLabMembershipActiveStateAction,
  updateLabDetailsAction,
  upsertLabMembershipAction,
} from "@/app/administration/labs/actions";
import { AppShell } from "@/components/app/app-shell";
import { CompactActionTray } from "@/components/app/compact-action-tray";
import {
  AssignLabMembershipForm,
  CreateLabForm,
  LabActiveStateForm,
  LabMembershipActiveStateForm,
  UpdateLabDetailsForm,
} from "@/components/app/lab-administration-forms";
import { PageHeader } from "@/components/app/page-header";
import { MobileWorksheetCard, RowActionMenu, WorksheetShell } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import { canonicalRoleLabel, normalizeUserRole } from "@/lib/capabilities";
import { getLabAdministrationView } from "@/lib/lab-administration";
import { requireUser } from "@/lib/session";
import { formatDate, titleCase } from "@/lib/utils";

export default async function LabsAdministrationPage() {
  const actor = await requireUser({ capability: "labs:manage" });
  const view = await getLabAdministrationView(actor);
  const activeLabs = view.labs.filter((lab) => lab.active).map((lab) => ({ id: lab.id, name: lab.name, code: lab.code }));

  return <AppShell currentPath="/administration/labs" role={actor.role} userName={actor.name ?? actor.email}>
    <div className="space-y-5">
      <PageHeader breadcrumbs={[{ label: "Administration" }, { label: "Labs" }]} title="Labs and members" />
      {(view.canCreateLabs || view.canAdministerMemberships) ? <CompactActionTray
        actions={[
          ...(view.canCreateLabs ? [{
            id: "create-lab",
            label: "Create lab",
            icon: <Building2 aria-hidden="true" className="h-4 w-4" />,
            panel: <CreateLabForm action={createLabAction} />,
            tone: "primary" as const,
          }] : []),
          ...(view.canAdministerMemberships ? [{
            id: "assign-member",
            label: "Assign member",
            icon: <UserPlus aria-hidden="true" className="h-4 w-4" />,
            panel: <AssignLabMembershipForm action={upsertLabMembershipAction} labs={activeLabs} users={view.candidateUsers} />,
          }] : []),
        ]}
        summary={<span>{view.labs.filter((lab) => lab.active).length} active labs</span>}
        title="Lab administration"
      /> : null}

      <WorksheetShell
        eyebrow="Directory"
        summary={<span>{view.labs.length} lab{view.labs.length === 1 ? "" : "s"}</span>}
        title="Labs"
      >
        {view.labs.length ? <div className="divide-y divide-[var(--line)]">
          {view.labs.map((lab) => <details className="group" key={lab.id}>
            <summary className="grid min-h-14 cursor-pointer list-none gap-3 px-4 py-3 hover:bg-[var(--surface-2)] md:grid-cols-[minmax(12rem,1.2fr)_minmax(8rem,.8fr)_minmax(8rem,.7fr)_minmax(8rem,.7fr)_auto] md:items-center [&::-webkit-details-marker]:hidden">
              <div className="min-w-0"><strong className="wrap-value">{lab.name}</strong><p className="worksheet-cell-mono mt-0.5">{lab.code}</p></div>
              <div className="metadata-line"><Badge variant={lab.active ? "success" : "danger"}>{lab.active ? "Active" : "Inactive"}</Badge></div>
              <div><span className="metadata-label">Members</span><strong className="block">{lab.memberships.filter((membership) => membership.active).length}</strong></div>
              <div><span className="metadata-label">Colony</span><strong className="block">{lab._count.cages} cages · {lab._count.animals} mice</strong></div>
              <span className="table-action justify-self-start md:justify-self-end">Open</span>
            </summary>
            <div className="border-t border-[var(--line)] bg-[var(--surface-2)] px-4 py-4">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,.8fr)]">
                <div className="min-w-0 space-y-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                    <div><p className="metadata-label">Members</p><p className="text-sm text-[var(--muted)]">{lab.billingContact || "No billing contact"}</p></div>
                    <span className="text-xs text-[var(--muted)]">Updated {formatDate(lab.updatedAt)}</span>
                  </div>
                  {lab.memberships.length ? <><div className="hidden overflow-x-auto rounded-md border border-[var(--line)] bg-white md:block">
                    <table className="worksheet-table min-w-[700px]">
                      <thead><tr><th>User</th><th>Global role</th><th>Lab role</th><th>Status</th>{view.canAdministerMemberships ? <th>Action</th> : null}</tr></thead>
                      <tbody>{lab.memberships.map((membership) => <tr key={membership.id}>
                        <td><strong>{membership.user.name}</strong><p className="worksheet-cell-muted">{membership.user.email}</p></td>
                        <td>{canonicalRoleLabel(normalizeUserRole(membership.user.role))}</td>
                        <td>{titleCase(membership.role)}</td>
                        <td><Badge variant={membership.active && membership.user.active ? "success" : "danger"}>{membership.active && membership.user.active ? "Active" : "Inactive"}</Badge></td>
                        {view.canAdministerMemberships ? <td><RowActionMenu label="Membership" tone={membership.active ? "warning" : "default"}><LabMembershipActiveStateForm action={setLabMembershipActiveStateAction} active={membership.active} membershipId={membership.id} /></RowActionMenu></td> : null}
                      </tr>)}</tbody>
                    </table>
                  </div><div className="worksheet-mobile-list md:hidden">{lab.memberships.map((membership) => <MobileWorksheetCard
                    actions={view.canAdministerMemberships ? <RowActionMenu label="Membership" tone={membership.active ? "warning" : "default"}><LabMembershipActiveStateForm action={setLabMembershipActiveStateAction} active={membership.active} membershipId={membership.id} /></RowActionMenu> : undefined}
                    key={membership.id}
                    meta={<Badge variant={membership.active && membership.user.active ? "success" : "danger"}>{membership.active && membership.user.active ? "Active" : "Inactive"}</Badge>}
                    title={membership.user.name}
                  >
                    <div className="mobile-worksheet-field mobile-worksheet-field-wide"><span className="mobile-worksheet-label">Email</span><span className="mobile-worksheet-value wrap-value">{membership.user.email}</span></div>
                    <div className="mobile-worksheet-field"><span className="mobile-worksheet-label">Global role</span><span className="mobile-worksheet-value">{canonicalRoleLabel(normalizeUserRole(membership.user.role))}</span></div>
                    <div className="mobile-worksheet-field"><span className="mobile-worksheet-label">Lab role</span><span className="mobile-worksheet-value">{titleCase(membership.role)}</span></div>
                  </MobileWorksheetCard>)}</div></> : <p className="rounded-md border border-dashed border-[var(--line)] bg-white px-4 py-5 text-sm text-[var(--muted)]">No members assigned.</p>}
                </div>
                <div className="min-w-0 space-y-4 border-t border-[var(--line)] pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
                  <div><p className="metadata-label mb-2">Lab profile</p><UpdateLabDetailsForm action={updateLabDetailsAction} lab={lab} /></div>
                  {view.canAdministerMemberships ? <details className="rounded-md border border-[var(--line)] bg-white p-3">
                    <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Lab status</summary>
                    <div className="mt-3"><LabActiveStateForm action={setLabActiveStateAction} active={lab.active} labId={lab.id} /></div>
                  </details> : null}
                </div>
              </div>
            </div>
          </details>)}
        </div> : <p className="px-4 py-6 text-sm text-[var(--muted)]">No labs are configured.</p>}
      </WorksheetShell>
    </div>
  </AppShell>;
}
