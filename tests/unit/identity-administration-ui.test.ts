import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("identity administration UI boundaries", () => {
  it("keeps privileged decisions consolidated on the approvals page", () => {
    const usersPage = fs.readFileSync(path.join(process.cwd(), "src/app/administration/users/page.tsx"), "utf8");
    const approvalsPage = fs.readFileSync(path.join(process.cwd(), "src/app/approvals/page.tsx"), "utf8");
    const actions = fs.readFileSync(path.join(process.cwd(), "src/app/administration/users/actions.ts"), "utf8");

    expect(usersPage).not.toContain("approveRoleAction");
    expect(usersPage).not.toContain("RoleApprovalForm");
    expect(approvalsPage).toContain("RoleDecisionForm");
    expect(approvalsPage).toContain("approveRoleAction");
    expect(approvalsPage).toContain("rejectRoleAction");
    expect(actions).toContain('revalidatePath("/approvals")');
  });

  it("derives expired invitation state before rendering lifecycle actions", () => {
    const usersPage = fs.readFileSync(path.join(process.cwd(), "src/app/administration/users/page.tsx"), "utf8");

    expect(usersPage).toContain('invitation.status === "pending" && invitation.expiresAt <= new Date()');
    expect(usersPage).toContain('canRevoke={status === "pending"}');
  });

  it("uses compact actions, desktop worksheets, and mobile cards for identity and lab administration", () => {
    const usersPage = fs.readFileSync(path.join(process.cwd(), "src/app/administration/users/page.tsx"), "utf8");
    const labsPage = fs.readFileSync(path.join(process.cwd(), "src/app/administration/labs/page.tsx"), "utf8");

    expect(usersPage).toContain("<CompactActionTray");
    expect(usersPage).toContain("<WorksheetShell");
    expect(usersPage).toContain('className="data-table-wrap hidden md:block"');
    expect(usersPage).toContain('className="worksheet-mobile-list md:hidden"');
    expect(usersPage).toContain("<MobileWorksheetCard");
    expect(usersPage).toContain("<InvitationForm");
    expect(usersPage).toContain("<RoutineRoleForm");
    expect(usersPage).toContain("<RoleRequestForm");

    expect(labsPage).toContain('className="hidden overflow-x-auto rounded-md border border-[var(--line)] bg-white md:block"');
    expect(labsPage).toContain('className="worksheet-mobile-list md:hidden"');
    expect(labsPage).toContain("<MobileWorksheetCard");
    expect(labsPage).toContain("<LabMembershipActiveStateForm");
  });
});
