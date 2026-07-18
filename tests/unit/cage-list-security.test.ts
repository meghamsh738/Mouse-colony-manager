import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActorLabAccess: vi.fn(),
  ruleFindMany: vi.fn(),
  cageFindMany: vi.fn(),
  alertFindMany: vi.fn(),
}));

vi.mock("@/lib/lab-access", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/lab-access")>();
  return { ...original, getActorLabAccess: mocks.getActorLabAccess };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ruleConfig: { findMany: mocks.ruleFindMany },
    cage: { findMany: mocks.cageFindMany },
    alert: { findMany: mocks.alertFindMany },
  },
}));

import { getCageListView } from "@/lib/cages-read";

const actor = { id: "lab-a-user", role: "researcher" as const, activeLabId: "lab-a" };

function animal(id: string, owningLabId: string, sex: "male" | "female") {
  return {
    id,
    owningLabId,
    animalId: id.toUpperCase(),
    labId: `LAB-${id}`,
    sex,
    dob: new Date("2026-01-01T00:00:00.000Z"),
    status: "colony_holding",
    healthStatus: null,
    strain: { name: owningLabId === "lab-a" ? "Allowed strain" : "FOREIGN STRAIN" },
    alleles: owningLabId === "lab-a" ? [] : [{ zygosity: "+/-", allele: { name: "FOREIGN ALLELE" } }],
    projectAllocations: owningLabId === "lab-a"
      ? [
          { project: { projectCode: "PROJECT-A", labId: "lab-a" } },
          { project: { projectCode: "FOREIGN SAME-ANIMAL PROJECT", labId: "lab-b" } },
        ]
      : [{ project: { projectCode: "FOREIGN PROJECT", labId: owningLabId } }],
  };
}

describe("authorized cage list projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActorLabAccess.mockResolvedValue({
      canViewAll: false,
      memberLabIds: ["lab-a"],
      manageableLabIds: ["lab-a"],
      membershipByLabId: new Map(),
    });
    mocks.ruleFindMany.mockResolvedValue([
      { key: "cage_max_occupancy", value: 6 },
      { key: "mixed_sex_holding_allowed", value: false },
    ]);
    mocks.cageFindMany.mockResolvedValue([{
      id: "cage-a",
      roomId: "room-a",
      labId: "lab-a",
      cageNumber: "1000",
      barcode: "CAGE-1000",
      status: "holding",
      active: true,
      capacityOverride: null,
      welfareFlags: [],
      room: { roomNumber: "A", facility: { maxCageOccupancy: 6 } },
      rack: { rackNumber: "R1" },
      lab: { id: "lab-a", name: "Lab A", code: "LAB-A" },
      closure: null,
      chargePeriods: [],
      animals: [animal("allowed", "lab-a", "female"), animal("foreign", "lab-b", "male")],
      healthNotes: [],
    }]);
    mocks.alertFindMany.mockResolvedValue([
      {
        id: "foreign-alert",
        labId: "lab-b",
        entityType: "cage",
        entityId: "cage-a",
        alertType: "foreign",
        severity: "critical",
        message: "FOREIGN ALERT",
        status: "open",
        generatedAt: new Date("2026-07-01T00:00:00.000Z"),
        resolvedAt: null,
        source: "manual",
      },
      {
        id: "missing-lab-alert",
        labId: null,
        entityType: "cage",
        entityId: "cage-a",
        alertType: "missing-lab",
        severity: "warning",
        message: "NULL LAB ALERT",
        status: "open",
        generatedAt: new Date("2026-07-01T00:00:00.000Z"),
        resolvedAt: null,
        source: "manual",
      },
    ]);
  });

  it("omits foreign-owner animals, projects, alerts, and all derived aggregates", async () => {
    const [cage] = await getCageListView(actor);

    expect(cage.occupantCount).toBe(1);
    expect(cage.remainingCapacity).toBe(5);
    expect(cage.animalIdentifiers).toEqual(["ALLOWED"]);
    expect(cage.animalLabIdentifiers).toEqual(["LAB-allowed"]);
    expect(cage.sexComposition).toBe("1F");
    expect(cage.strainSummary).toBe("Allowed strain");
    expect(cage.projectSummary).toBe("PROJECT-A");
    expect(cage.warningMessages).not.toContain("FOREIGN ALERT");
    expect(cage.warningMessages).not.toContain("NULL LAB ALERT");
    expect(cage.animals.map((entry) => entry.id)).toEqual(["allowed"]);
    expect(JSON.stringify(cage)).not.toContain("FOREIGN");
  });
});
