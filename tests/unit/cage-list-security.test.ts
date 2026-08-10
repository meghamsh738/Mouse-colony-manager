import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActorLabAccess: vi.fn(),
  ruleFindMany: vi.fn(),
  cageCount: vi.fn(),
  cageFindMany: vi.fn(),
  alertFindMany: vi.fn(),
  labFindMany: vi.fn(),
  chargeCategoryFindMany: vi.fn(),
}));

vi.mock("@/lib/lab-access", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/lab-access")>();
  return { ...original, getActorLabAccess: mocks.getActorLabAccess };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ruleConfig: { findMany: mocks.ruleFindMany },
    cage: { count: mocks.cageCount, findMany: mocks.cageFindMany },
    alert: { findMany: mocks.alertFindMany },
    lab: { findMany: mocks.labFindMany },
    cageChargeCategory: { findMany: mocks.chargeCategoryFindMany },
  },
}));

import {
  getCageInventoryPageView,
  getCageListView,
  normalizeCageInventoryQuery,
} from "@/lib/cages-read";

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
    mocks.cageCount.mockResolvedValue(1);
    mocks.labFindMany.mockResolvedValue([{ id: "lab-a", name: "Lab A", code: "LAB-A" }]);
    mocks.chargeCategoryFindMany.mockResolvedValue([]);
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

  it("normalizes and bounds cage inventory query parameters", () => {
    expect(normalizeCageInventoryQuery({
      chargeCategoryId: "  charge-standard  ",
      chargeState: "chargeable",
      labId: "  lab-a  ",
      occupancy: "occupied",
      page: "0",
      pageSize: "999",
      search: ["  CM-A101  ", "ignored"],
      sex: "mixed",
      status: "breeding",
      warningsOnly: "true",
    })).toEqual({
      chargeCategoryId: "charge-standard",
      chargeState: "chargeable",
      labId: "lab-a",
      occupancy: "occupied",
      page: 1,
      pageSize: 100,
      search: "CM-A101",
      sex: "mixed",
      status: "breeding",
      warningsOnly: true,
    });
  });

  it("paginates authorized whole-colony cage filters before projecting rows", async () => {
    mocks.cageCount.mockResolvedValue(205);

    const page = await getCageInventoryPageView(actor, {
      chargeState: "chargeable",
      occupancy: "occupied",
      page: "2",
      pageSize: "100",
      search: "Allowed strain",
      sex: "female",
      status: "active",
    });
    const countQuery = mocks.cageCount.mock.calls[0]?.[0];
    const listQuery = mocks.cageFindMany.mock.calls[0]?.[0];

    expect(page).toMatchObject({ page: 2, pageCount: 3, pageSize: 100, totalCount: 205 });
    expect(countQuery.where).toMatchObject({ labId: { in: ["lab-a"] } });
    expect(countQuery.where.AND).toEqual(expect.arrayContaining([
      { status: "active" },
      { animals: { some: { outcomeStatus: "alive" } } },
      { animals: { some: { outcomeStatus: "alive", sex: "female" } } },
      { active: true, status: { not: "closed" }, chargePeriods: { some: { endedAt: null } } },
    ]));
    expect(countQuery.where.OR).toEqual(expect.arrayContaining([
      { barcode: { contains: "Allowed strain", mode: "insensitive" } },
      {
        labId: "lab-a",
        animals: {
          some: expect.objectContaining({
            owningLabId: "lab-a",
            OR: expect.arrayContaining([{
              projectAllocations: {
                some: {
                  endedAt: null,
                  project: {
                    labId: "lab-a",
                    projectCode: { contains: "Allowed strain", mode: "insensitive" },
                  },
                },
              },
            }]),
          }),
        },
      },
    ]));
    expect(listQuery).toMatchObject({
      orderBy: [{ room: { roomNumber: "asc" } }, { rack: { rackNumber: "asc" } }, { cageNumber: "asc" }],
      skip: 100,
      take: 100,
      where: countQuery.where,
    });
    expect(page.filterOptions).toEqual({
      labs: [{ id: "lab-a", label: "Lab A (LAB-A)" }],
      chargeCategories: [],
    });
  });

  it("derives warning-only cage IDs from scoped rule and stored alert inputs before counting", async () => {
    mocks.alertFindMany.mockResolvedValue([{
      id: "allowed-alert",
      labId: "lab-a",
      entityType: "cage",
      entityId: "cage-a",
      alertType: "allowed",
      severity: "warning",
      message: "Allowed alert",
      status: "open",
      generatedAt: new Date("2026-07-01T00:00:00.000Z"),
      resolvedAt: null,
      source: "manual",
    }]);

    await getCageInventoryPageView(actor, { warningsOnly: "true" });
    const warningCandidateQuery = mocks.cageFindMany.mock.calls[0]?.[0];
    const listQuery = mocks.cageFindMany.mock.calls[1]?.[0];
    const countWhere = mocks.cageCount.mock.calls[0]?.[0]?.where;

    expect(warningCandidateQuery.where).toEqual({ labId: { in: ["lab-a"] } });
    expect(countWhere).toMatchObject({
      labId: { in: ["lab-a"] },
      AND: [{ id: { in: ["cage-a"] } }],
    });
    expect(listQuery.where).toEqual(countWhere);
  });
});
