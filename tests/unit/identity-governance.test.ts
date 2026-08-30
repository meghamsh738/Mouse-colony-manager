import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acceptUserInvitation,
  approvePrivilegedRoleChange,
  changeRoutineUserRole,
  createUserInvitation,
  getInvitationPreview,
  rejectPrivilegedRoleChange,
  resendUserInvitation,
  revokeUserInvitation,
  requestPrivilegedRoleChange,
  setUserActiveState,
} from "@/lib/identity-governance";
import { createLab, setLabActiveState, updateLabDetails, upsertLabMembership } from "@/lib/lab-administration";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

const runId = randomUUID();
const ids = {
  requester: `test-requester-${runId}`,
  approver: `test-approver-${runId}`,
  target: `test-target-${runId}`,
  itHead: `test-it-head-${runId}`,
  lab: `test-lab-${runId}`,
  administeredLabCode: `ADM-${runId.slice(0, 8)}`,
  activatedEmail: `activation-${runId}@example.test`,
  lifecycleEmail: `invitation-lifecycle-${runId}@example.test`,
};
const requester = { id: ids.requester, canonicalRole: "facility_admin" as const, authzVersion: 1 };
const approver = { id: ids.approver, canonicalRole: "facility_admin" as const, authzVersion: 1 };
const governanceEntityIds: string[] = [ids.requester, ids.approver, ids.target, ids.itHead];

describe.sequential("identity governance", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: ids.requester,
          name: "Requesting administrator",
          email: `requester-${runId}@example.test`,
          passwordHash: hashPassword("identity-test-password"),
          role: "facility_admin",
          active: true,
        },
        {
          id: ids.approver,
          name: "Second approver",
          email: `approver-${runId}@example.test`,
          passwordHash: hashPassword("identity-test-password"),
          role: "facility_admin",
          active: true,
        },
        {
          id: ids.target,
          name: "Role target",
          email: `target-${runId}@example.test`,
          passwordHash: hashPassword("identity-test-password"),
          role: "lab_user",
          active: true,
        },
        {
          id: ids.itHead,
          name: "Technical administrator",
          email: `it-head-${runId}@example.test`,
          passwordHash: hashPassword("identity-test-password"),
          role: "it_head",
          active: true,
        },
      ],
    });
    await prisma.lab.create({
      data: { id: ids.lab, name: "Identity Test Lab", code: `IDENTITY-${runId}`, active: true },
    });
    await prisma.labMembership.create({
      data: {
        id: `test-membership-${runId}`,
        labId: ids.lab,
        userId: ids.target,
        role: "staff",
        active: true,
      },
    });
  });

  afterAll(async () => {
    const testUserIds = [ids.requester, ids.approver, ids.target, ids.itHead];
    const activatedUser = await prisma.user.findUnique({
      where: { email: ids.activatedEmail },
      select: { id: true },
    });
    if (activatedUser) testUserIds.push(activatedUser.id);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'");
      await tx.securityEvent.deleteMany({
        where: { OR: [{ actorId: { in: testUserIds } }, { subjectId: { in: governanceEntityIds } }] },
      });
      await tx.auditLog.deleteMany({
        where: { OR: [{ actorId: { in: testUserIds } }, { entityId: { in: governanceEntityIds } }] },
      });
    });
    await prisma.privilegedRoleChangeRequest.deleteMany({
      where: {
        OR: [
          { id: { in: governanceEntityIds } },
          { targetUserId: { in: testUserIds } },
          { requestedById: { in: testUserIds } },
          { approvedById: { in: testUserIds } },
        ],
      },
    });
    await prisma.userInvitation.deleteMany({
      where: { OR: [{ id: { in: governanceEntityIds } }, { email: { in: [ids.activatedEmail, ids.lifecycleEmail] } }, { invitedById: { in: testUserIds } }] },
    });
    await prisma.labMembership.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    await prisma.lab.deleteMany({ where: { OR: [{ id: ids.lab }, { code: ids.administeredLabCode }] } });
  });

  it("stores only an invitation token hash and accepts the token exactly once", async () => {
    const created = await createUserInvitation({
      email: ids.activatedEmail,
      name: "Invited user",
      targetRole: "lab_user",
      labId: ids.lab,
      membershipRole: "staff",
    }, requester);

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    governanceEntityIds.push(created.entityId);
    expect(created.token).toBeTruthy();

    const stored = await prisma.userInvitation.findUniqueOrThrow({ where: { id: created.entityId } });
    expect(stored.tokenHash).toBe(createHash("sha256").update(created.token ?? "").digest("hex"));
    expect(stored.tokenHash).not.toBe(created.token);
    expect(await getInvitationPreview(created.token ?? "")).toMatchObject({ email: ids.activatedEmail });
    expect(await prisma.securityEvent.findFirst({
      where: { eventType: "identity.invitation.created", subjectId: created.entityId },
      select: { summary: true, actorRole: true },
    })).toEqual({ summary: "User invitation created.", actorRole: "facility_admin" });

    const accepted = await acceptUserInvitation({
      token: created.token ?? "",
      name: "Activated User",
      password: "activated-user-password",
    });
    expect(accepted.ok).toBe(true);

    const membership = await prisma.labMembership.findFirst({
      where: { user: { email: ids.activatedEmail } },
      select: { labId: true, role: true },
    });
    expect(membership).toEqual({ labId: ids.lab, role: "staff" });
    expect((await acceptUserInvitation({
      token: created.token ?? "",
      name: "Activated User",
      password: "activated-user-password",
    })).ok).toBe(false);
  });

  it("requires an independent Facility Admin and increments authorization version", async () => {
    const requested = await requestPrivilegedRoleChange({
      targetUserId: ids.target,
      requestedRole: "it_head",
      reason: "Assign technical oversight",
    }, requester);
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    governanceEntityIds.push(requested.entityId);

    const selfApproval = await approvePrivilegedRoleChange(requested.entityId, requester);
    expect(selfApproval).toMatchObject({ ok: false });

    const before = await prisma.user.findUniqueOrThrow({ where: { id: ids.target } });
    const approved = await approvePrivilegedRoleChange(requested.entityId, approver);
    expect(approved.ok).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: ids.target } });
    expect(after.role).toBe("it_head");
    expect(after.authzVersion).toBe(before.authzVersion + 1);
    expect(await prisma.securityEvent.findFirst({
      where: { eventType: "identity.role_change.approved", correlationId: requested.entityId },
      select: { severity: true, subjectId: true },
    })).toEqual({ severity: "critical", subjectId: ids.target });
  });

  it("does not allow removal of the final active IT Head", async () => {
    const demoteTemporaryHead = await requestPrivilegedRoleChange({
      targetUserId: ids.target,
      requestedRole: "lab_user",
      reason: "Return the test target to ordinary access",
    }, requester);
    expect(demoteTemporaryHead.ok).toBe(true);
    if (!demoteTemporaryHead.ok) return;
    governanceEntityIds.push(demoteTemporaryHead.entityId);
    expect((await approvePrivilegedRoleChange(demoteTemporaryHead.entityId, approver)).ok).toBe(true);

    // Other database-integration files may leave synthetic IT Head fixtures in
    // this shared disposable schema. Isolate the invariant under test and then
    // restore those fixtures so suite order cannot change the result.
    const otherActiveHeads = await prisma.user.findMany({
      where: { role: "it_head", active: true, id: { not: ids.itHead } },
      select: { id: true },
    });
    if (otherActiveHeads.length) {
      await prisma.user.updateMany({
        where: { id: { in: otherActiveHeads.map((user) => user.id) } },
        data: { active: false },
      });
    }

    try {
      const requested = await requestPrivilegedRoleChange({
        targetUserId: ids.itHead,
        requestedRole: "cmu_staff",
        reason: "Exercise final-account protection",
      }, requester);
      expect(requested.ok).toBe(true);
      if (!requested.ok) return;
      governanceEntityIds.push(requested.entityId);

      const result = await approvePrivilegedRoleChange(requested.entityId, approver);
      expect(result).toMatchObject({ ok: false });
      expect(result.message).toContain("final it head");
    } finally {
      if (otherActiveHeads.length) {
        await prisma.user.updateMany({
          where: { id: { in: otherActiveHeads.map((user) => user.id) } },
          data: { active: true },
        });
      }
    }
  });

  it("rejects invitation creation by non-administrators", async () => {
    const result = await createUserInvitation({
      email: `unauthorized-${runId}@example.test`,
      targetRole: "cmu_staff",
    }, { id: ids.target, canonicalRole: "lab_user", authzVersion: 1 });
    expect(result).toMatchObject({ ok: false });
  });

  it("changes routine access and revokes existing sessions", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: ids.target } });
    const toCmu = await changeRoutineUserRole({
      targetUserId: ids.target,
      requestedRole: "cmu_staff",
      reason: "Assign facility operations",
    }, requester);
    expect(toCmu.ok).toBe(true);

    const asCmu = await prisma.user.findUniqueOrThrow({ where: { id: ids.target } });
    expect(asCmu.role).toBe("cmu_staff");
    expect(asCmu.authzVersion).toBe(before.authzVersion + 1);

    const toLab = await changeRoutineUserRole({
      targetUserId: ids.target,
      requestedRole: "lab_user",
      reason: "Return to lab operations",
    }, requester);
    expect(toLab.ok).toBe(true);
  });

  it("rotates and explicitly revokes invitations with durable security history", async () => {
    const created = await createUserInvitation({
      email: ids.lifecycleEmail,
      targetRole: "lab_user",
      labId: ids.lab,
      membershipRole: "viewer",
    }, requester);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    governanceEntityIds.push(created.entityId);

    const resent = await resendUserInvitation(created.entityId, requester);
    expect(resent.ok).toBe(true);
    if (!resent.ok) return;
    governanceEntityIds.push(resent.entityId);
    expect(resent.token).not.toBe(created.token);
    expect(await getInvitationPreview(created.token ?? "")).toBeNull();
    expect(await getInvitationPreview(resent.token ?? "")).toMatchObject({ email: ids.lifecycleEmail });

    const revoked = await revokeUserInvitation(resent.entityId, "Recipient access is no longer required", requester);
    expect(revoked.ok).toBe(true);
    expect(await getInvitationPreview(resent.token ?? "")).toBeNull();
    expect(await prisma.securityEvent.findFirst({
      where: { eventType: "identity.invitation.revoked", correlationId: resent.entityId },
      select: { summary: true, actorRole: true },
    })).toEqual({
      summary: "User invitation revoked: Recipient access is no longer required",
      actorRole: "facility_admin",
    });
  });

  it("supports independent rejection of privileged access requests", async () => {
    const request = await requestPrivilegedRoleChange({
      targetUserId: ids.target,
      requestedRole: "it_head",
      reason: "Test a rejected privileged request",
    }, requester);
    expect(request.ok).toBe(true);
    if (!request.ok) return;
    governanceEntityIds.push(request.entityId);

    expect((await rejectPrivilegedRoleChange(request.entityId, "Requested scope is not approved", requester)).ok).toBe(false);
    expect((await rejectPrivilegedRoleChange(request.entityId, "Requested scope is not approved", approver)).ok).toBe(true);
    expect(await prisma.privilegedRoleChangeRequest.findUnique({
      where: { id: request.entityId },
      select: { status: true, approvedById: true, rejectedAt: true },
    })).toMatchObject({ status: "rejected", approvedById: approver.id, rejectedAt: expect.any(Date) });
  });

  it("creates and administers a lab and revokes target sessions on membership changes", async () => {
    const labActor = { ...requester, activeLabId: null, activeMembership: null };
    const created = await createLab({
      name: "Administered Test Lab",
      code: ids.administeredLabCode,
      billingContact: "billing@example.test",
    }, labActor);
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    governanceEntityIds.push(created.entityId);

    const beforeMembership = await prisma.user.findUniqueOrThrow({ where: { id: ids.target }, select: { authzVersion: true } });
    const membership = await upsertLabMembership({
      labId: created.entityId,
      userId: ids.target,
      role: "viewer",
      reason: "Grant read-only lab access",
    }, labActor);
    expect(membership.ok).toBe(true);
    const afterMembership = await prisma.user.findUniqueOrThrow({ where: { id: ids.target }, select: { authzVersion: true } });
    expect(afterMembership.authzVersion).toBe(beforeMembership.authzVersion + 1);

    expect((await updateLabDetails({
      labId: created.entityId,
      name: "Renamed Test Lab",
      notes: "Administrative verification",
    }, labActor)).ok).toBe(true);

    await prisma.labMembership.updateMany({ where: { labId: created.entityId }, data: { active: false } });
    expect((await setLabActiveState({
      labId: created.entityId,
      active: false,
      reason: "Verification lab is complete",
    }, labActor)).ok).toBe(true);
    expect((await setLabActiveState({
      labId: created.entityId,
      active: true,
      reason: "Restore for cleanup verification",
    }, labActor)).ok).toBe(true);
  });

  it("deactivates an account, increments authorization version, and blocks self-deactivation", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: ids.target } });
    const deactivated = await setUserActiveState({
      targetUserId: ids.target,
      active: false,
      reason: "Temporary access suspension",
    }, requester);
    expect(deactivated.ok).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: ids.target } });
    expect(after.active).toBe(false);
    expect(after.authzVersion).toBe(before.authzVersion + 1);

    expect((await setUserActiveState({
      targetUserId: requester.id,
      active: false,
      reason: "Attempt self deactivation",
    }, requester)).ok).toBe(false);

    expect((await setUserActiveState({
      targetUserId: ids.target,
      active: true,
      reason: "Restore test access",
    }, requester)).ok).toBe(true);
  });

  it("rejects an in-flight governance mutation after the actor is revoked", async () => {
    await prisma.user.update({
      where: { id: ids.requester },
      data: { authzVersion: { increment: 1 } },
    });

    const result = await createUserInvitation({
      email: `stale-actor-${runId}@example.test`,
      targetRole: "cmu_staff",
    }, requester);
    expect(result).toMatchObject({
      ok: false,
      message: "Your administrator access changed. Sign in again.",
    });
  });
});
