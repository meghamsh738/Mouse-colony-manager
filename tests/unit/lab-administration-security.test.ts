import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { mocks, tx } = vi.hoisted(() => {
  const values = {
    transaction: vi.fn(), userFindUnique: vi.fn(), userFindMany: vi.fn(), userUpdate: vi.fn(), userUpdateMany: vi.fn(),
    labFindUnique: vi.fn(), labFindMany: vi.fn(), labCreate: vi.fn(), labUpdate: vi.fn(),
    membershipFindUnique: vi.fn(), membershipFindMany: vi.fn(), membershipCreate: vi.fn(), membershipUpdate: vi.fn(),
    auditCreate: vi.fn(), cageCount: vi.fn(), animalCount: vi.fn(), chargeCount: vi.fn(), invoiceCount: vi.fn(),
    breedingCount: vi.fn(), experimentCount: vi.fn(), quarantineCount: vi.fn(), transferCount: vi.fn(),
    invitationFindMany: vi.fn(), invitationUpdate: vi.fn(), securityEvent: vi.fn(),
  };
  return { mocks: values, tx: {
    user: { findUnique: values.userFindUnique, findMany: values.userFindMany, update: values.userUpdate, updateMany: values.userUpdateMany },
    lab: { findUnique: values.labFindUnique, findMany: values.labFindMany, create: values.labCreate, update: values.labUpdate },
    labMembership: { findUnique: values.membershipFindUnique, findMany: values.membershipFindMany, create: values.membershipCreate, update: values.membershipUpdate },
    auditLog: { create: values.auditCreate }, cage: { count: values.cageCount }, animal: { count: values.animalCount },
    cageChargePeriod: { count: values.chargeCount }, invoice: { count: values.invoiceCount }, breedingSetup: { count: values.breedingCount },
    experiment: { count: values.experimentCount }, quarantineCase: { count: values.quarantineCount }, labTransferRequest: { count: values.transferCount },
    userInvitation: { findMany: values.invitationFindMany, update: values.invitationUpdate },
  } };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ...tx,
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/security-event", () => ({ writeSecurityEvent: mocks.securityEvent }));

import { getLabAdministrationView, setLabActiveState, updateLabDetails, upsertLabMembership } from "@/lib/lab-administration";
import type { ResolvedActor } from "@/lib/session";

const admin = {
  id: "admin-1",
  canonicalRole: "facility_admin" as const,
  authzVersion: 4,
  activeLabId: null,
  activeMembership: null,
};

describe("lab administration authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.securityEvent.mockResolvedValue({ id: "security-1" });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
    for (const count of [mocks.cageCount, mocks.animalCount, mocks.chargeCount, mocks.invoiceCount, mocks.breedingCount, mocks.experimentCount, mocks.quarantineCount, mocks.transferCount]) {
      count.mockResolvedValue(0);
    }
    mocks.invitationFindMany.mockResolvedValue([]);
  });

  it("rejects membership assignment before touching the database for a non-Facility actor", async () => {
    await expect(upsertLabMembership({ labId: "lab-1", userId: "user-1", role: "staff", reason: "Assign animal-care access" }, {
      ...admin,
      canonicalRole: "cmu_staff",
    })).resolves.toEqual({ ok: false, message: "Only Facility Admin can assign lab memberships." });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("scopes an owner directory read to the exact active lab and denies managers", async () => {
    mocks.labFindMany.mockResolvedValue([]);
    const owner: ResolvedActor = {
      id: "owner-1", email: "owner@example.test", name: "Owner", role: "animal_staff", databaseRole: "lab_user",
      canonicalRole: "lab_user", authzVersion: 1, activeLabId: "lab-1",
      activeMembership: { labId: "lab-1", labName: "One", labCode: "ONE", role: "owner" },
      memberships: [{ labId: "lab-1", labName: "One", labCode: "ONE", role: "owner" }], capabilities: [],
    };
    await expect(getLabAdministrationView(owner)).resolves.toMatchObject({ canAdministerMemberships: false, labs: [] });
    expect(mocks.labFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "lab-1", active: true } }));
    expect(mocks.userFindMany).not.toHaveBeenCalled();

    await expect(getLabAdministrationView({
      ...owner,
      activeMembership: { ...owner.activeMembership!, role: "manager" },
      memberships: [{ ...owner.memberships[0], role: "manager" }],
    })).rejects.toThrow("unavailable");
  });

  it("reauthorizes the administrator, permits a staged CMU membership, and revokes existing sessions", async () => {
    mocks.userFindUnique
      .mockResolvedValueOnce({ active: true, role: "facility_admin", authzVersion: 4, labMemberships: [] })
      .mockResolvedValueOnce({ id: "user-1", active: true, role: "cmu_staff" });
    mocks.labFindUnique.mockResolvedValue({ id: "lab-1", active: true });
    mocks.membershipFindUnique.mockResolvedValue(null);
    mocks.membershipCreate.mockResolvedValue({ id: "membership-1", labId: "lab-1", userId: "user-1", role: "staff", active: true });
    mocks.userUpdate.mockResolvedValue({ id: "user-1" });

    await expect(upsertLabMembership({ labId: "lab-1", userId: "user-1", role: "staff", reason: "Assign animal-care access" }, admin)).resolves.toMatchObject({ ok: true, entityId: "membership-1" });
    expect(mocks.userUpdate).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { authzVersion: { increment: 1 } } });
    expect(mocks.securityEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      eventType: "identity.lab_membership.assigned",
      scopeLabId: "lab-1",
      subjectId: "user-1",
      summary: "Lab membership none/inactive -> staff/active. Reason: Assign animal-care access",
    }));
  });

  it("returns a stable refresh response for concurrent first membership assignment", async () => {
    mocks.transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("unique conflict", {
      code: "P2002",
      clientVersion: "6.19.3",
    }));

    await expect(upsertLabMembership({
      labId: "lab-1",
      userId: "user-1",
      role: "staff",
      reason: "Assign animal-care access",
    }, admin)).resolves.toEqual({
      ok: false,
      message: "The record changed while it was being updated. Refresh and try again.",
    });
  });

  it("lets an active owner edit only the currently selected owned lab", async () => {
    const owner = {
      id: "owner-1",
      canonicalRole: "lab_user" as const,
      authzVersion: 2,
      activeLabId: "lab-1",
      activeMembership: { labId: "lab-1", labName: "One", labCode: "ONE", role: "owner" as const },
    };
    mocks.userFindUnique.mockResolvedValue({ active: true, role: "lab_user", authzVersion: 2, labMemberships: [{ role: "owner" }] });
    mocks.labFindUnique.mockResolvedValue({ id: "lab-1", name: "Old", billingContact: null, notes: null });
    mocks.labUpdate.mockResolvedValue({ id: "lab-1", name: "New", billingContact: null, notes: null });

    await expect(updateLabDetails({ labId: "lab-1", name: "New" }, owner)).resolves.toMatchObject({ ok: true });
    await expect(updateLabDetails({ labId: "lab-2", name: "Foreign" }, owner)).resolves.toEqual({ ok: false, message: "You no longer have authority to update this lab." });
    expect(mocks.labUpdate).toHaveBeenCalledTimes(1);
  });

  it("blocks lab deactivation while any operational cage remains", async () => {
    mocks.userFindUnique.mockResolvedValue({ active: true, role: "facility_admin", authzVersion: 4, labMemberships: [] });
    mocks.labFindUnique.mockResolvedValue({ id: "lab-1", active: true });
    mocks.cageCount.mockResolvedValue(1);

    await expect(setLabActiveState({ labId: "lab-1", active: false, reason: "Lab operations ended" }, admin)).resolves.toEqual({
      ok: false,
      message: "Resolve 1 active cage before deactivating this lab.",
    });
    expect(mocks.labUpdate).not.toHaveBeenCalled();
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });
});
