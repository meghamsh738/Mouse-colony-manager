import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { mocks, tx } = vi.hoisted(() => {
  const values = {
    transaction: vi.fn(), userFindUnique: vi.fn(), userUpdate: vi.fn(), userCount: vi.fn(), invitationFindUnique: vi.fn(), invitationFindMany: vi.fn(),
    invitationUpdate: vi.fn(), invitationCreate: vi.fn(), roleRequestFindUnique: vi.fn(), roleRequestFindFirst: vi.fn(), roleRequestUpdate: vi.fn(),
    roleRequestUpdateMany: vi.fn(), roleRequestCreate: vi.fn(), responsibilityFindFirst: vi.fn(), securityEvent: vi.fn(),
  };
  return { mocks: values, tx: {
    user: { findUnique: values.userFindUnique, update: values.userUpdate, count: values.userCount },
    userInvitation: { findUnique: values.invitationFindUnique, findMany: values.invitationFindMany, update: values.invitationUpdate, create: values.invitationCreate },
    privilegedRoleChangeRequest: {
      findUnique: values.roleRequestFindUnique, findFirst: values.roleRequestFindFirst, update: values.roleRequestUpdate,
      updateMany: values.roleRequestUpdateMany, create: values.roleRequestCreate,
    },
    cageUserAssignment: { findFirst: values.responsibilityFindFirst },
  } };
});

vi.mock("@/lib/prisma", () => ({ prisma: { ...tx, $transaction: mocks.transaction } }));
vi.mock("@/lib/security-event", () => ({ writeSecurityEvent: mocks.securityEvent }));

import { approvePrivilegedRoleChange, changeRoutineUserRole, createUserInvitation, rejectPrivilegedRoleChange, resendUserInvitation, revokeUserInvitation, setUserActiveState } from "@/lib/identity-governance";

const admin = { id: "admin-1", canonicalRole: "facility_admin" as const, authzVersion: 3 };

describe("invitation and privileged decision lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.securityEvent.mockResolvedValue({ id: "security-1" });
    mocks.userCount.mockResolvedValue(1);
    mocks.responsibilityFindFirst.mockResolvedValue(null);
  });

  it("rotates the token by revoking every pending predecessor and creating a new invitation", async () => {
    mocks.userFindUnique
      .mockResolvedValueOnce({ active: true, role: "facility_admin", authzVersion: 3 })
      .mockResolvedValueOnce(null);
    mocks.invitationFindUnique.mockResolvedValue({
      id: "invite-old",
      email: "member@example.test",
      name: "Member",
      status: "pending",
      targetRole: "lab_user",
      labId: "lab-1",
      membershipRole: "staff",
      lab: { active: true },
    });
    mocks.invitationFindMany.mockResolvedValue([{ id: "invite-old", labId: "lab-1" }]);
    mocks.invitationUpdate.mockResolvedValue({ id: "invite-old", status: "revoked" });
    mocks.invitationCreate.mockImplementation(({ data }) => Promise.resolve({ ...data, email: "member@example.test", labId: "lab-1" }));

    const result = await resendUserInvitation("invite-old", admin);
    expect(result).toMatchObject({ ok: true, message: "Invitation resent to member@example.test." });
    if (result.ok) expect(result.token).toHaveLength(43);
    expect(mocks.invitationUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "revoked" }) }));
    expect(mocks.invitationCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tokenHash: expect.not.stringContaining("=") }) }));
    expect(mocks.securityEvent).toHaveBeenCalledTimes(2);
  });

  it("requires a current Facility Admin to revoke a pending invitation", async () => {
    await expect(revokeUserInvitation("invite-1", "Incorrect recipient", { ...admin, canonicalRole: "cmu_staff" })).resolves.toMatchObject({ ok: false });
    expect(mocks.transaction).not.toHaveBeenCalled();

    mocks.userFindUnique.mockResolvedValue({ active: true, role: "facility_admin", authzVersion: 4 });
    await expect(revokeUserInvitation("invite-1", "Incorrect recipient", admin)).resolves.toEqual({
      ok: false,
      message: "Your administrator access changed. Sign in again.",
    });
  });

  it("requires an independent administrator for a privileged rejection", async () => {
    mocks.userFindUnique.mockResolvedValue({ active: true, role: "facility_admin", authzVersion: 3 });
    mocks.roleRequestFindUnique.mockResolvedValue({
      id: "role-request-1",
      targetUserId: "user-target",
      requestedById: admin.id,
      requestedByAuthzVersion: 3,
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
      requestedBy: { active: true, role: "facility_admin", authzVersion: 3 },
    });

    await expect(rejectPrivilegedRoleChange("role-request-1", "Incorrect authority", admin)).resolves.toEqual({
      ok: false,
      message: "A different Facility Admin must decide this request.",
    });
    expect(mocks.roleRequestUpdate).not.toHaveBeenCalled();
  });

  it("expires rather than rejects a request from a stale requester", async () => {
    mocks.userFindUnique.mockResolvedValue({ active: true, role: "facility_admin", authzVersion: 3 });
    mocks.roleRequestFindUnique.mockResolvedValue({
      id: "role-request-stale-rejection",
      targetUserId: "user-target",
      requestedById: "admin-2",
      requestedByAuthzVersion: 4,
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
      requestedBy: { active: false, role: "facility_admin", authzVersion: 5 },
    });
    mocks.roleRequestUpdate.mockResolvedValue({ id: "role-request-stale-rejection", status: "expired" });

    await expect(rejectPrivilegedRoleChange(
      "role-request-stale-rejection",
      "Request no longer reflects current authority",
      admin,
    )).resolves.toEqual({
      ok: false,
      message: "The requesting administrator's authority changed. The request was expired.",
    });
    expect(mocks.roleRequestUpdate).toHaveBeenCalledWith({
      where: { id: "role-request-stale-rejection" },
      data: { status: "expired" },
    });
  });

  it("revalidates the target's active lab membership before approving a Lab User transition", async () => {
    mocks.userFindUnique.mockResolvedValue({ active: true, role: "facility_admin", authzVersion: 3 });
    mocks.roleRequestFindUnique.mockResolvedValue({
      id: "role-request-2",
      targetUserId: "user-target",
      requestedById: "admin-2",
      requestedByAuthzVersion: 7,
      requestedActive: null,
      requestedRole: "lab_user",
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
      targetUser: {
        id: "user-target",
        role: "facility_admin",
        active: true,
        labMemberships: [],
      },
      requestedBy: { id: "admin-2", active: true, role: "facility_admin", authzVersion: 7 },
    });

    await expect(approvePrivilegedRoleChange("role-request-2", admin)).resolves.toEqual({
      ok: false,
      message: "Assign an active lab membership before changing this user to Lab User.",
    });
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.roleRequestUpdate).not.toHaveBeenCalled();
  });

  it("invalidates a privileged request when requester authority has changed", async () => {
    mocks.userFindUnique.mockResolvedValue({ active: true, role: "facility_admin", authzVersion: 3 });
    mocks.roleRequestFindUnique.mockResolvedValue({
      id: "role-request-stale",
      targetUserId: "user-target",
      requestedById: "admin-2",
      requestedByAuthzVersion: 7,
      requestedActive: null,
      requestedRole: "it_head",
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
      requestedBy: { id: "admin-2", active: true, role: "facility_admin", authzVersion: 8 },
      targetUser: { id: "user-target", role: "lab_user", active: true, labMemberships: [{ id: "membership-1" }] },
    });
    mocks.roleRequestUpdate.mockResolvedValue({ id: "role-request-stale", status: "expired" });

    await expect(approvePrivilegedRoleChange("role-request-stale", admin)).resolves.toEqual({
      ok: false,
      message: "The requesting administrator's authority changed. Submit a new request.",
    });
    expect(mocks.roleRequestUpdate).toHaveBeenCalledWith({
      where: { id: "role-request-stale" },
      data: { status: "expired" },
    });
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("routes privileged account deactivation through independent approval", async () => {
    mocks.userFindUnique
      .mockResolvedValueOnce({ active: true, role: "facility_admin", authzVersion: 3 })
      .mockResolvedValueOnce({ id: "admin-2", role: "facility_admin", active: true });
    mocks.roleRequestFindFirst.mockResolvedValue(null);
    mocks.roleRequestCreate.mockImplementation(({ data }) => Promise.resolve(data));

    await expect(setUserActiveState({
      targetUserId: "admin-2",
      active: false,
      reason: "Remove dormant privileged access",
    }, admin)).resolves.toMatchObject({ ok: true, message: "Privileged account state change sent for independent approval." });
    expect(mocks.roleRequestCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      requestedActive: false,
      requestedByAuthzVersion: 3,
      requestedRole: "facility_admin",
    }) });
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("applies a privileged account state change only after independent approval", async () => {
    mocks.userFindUnique.mockResolvedValue({ active: true, role: "facility_admin", authzVersion: 3 });
    mocks.roleRequestFindUnique.mockResolvedValue({
      id: "role-request-state",
      targetUserId: "admin-2",
      requestedById: "admin-3",
      requestedByAuthzVersion: 5,
      requestedActive: false,
      requestedRole: "facility_admin",
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
      requestedBy: { id: "admin-3", active: true, role: "facility_admin", authzVersion: 5 },
      targetUser: { id: "admin-2", role: "facility_admin", active: true, labMemberships: [] },
    });
    mocks.userUpdate.mockResolvedValue({ id: "admin-2", active: false });
    mocks.roleRequestUpdate.mockResolvedValue({ id: "role-request-state", status: "approved" });

    await expect(approvePrivilegedRoleChange("role-request-state", admin)).resolves.toEqual({
      ok: true,
      entityId: "admin-2",
      message: "Privileged account deactivated.",
    });
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "admin-2" },
      data: { active: false, authzVersion: { increment: 1 } },
    });
    expect(mocks.securityEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      eventType: "identity.account.deactivation.approved",
      severity: "critical",
    }));
  });

  it("retains the reason and before/after roles in routine access history", async () => {
    mocks.userFindUnique
      .mockResolvedValueOnce({ active: true, role: "facility_admin", authzVersion: 3 })
      .mockResolvedValueOnce({
        id: "user-target",
        role: "cmu_staff",
        active: true,
        labMemberships: [{ id: "membership-1" }],
      });
    mocks.userUpdate.mockResolvedValue({ id: "user-target", role: "lab_user" });

    await expect(changeRoutineUserRole({
      targetUserId: "user-target",
      requestedRole: "lab_user",
      reason: "Moving into the assigned lab team",
    }, admin)).resolves.toMatchObject({ ok: true });
    expect(mocks.securityEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      summary: "Routine user role changed from cmu_staff to lab_user. Reason: Moving into the assigned lab team",
    }));
  });

  it("returns a stable refresh response when a concurrent privileged decision aborts", async () => {
    mocks.transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("serialization failure", {
      code: "P2034",
      clientVersion: "6.19.3",
    }));

    await expect(approvePrivilegedRoleChange("role-request-race", admin)).resolves.toEqual({
      ok: false,
      message: "This privileged role request changed. Refresh and try again.",
    });
  });

  it("returns a stable refresh response when concurrent invitation creation aborts", async () => {
    mocks.transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("serialization failure", {
      code: "P2034",
      clientVersion: "6.19.3",
    }));

    await expect(createUserInvitation({
      email: "new.member@example.test",
      targetRole: "cmu_staff",
    }, admin)).resolves.toEqual({
      ok: false,
      message: "The invitation changed while it was being created. Refresh and try again.",
    });
  });
});
