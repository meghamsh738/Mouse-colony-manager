import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActorLabAccess: vi.fn(),
  animalCount: vi.fn(),
  animalFindFirst: vi.fn(),
  animalFindMany: vi.fn(),
  cageCount: vi.fn(),
  cageFindFirst: vi.fn(),
  cageFindMany: vi.fn(),
  ruleFindMany: vi.fn(),
}));

vi.mock("@/lib/lab-access", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/lab-access")>();
  return { ...original, getActorLabAccess: mocks.getActorLabAccess };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    animal: { count: mocks.animalCount, findFirst: mocks.animalFindFirst, findMany: mocks.animalFindMany },
    cage: { count: mocks.cageCount, findFirst: mocks.cageFindFirst, findMany: mocks.cageFindMany },
    ruleConfig: { findMany: mocks.ruleFindMany },
  },
}));

import {
  getAnimalTransferWorkspacePageView,
  getAnimalPresenceCageOptions,
  getCageClosureDestinationOptions,
  normalizeAnimalTransferQuery,
} from "@/lib/cages-read";

const actor = { id: "manager-a", role: "researcher" as const, activeLabId: "lab-a" };
const cageRow = {
  id: "cage-a",
  labId: "lab-a",
  barcode: "CM-A101-001",
  cageNumber: "001",
  status: "active",
  capacityOverride: null,
  room: { roomNumber: "A101", facility: { maxCageOccupancy: 6 } },
  rack: { rackNumber: "R1" },
  lab: { name: "Lab A", code: "A" },
  animals: [],
  _count: { healthNotes: 0 },
};

describe("bounded animal transfer reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActorLabAccess.mockResolvedValue({
      canViewAll: false,
      memberLabIds: ["lab-a", "lab-viewer"],
      manageableLabIds: ["lab-a"],
      membershipByLabId: new Map(),
    });
    mocks.ruleFindMany.mockResolvedValue([]);
    mocks.animalCount.mockResolvedValue(120);
    mocks.animalFindMany.mockResolvedValue([]);
    mocks.animalFindFirst.mockResolvedValue({ id: "animal-a", owningLabId: "lab-a" });
    mocks.cageCount.mockResolvedValue(65);
    mocks.cageFindMany.mockResolvedValue([cageRow]);
    mocks.cageFindFirst.mockResolvedValue({ id: "cage-a", labId: "lab-a" });
  });

  it("normalizes search and enforces the hard page-size cap", () => {
    expect(normalizeAnimalTransferQuery({
      animalPage: "999999",
      animalSearch: `${"a".repeat(120)}ignored`,
      destinationPage: "0",
      destinationSearch: "  A101  ",
      pageSize: "500",
    })).toEqual({
      animalPage: 100_000,
      animalSearch: "a".repeat(120),
      destinationPage: 1,
      destinationSearch: "A101",
      pageSize: 50,
    });
  });

  it("searches and pages only manageable labs with deterministic capped reads", async () => {
    const workspace = await getAnimalTransferWorkspacePageView("cage-a", actor, {
      animalPage: "999",
      animalSearch: "CM-26",
      destinationPage: "2",
      destinationSearch: "A101",
      pageSize: "999",
    });

    const animalQuery = mocks.animalFindMany.mock.calls[0]?.[0];
    expect(animalQuery.take).toBe(50);
    expect(animalQuery.skip).toBe(100);
    expect(animalQuery.where).toMatchObject({ owningLabId: { in: ["lab-a"] } });
    expect(animalQuery.where.OR).toContainEqual({ animalId: { contains: "CM-26", mode: "insensitive" } });
    expect(animalQuery.orderBy).toEqual([{ animalId: "asc" }, { id: "asc" }]);
    expect(workspace.animalResults).toMatchObject({ page: 3, pageCount: 3, pageSize: 50 });
    expect(workspace.destinationResults.page).toBe(2);

    const destinationQuery = mocks.cageFindMany.mock.calls.map(([query]) => query).find((query) => query.skip !== undefined);
    expect(destinationQuery.take).toBe(50);
    expect(destinationQuery.where.AND[0]).toMatchObject({ labId: { in: ["lab-a"] } });
    expect(destinationQuery.select._count.select.healthNotes.where).toEqual({
      resolved: false,
      OR: [{ followupRequired: true }, { severity: { in: ["warning", "critical"] } }],
    });
    expect(destinationQuery.select).not.toHaveProperty("healthNotes");
  });

  it("authorizes the closure source first, scopes destinations to its lab, and never reads animals", async () => {
    const result = await getCageClosureDestinationOptions("cage-a", actor, {
      destinationPage: "999",
      destinationSearch: "R1",
      pageSize: "20",
    });

    expect(mocks.cageFindFirst).toHaveBeenCalledWith({
      where: { id: "cage-a", labId: { in: ["lab-a"] } },
      select: { id: true, labId: true },
    });
    expect(mocks.animalFindMany).not.toHaveBeenCalled();
    const destinationQuery = mocks.cageFindMany.mock.calls[0]?.[0];
    expect(destinationQuery.where.AND[0]).toMatchObject({ id: { not: "cage-a" }, labId: "lab-a" });
    expect(destinationQuery.take).toBe(20);
    expect(result).toMatchObject({ page: 4, pageCount: 4, pageSize: 20, search: "R1" });
  });

  it("keeps a requested destination separate without dropping paginated results or changing totals", async () => {
    const pageRows = Array.from({ length: 20 }, (_, index) => ({
      ...cageRow,
      id: `page-${index}`,
      barcode: `PAGE-${String(index).padStart(2, "0")}`,
    }));
    const pinnedRow = { ...cageRow, id: "pinned", barcode: "PINNED" };
    mocks.cageCount.mockResolvedValue(65);
    mocks.cageFindMany.mockImplementation(async (query) => query.skip !== undefined ? pageRows : [pinnedRow]);

    const workspace = await getAnimalTransferWorkspacePageView("pinned", actor);

    expect(workspace.cageOptions).toHaveLength(20);
    expect(workspace.cageOptions.map((cage) => cage.id)).toEqual(pageRows.map((cage) => cage.id));
    expect(workspace.pinnedDestination?.id).toBe("pinned");
    expect(workspace.defaultDestinationCageId).toBe("pinned");
    expect(workspace.destinationResults).toMatchObject({ totalCount: 65, page: 1, pageCount: 4, pageSize: 20 });
  });

  it("authorizes a missing animal and pages only cages from its owning lab, including for global actors", async () => {
    mocks.getActorLabAccess.mockResolvedValue({
      canViewAll: true,
      memberLabIds: [],
      manageableLabIds: [],
      membershipByLabId: new Map(),
    });
    mocks.animalFindFirst.mockResolvedValue({ id: "animal-global", owningLabId: "lab-b" });
    mocks.cageCount.mockResolvedValue(75);

    const result = await getAnimalPresenceCageOptions("animal-global", { id: "admin", role: "admin" }, {
      presencePage: "2",
      presenceSearch: "B2",
    });

    expect(mocks.animalFindFirst).toHaveBeenCalledWith({
      where: { id: "animal-global", outcomeStatus: "missing" },
      select: { id: true, owningLabId: true },
    });
    const cageQuery = mocks.cageFindMany.mock.calls[0]?.[0];
    expect(cageQuery.where.AND[0]).toMatchObject({ labId: "lab-b" });
    expect(cageQuery.skip).toBe(20);
    expect(cageQuery.take).toBe(20);
    expect(result).toMatchObject({ totalCount: 75, page: 2, pageCount: 4, pageSize: 20, search: "B2" });
  });

  it("rejects missing-animal cage options when the actor cannot manage the owning lab", async () => {
    mocks.animalFindFirst.mockResolvedValue(null);

    await expect(getAnimalPresenceCageOptions("animal-viewer", actor)).resolves.toBeNull();

    expect(mocks.animalFindFirst).toHaveBeenCalledWith({
      where: { id: "animal-viewer", outcomeStatus: "missing", owningLabId: { in: ["lab-a"] } },
      select: { id: true, owningLabId: true },
    });
    expect(mocks.cageFindMany).not.toHaveBeenCalled();
  });
});
