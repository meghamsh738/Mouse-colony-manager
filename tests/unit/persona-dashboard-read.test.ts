import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  supplemental: vi.fn(),
  animalCount: vi.fn(),
  cageCount: vi.fn(),
  cryostorageCount: vi.fn(),
  invoiceCount: vi.fn(),
  labCount: vi.fn(),
  quarantineCount: vi.fn(),
  roleRequestCount: vi.fn(),
  ruleCount: vi.fn(),
  transaction: vi.fn(),
  transferCount: vi.fn(),
  userCount: vi.fn(),
}));

vi.mock("@/lib/lab-access", () => ({ getActorLabAccess: mocks.access }));
vi.mock("@/lib/approval-inbox-read", () => ({ getSupplementalApprovalInbox: mocks.supplemental }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    animal: { count: mocks.animalCount },
    cage: { count: mocks.cageCount },
    cryostorageRequest: { count: mocks.cryostorageCount },
    invoice: { count: mocks.invoiceCount },
    lab: { count: mocks.labCount },
    labTransferRequest: { count: mocks.transferCount },
    privilegedRoleChangeRequest: { count: mocks.roleRequestCount },
    quarantineCase: { count: mocks.quarantineCount },
    ruleConfig: { count: mocks.ruleCount },
    user: { count: mocks.userCount },
  },
}));

import { getPersonaDashboardView } from "@/lib/persona-dashboard-read";
import type { ResolvedActor } from "@/lib/session";

function actor(role: "facility_admin" | "cmu_staff" | "lab_user", membershipRole: "manager" | "staff" | "viewer" = "manager"): ResolvedActor {
  const membership = role === "lab_user"
    ? { labId: "lab-1", labCode: "LAB-1", labName: "Lab 1", role: membershipRole }
    : null;
  return {
    id: `user-${role}`,
    email: `${role}@example.test`,
    name: role,
    role: role === "facility_admin" ? "admin" : role === "cmu_staff" ? "colony_manager" : "animal_staff",
    databaseRole: role,
    canonicalRole: role,
    authzVersion: 1,
    activeLabId: membership?.labId ?? null,
    activeMembership: membership,
    memberships: membership ? [membership] : [],
    capabilities: [],
  };
}

describe("persona dashboard read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((queries) => Promise.all(queries));
    mocks.supplemental.mockResolvedValue([]);
    mocks.roleRequestCount.mockResolvedValue(2);
    mocks.transferCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    mocks.quarantineCount.mockResolvedValue(4);
    mocks.cryostorageCount.mockResolvedValue(5);
    mocks.invoiceCount.mockResolvedValue(6);
    mocks.labCount.mockResolvedValue(2);
    mocks.userCount.mockResolvedValue(5);
    mocks.ruleCount.mockResolvedValue(8);
    mocks.cageCount.mockResolvedValue(0);
    mocks.animalCount.mockResolvedValue(0);
  });

  it("orders Facility Admin governance work and exposes guided empty setup", async () => {
    mocks.access.mockResolvedValue({ canViewAll: true, memberLabIds: [], manageableLabIds: [] });
    mocks.supplemental.mockResolvedValue([
      ...Array.from({ length: 4 }, (_, index) => ({ category: "quarantine", id: `q-${index}` })),
      ...Array.from({ length: 5 }, (_, index) => ({ category: "cryostorage", id: `c-${index}` })),
    ]);

    const view = await getPersonaDashboardView(actor("facility_admin"));

    expect(view.queue.map((item) => [item.label, item.count])).toEqual([
      ["Access decisions", 2],
      ["CMU finalization", 1],
      ["Release requests", 4],
      ["Cryostorage requests", 5],
      ["SOP decisions", 0],
      ["Draft invoices", 6],
    ]);
    expect(view.onboarding.map((step) => [step.id, step.complete])).toEqual([
      ["labs", true], ["users", true], ["rules", true], ["cages", false], ["intake", false],
    ]);
    expect(mocks.userCount).toHaveBeenCalledWith({
      where: {
        active: true,
        role: { in: ["lab_user", "animal_staff", "researcher", "read_only"] },
        labMemberships: { some: { active: true, lab: { active: true } } },
      },
    });
  });

  it("does not treat CMU-only accounts as the first lab user", async () => {
    mocks.access.mockResolvedValue({ canViewAll: true, memberLabIds: [], manageableLabIds: [] });
    mocks.userCount.mockResolvedValue(0);

    const view = await getPersonaDashboardView(actor("facility_admin"));

    expect(view.onboarding.find((step) => step.id === "users")?.complete).toBe(false);
  });

  it("shows a manager only active-lab decisions they can perform", async () => {
    mocks.access.mockResolvedValue({ canViewAll: false, memberLabIds: ["lab-1"], manageableLabIds: ["lab-1"] });

    const view = await getPersonaDashboardView(actor("lab_user"));

    expect(view.onboarding).toEqual([]);
    expect(mocks.transferCount).toHaveBeenCalledWith({ where: { destinationLabId: "lab-1", status: "requested" } });
    expect(mocks.invoiceCount).toHaveBeenCalledWith({ where: { id: "__none__" } });
    expect(mocks.supplemental).toHaveBeenCalled();
    expect(view.queue.find((item) => item.id === "destination")?.href).toBe("/approvals");
  });

  it.each(["staff", "viewer"] as const)("does not link a %s member to inaccessible approvals", async (membershipRole) => {
    mocks.access.mockResolvedValue({ canViewAll: false, memberLabIds: ["lab-1"], manageableLabIds: [] });

    const view = await getPersonaDashboardView(actor("lab_user", membershipRole));

    expect(view.queue.some((item) => item.href === "/approvals")).toBe(false);
  });
});
