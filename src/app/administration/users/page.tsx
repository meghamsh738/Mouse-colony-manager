import { ShieldCheck, UserCog, UserPlus } from "lucide-react";

import { changeRoutineRoleAction, createInvitationAction, requestRoleAction, resendInvitationAction, revokeInvitationAction, setUserActiveStateAction } from "@/app/administration/users/actions";
import { AppShell } from "@/components/app/app-shell";
import { CompactActionTray } from "@/components/app/compact-action-tray";
import { AccountStatusForm, InvitationForm, InvitationLifecycleActions, RoleRequestForm, RoutineRoleForm } from "@/components/app/identity-admin-forms";
import { PageHeader } from "@/components/app/page-header";
import { MobileWorksheetCard, WorksheetShell } from "@/components/app/worksheet-shell";
import { Badge } from "@/components/ui/badge";
import { canonicalRoleLabel, normalizeUserRole } from "@/lib/capabilities";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/utils";

export default async function UsersAdministrationPage() {
  const actor = await requireUser({ capability: "users:manage" });
  const [users, invitations, labs] = await Promise.all([
    prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], select: { id: true, name: true, email: true, role: true, active: true } }),
    prisma.userInvitation.findMany({ orderBy: { createdAt: "desc" }, take: 25, select: { id: true, email: true, targetRole: true, membershipRole: true, status: true, expiresAt: true, lab: { select: { code: true } } } }),
    prisma.lab.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
  ]);
  const routineUsers = users.filter((user) => user.active && user.id !== actor.id && ["cmu_staff", "lab_user", "colony_manager", "animal_staff", "researcher", "read_only"].includes(user.role));
  const privilegedUsers = users.filter((user) => user.active && user.id !== actor.id);

  return <AppShell currentPath="/administration/users" role={actor.role} userName={actor.name ?? actor.email}>
    <div className="space-y-5">
      <PageHeader breadcrumbs={[{ label: "Administration" }, { label: "Users" }]} description="Invite users and govern privileged access." title="Users and access" />
      <CompactActionTray
        actions={[
          { id: "invite", label: "Invite user", icon: <UserPlus className="h-4 w-4" aria-hidden="true" />, tone: "primary", panel: <InvitationForm action={createInvitationAction} labs={labs} /> },
          { id: "routine-role", label: "Change routine role", icon: <UserCog className="h-4 w-4" aria-hidden="true" />, panel: <RoutineRoleForm action={changeRoutineRoleAction} users={routineUsers} /> },
          { id: "privileged-role", label: "Request privileged role", icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />, tone: "warning", panel: <RoleRequestForm action={requestRoleAction} users={privilegedUsers} /> },
        ]}
        summary={<span>{users.filter((user) => user.active).length} active accounts · {invitations.filter((invitation) => invitation.status === "pending").length} pending invitations</span>}
        title="Access actions"
      />
      <WorksheetShell summary={<span>{users.length} total</span>} title="Users">
        <div className="data-table-wrap hidden md:block"><table className="data-table compact-table min-w-[900px]"><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Account action</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td className="font-medium">{user.name}</td><td>{user.email}</td><td>{canonicalRoleLabel(normalizeUserRole(user.role))}</td><td><Badge variant={user.active ? "success" : "danger"}>{user.active ? "Active" : "Inactive"}</Badge></td><td>{user.id === actor.id ? <span className="text-xs text-[var(--muted)]">Current account</span> : <AccountStatusForm action={setUserActiveStateAction} active={user.active} userId={user.id} />}</td></tr>)}</tbody></table></div>
        <div className="worksheet-mobile-list md:hidden">{users.map((user) => <MobileWorksheetCard
          actions={user.id === actor.id ? <span className="text-xs text-[var(--muted)]">Current account</span> : <AccountStatusForm action={setUserActiveStateAction} active={user.active} userId={user.id} />}
          key={user.id}
          meta={<Badge variant={user.active ? "success" : "danger"}>{user.active ? "Active" : "Inactive"}</Badge>}
          title={user.name}
        >
          <div className="mobile-worksheet-field mobile-worksheet-field-wide"><span className="mobile-worksheet-label">Email</span><span className="mobile-worksheet-value wrap-value">{user.email}</span></div>
          <div className="mobile-worksheet-field mobile-worksheet-field-wide"><span className="mobile-worksheet-label">Role</span><span className="mobile-worksheet-value">{canonicalRoleLabel(normalizeUserRole(user.role))}</span></div>
        </MobileWorksheetCard>)}</div>
      </WorksheetShell>
      <WorksheetShell summary={<span>{invitations.length} recent</span>} title="Invitations">
        <div className="data-table-wrap hidden md:block"><table className="data-table compact-table min-w-[900px]"><thead><tr><th>Email</th><th>Access</th><th>Lab</th><th>Expires</th><th>Status</th><th>Action</th></tr></thead><tbody>{invitations.map((invitation) => {
          const status = invitation.status === "pending" && invitation.expiresAt <= new Date() ? "expired" : invitation.status;
          return <tr key={invitation.id}><td>{invitation.email}</td><td>{canonicalRoleLabel(normalizeUserRole(invitation.targetRole))}{invitation.membershipRole ? ` · ${invitation.membershipRole}` : ""}</td><td>{invitation.lab?.code ?? "—"}</td><td>{formatDate(invitation.expiresAt)}</td><td><Badge variant={status === "pending" ? "warning" : status === "accepted" ? "success" : "info"}>{status}</Badge></td><td>{status === "accepted" ? <span className="text-xs text-[var(--muted)]">Completed</span> : <InvitationLifecycleActions canRevoke={status === "pending"} invitationId={invitation.id} resendAction={resendInvitationAction} revokeAction={revokeInvitationAction} />}</td></tr>;
        })}</tbody></table></div>
        <div className="worksheet-mobile-list md:hidden">{invitations.map((invitation) => {
          const status = invitation.status === "pending" && invitation.expiresAt <= new Date() ? "expired" : invitation.status;
          return <MobileWorksheetCard
            actions={status === "accepted" ? <span className="text-xs text-[var(--muted)]">Completed</span> : <InvitationLifecycleActions canRevoke={status === "pending"} invitationId={invitation.id} resendAction={resendInvitationAction} revokeAction={revokeInvitationAction} />}
            key={invitation.id}
            meta={<Badge variant={status === "pending" ? "warning" : status === "accepted" ? "success" : "info"}>{status}</Badge>}
            title={<span className="wrap-value">{invitation.email}</span>}
          >
            <div className="mobile-worksheet-field mobile-worksheet-field-wide"><span className="mobile-worksheet-label">Access</span><span className="mobile-worksheet-value">{canonicalRoleLabel(normalizeUserRole(invitation.targetRole))}{invitation.membershipRole ? ` · ${invitation.membershipRole}` : ""}</span></div>
            <div className="mobile-worksheet-field"><span className="mobile-worksheet-label">Lab</span><span className="mobile-worksheet-value">{invitation.lab?.code ?? "—"}</span></div>
            <div className="mobile-worksheet-field"><span className="mobile-worksheet-label">Expires</span><span className="mobile-worksheet-value">{formatDate(invitation.expiresAt)}</span></div>
          </MobileWorksheetCard>;
        })}</div>
      </WorksheetShell>
    </div>
  </AppShell>;
}
