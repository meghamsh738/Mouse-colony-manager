import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cryostorageFindMany: vi.fn(),
  quarantineFindMany: vi.fn(),
  sopFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cryostorageRequest: { findMany: mocks.cryostorageFindMany },
    quarantineCase: { findMany: mocks.quarantineFindMany },
    sopVersion: { findMany: mocks.sopFindMany },
  },
}));

import { getSupplementalApprovalInbox } from "@/lib/approval-inbox-read";
import type { ResolvedActor } from "@/lib/session";

function actor(
  canonicalRole: "facility_admin" | "cmu_staff" | "lab_user" | "it_head",
  membershipRole: "manager" | "staff" | "viewer" = "manager",
): ResolvedActor {
  const membership = canonicalRole === "lab_user"
    ? { labId: "lab-1", labCode: "LAB-1", labName: "Lab 1", role: membershipRole }
    : null;
  return {
    id: `user-${canonicalRole}`,
    email: `${canonicalRole}@example.test`,
    name: canonicalRole,
    role: canonicalRole === "facility_admin" ? "admin" : canonicalRole === "cmu_staff" ? "colony_manager" : "read_only",
    databaseRole: canonicalRole,
    canonicalRole,
    authzVersion: 1,
    activeLabId: membership?.labId ?? null,
    activeMembership: membership,
    memberships: membership ? [membership] : [],
    capabilities: [],
  };
}

describe("supplemental approval inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.quarantineFindMany.mockResolvedValue([{
      id: "case-1",
      releaseRequestedAt: new Date("2026-07-01T00:00:00Z"),
      releaseRequestReason: "Holding period complete",
      cage: { barcode: "CM-1001" },
      lab: { code: "LAB-1", name: "Lab 1" },
    }]);
    mocks.cryostorageFindMany.mockResolvedValue([{
      id: "cryo-1",
      requestType: "new_storage",
      sampleLabel: "CRYO-001",
      materialType: "embryos",
      requestedAt: new Date("2026-07-02T00:00:00Z"),
      requestedFor: new Date("2026-07-20T00:00:00Z"),
      lab: { code: "LAB-1", name: "Lab 1" },
    }]);
    mocks.sopFindMany.mockResolvedValue([{
      id: "version-1",
      sopId: "sop-1",
      versionNumber: 2,
      title: "Animal intake",
      changeSummary: "Updated holding requirements",
      createdAt: new Date("2026-07-03T00:00:00Z"),
      sop: { code: "SOP-INTAKE", scope: "facility", lab: null },
    }]);
  });

  it("gives Facility Admin the facility operations and independent SOP queues", async () => {
    const items = await getSupplementalApprovalInbox(actor("facility_admin"));

    expect(items.map((item) => item.category)).toEqual(["quarantine", "cryostorage", "sop"]);
    expect(mocks.sopFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { approval: null, createdById: { not: "user-facility_admin" }, sop: { scope: "facility" } },
    }));
  });

  it("gives CMU operational decisions but not SOP approval authority", async () => {
    const items = await getSupplementalApprovalInbox(actor("cmu_staff"));

    expect(items.map((item) => item.category)).toEqual(["quarantine", "cryostorage"]);
    expect(mocks.sopFindMany).not.toHaveBeenCalled();
  });

  it("scopes a lab manager SOP queue to the active lab and omits facility operations", async () => {
    mocks.sopFindMany.mockResolvedValueOnce([{
      id: "version-lab",
      sopId: "sop-lab",
      versionNumber: 1,
      title: "Lab procedure",
      changeSummary: "Initial version",
      createdAt: new Date("2026-07-04T00:00:00Z"),
      sop: { code: "LAB-SOP", scope: "lab", lab: { code: "LAB-1", name: "Lab 1" } },
    }]);

    const items = await getSupplementalApprovalInbox(actor("lab_user", "manager"));

    expect(items.map((item) => item.category)).toEqual(["sop"]);
    expect(mocks.sopFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { approval: null, createdById: { not: "user-lab_user" }, sop: { scope: "lab", labId: "lab-1" } },
    }));
    expect(mocks.quarantineFindMany).not.toHaveBeenCalled();
    expect(mocks.cryostorageFindMany).not.toHaveBeenCalled();
  });

  it.each(["staff", "viewer"] as const)("returns no queue for a lab %s without approvals access", async (membershipRole) => {
    expect(await getSupplementalApprovalInbox(actor("lab_user", membershipRole))).toEqual([]);
    expect(mocks.sopFindMany).not.toHaveBeenCalled();
  });
});
