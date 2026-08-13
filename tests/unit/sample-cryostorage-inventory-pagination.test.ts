import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActorReadLabAccess: vi.fn(),
  sampleCount: vi.fn(),
  sampleFindMany: vi.fn(),
  experimentFindMany: vi.fn(),
  cryostorageCount: vi.fn(),
  cryostorageFindMany: vi.fn(),
}));

vi.mock("@/lib/lab-access", () => ({
  getActorReadLabAccess: mocks.getActorReadLabAccess,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sampleRecord: { count: mocks.sampleCount, findMany: mocks.sampleFindMany },
    experiment: { findMany: mocks.experimentFindMany },
    cryostorageRecord: { count: mocks.cryostorageCount, findMany: mocks.cryostorageFindMany },
  },
}));

import {
  getCryostorageInventoryPageView,
  getCryostorageInventoryView,
  getCryostorageRequestTargets,
  normalizeCryostorageInventoryQuery,
} from "@/lib/cryostorage-read";
import {
  getSampleInventoryPageView,
  getSampleInventoryFilterOptions,
  getSampleInventoryView,
  normalizeSampleInventoryQuery,
} from "@/lib/samples-read";

const actor = { id: "lab-a-user", role: "researcher" as const, activeLabId: "lab-a" };

const sampleRow = {
  id: "sample-a",
  labId: "lab-a",
  sampleLabel: "DNA-A",
  sampleType: "DNA",
  status: "stored",
  collectedAt: new Date("2026-01-02T00:00:00.000Z"),
  storageLocation: "F1",
  quantityLabel: "20 uL",
  notes: null,
  version: 1,
  animal: { id: "animal-a", animalId: "A-1", labId: "LAB-A-1" },
  project: { projectCode: "PROJECT-A", labId: "lab-a" },
  experiment: { id: "experiment-a", experimentCode: "EXP-A", labId: "lab-a" },
};

const cryostorageRow = {
  id: "cryo-a",
  labId: "lab-a",
  lab: { code: "LAB-A", name: "Lab A" },
  sampleLabel: "CRYO-A",
  materialType: "Embryos",
  status: "stored",
  storedAt: new Date("2026-01-02T00:00:00.000Z"),
  storageLocation: "Tank 1",
  quantityLabel: "10 embryos",
  recoveryNotes: null,
  notes: null,
  version: 1,
  strain: { id: "strain-a", name: "C57BL/6J" },
  project: { projectCode: "PROJECT-A", labId: "lab-a" },
};

describe("sample and cryostorage inventory pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActorReadLabAccess.mockResolvedValue({
      canViewAll: false,
      memberLabIds: ["lab-a"],
      manageableLabIds: ["lab-a"],
      membershipByLabId: new Map(),
    });
    mocks.sampleCount.mockResolvedValue(205);
    mocks.experimentFindMany.mockResolvedValue([]);
    mocks.sampleFindMany.mockImplementation(async (query: { distinct?: unknown; select?: unknown }) =>
      query.distinct
        ? [{ sampleType: "DNA" }]
        : [sampleRow],
    );
    mocks.cryostorageCount.mockResolvedValue(205);
    mocks.cryostorageFindMany.mockImplementation(async (query: { distinct?: unknown; select?: Record<string, unknown> }) => {
      if (query.distinct) return [{ strain: { id: "strain-a", name: "C57BL/6J" } }];
      if (query.select && !query.select.lab) {
        return [{
          id: cryostorageRow.id,
          labId: cryostorageRow.labId,
          sampleLabel: cryostorageRow.sampleLabel,
          materialType: cryostorageRow.materialType,
          status: cryostorageRow.status,
        }];
      }
      return [cryostorageRow];
    });
  });

  it("normalizes and bounds both inventory query strings", () => {
    expect(normalizeSampleInventoryQuery({
      experimentId: "  experiment-a  ",
      page: "0",
      pageSize: "999",
      sampleType: "  DNA  ",
      search: ["  freezer  ", "ignored"],
      status: "stored",
    })).toEqual({
      experimentId: "experiment-a",
      page: 1,
      pageSize: 100,
      sampleType: "DNA",
      search: "freezer",
      status: "stored",
    });
    expect(normalizeCryostorageInventoryQuery({
      page: "2",
      pageSize: "500",
      search: "  tank  ",
      status: "reserved",
      strainId: "  strain-a  ",
    })).toEqual({
      page: 2,
      pageSize: 100,
      search: "tank",
      status: "reserved",
      strainId: "strain-a",
    });
  });

  it("filters the authorized whole biosample dataset before stable pagination", async () => {
    const page = await getSampleInventoryPageView(actor, {
      experimentId: "experiment-a",
      page: "2",
      pageSize: "100",
      sampleType: "DNA",
      search: "PROJECT-A",
      status: "stored",
    });
    const countQuery = mocks.sampleCount.mock.calls[0]?.[0];
    const listQuery = mocks.sampleFindMany.mock.calls.map(([query]) => query).find((query) => query.take);

    expect(page).toMatchObject({ page: 2, pageCount: 3, pageSize: 100, totalCount: 205, sampleTypes: ["DNA"] });
    expect(countQuery.where).toMatchObject({
      experimentId: "experiment-a",
      labId: { in: ["lab-a"] },
      sampleType: "DNA",
      status: "stored",
    });
    expect(countQuery.where.OR).toEqual(expect.arrayContaining([
      { sampleLabel: { contains: "PROJECT-A", mode: "insensitive" } },
      { project: { projectCode: { contains: "PROJECT-A", mode: "insensitive" } } },
    ]));
    expect(listQuery).toMatchObject({
      orderBy: [{ collectedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      skip: 100,
      take: 100,
      where: countQuery.where,
    });
  });

  it("loads viewer filter experiments without loading create-form animal choices", async () => {
    await getSampleInventoryFilterOptions(actor);

    expect(mocks.experimentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { labId: { in: ["lab-a"] } },
    }));
  });

  it("filters the authorized whole cryostorage dataset before stable pagination", async () => {
    const page = await getCryostorageInventoryPageView(actor, {
      page: "2",
      pageSize: "100",
      search: "Tank 1",
      status: "stored",
      strainId: "strain-a",
    });
    const countQuery = mocks.cryostorageCount.mock.calls[0]?.[0];
    const listQuery = mocks.cryostorageFindMany.mock.calls.map(([query]) => query).find((query) => query.take);

    expect(page).toMatchObject({ page: 2, pageCount: 3, pageSize: 100, totalCount: 205 });
    expect(page.strainOptions).toEqual([{ id: "strain-a", label: "C57BL/6J" }]);
    expect(countQuery.where).toMatchObject({
      labId: { in: ["lab-a"] },
      status: "stored",
      strainId: "strain-a",
    });
    expect(countQuery.where.OR).toEqual(expect.arrayContaining([
      { sampleLabel: { contains: "Tank 1", mode: "insensitive" } },
      { storageLocation: { contains: "Tank 1", mode: "insensitive" } },
    ]));
    expect(listQuery).toMatchObject({
      orderBy: [{ storedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      skip: 100,
      take: 100,
      where: countQuery.where,
    });
  });

  it("uses a narrow authorized projection for request targets", async () => {
    const targets = await getCryostorageRequestTargets(actor);
    const query = mocks.cryostorageFindMany.mock.calls[0]?.[0];

    expect(targets).toEqual([{
      id: "cryo-a",
      labId: "lab-a",
      sampleLabel: "CRYO-A",
      materialType: "Embryos",
      status: "stored",
    }]);
    expect(query).toMatchObject({
      orderBy: [{ sampleLabel: "asc" }, { id: "asc" }],
      select: {
        id: true,
        labId: true,
        materialType: true,
        sampleLabel: true,
        status: true,
      },
      where: {
        labId: { in: ["lab-a"] },
        status: { in: ["stored", "reserved", "recovered"] },
      },
    });
  });

  it("keeps the existing API and Workbook inventory reads unbounded", async () => {
    await Promise.all([getSampleInventoryView(actor), getCryostorageInventoryView(actor)]);
    const sampleQuery = mocks.sampleFindMany.mock.calls[0]?.[0];
    const cryostorageQuery = mocks.cryostorageFindMany.mock.calls[0]?.[0];

    expect(sampleQuery).not.toHaveProperty("skip");
    expect(sampleQuery).not.toHaveProperty("take");
    expect(cryostorageQuery).not.toHaveProperty("skip");
    expect(cryostorageQuery).not.toHaveProperty("take");
  });
});
