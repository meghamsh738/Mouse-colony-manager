import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cageFindFirst: vi.fn(),
  healthNoteFindMany: vi.fn(),
  alertFindMany: vi.fn(),
  roomFindMany: vi.fn(),
  rackFindMany: vi.fn(),
  labFindMany: vi.fn(),
  chargeCategoryFindMany: vi.fn(),
  getActorLabAccess: vi.fn(),
  ruleFindMany: vi.fn(),
}));

vi.mock("@/lib/lab-access", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/lab-access")>();
  return { ...original, getActorLabAccess: mocks.getActorLabAccess };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cage: { findFirst: mocks.cageFindFirst },
    healthNote: { findMany: mocks.healthNoteFindMany },
    alert: { findMany: mocks.alertFindMany },
    room: { findMany: mocks.roomFindMany },
    rack: { findMany: mocks.rackFindMany },
    lab: { findMany: mocks.labFindMany },
    cageChargeCategory: { findMany: mocks.chargeCategoryFindMany },
    ruleConfig: { findMany: mocks.ruleFindMany },
  },
}));

import { getCageDetailView, getScanCageViewByBarcode } from "@/lib/cages-read";

const actor = { id: "lab-a-user", role: "researcher" as const, activeLabId: "lab-a" };

describe("cage detail history privacy and bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActorLabAccess.mockResolvedValue({
      canViewAll: false,
      memberLabIds: ["lab-a"],
      manageableLabIds: [],
      membershipByLabId: new Map(),
    });
    mocks.ruleFindMany.mockResolvedValue([]);
    mocks.cageFindFirst.mockResolvedValue(null);
    mocks.healthNoteFindMany.mockResolvedValue([]);
    mocks.alertFindMany.mockResolvedValue([]);
    mocks.roomFindMany.mockResolvedValue([]);
    mocks.rackFindMany.mockResolvedValue([]);
    mocks.labFindMany.mockResolvedValue([]);
    mocks.chargeCategoryFindMany.mockResolvedValue([]);
  });

  it("authorizes the root cage in Prisma before loading capped detail histories", async () => {
    await expect(getCageDetailView("cage-a", actor)).resolves.toBeNull();

    const query = mocks.cageFindFirst.mock.calls[0]?.[0];
    expect(query.where).toEqual({ id: "cage-a", labId: { in: ["lab-a"] } });
    expect(query.include.healthNotes).toMatchObject({
      orderBy: { createdAt: "desc" },
      take: 50,
      where: { cageId: { not: null }, labId: { in: ["lab-a"] } },
    });
    expect(query.include.cageMovements).toMatchObject({ orderBy: { movedAt: "desc" }, take: 50 });
  });

  it("authorizes barcode lookup in Prisma and keeps scan history deliberately small", async () => {
    await expect(getScanCageViewByBarcode("CM-A101", actor)).resolves.toBeNull();

    const query = mocks.cageFindFirst.mock.calls[0]?.[0];
    expect(query.where).toEqual({ barcode: "CM-A101", labId: { in: ["lab-a"] } });
    expect(query.include.healthNotes).toMatchObject({
      orderBy: { createdAt: "desc" },
      take: 15,
      where: { cageId: { not: null }, labId: { in: ["lab-a"] } },
    });
    expect(query.include.cageMovements).toMatchObject({ orderBy: { movedAt: "desc" }, take: 3 });
  });

  it("keeps an older unresolved critical welfare alert when newer warnings fill the visible history", async () => {
    const visibleWarnings = Array.from({ length: 50 }, (_, index) => ({
      id: `warning-${index}`,
      labId: "lab-a",
      note: `Recent warning ${index}`,
      severity: "warning",
      followupRequired: false,
      resolved: false,
      createdAt: new Date(`2026-07-${String(31 - (index % 30)).padStart(2, "0")}T00:00:00.000Z`),
      attachments: [],
    }));
    const olderCritical = {
      id: "older-critical",
      note: "Older critical welfare concern",
      severity: "critical",
      followupRequired: true,
      resolved: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    mocks.cageFindFirst.mockResolvedValue({
      id: "cage-a",
      version: 1,
      barcode: "CM-A101",
      status: "active",
      active: true,
      capacityOverride: null,
      labId: "lab-a",
      roomId: "room-a",
      rackId: "rack-a",
      cageNumber: "101",
      welfareFlags: [],
      lastUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
      notes: null,
      room: { roomNumber: "A", facility: { maxCageOccupancy: 6 } },
      rack: { rackNumber: "R1" },
      lab: { id: "lab-a", name: "Lab A", code: "LAB-A" },
      closure: null,
      chargePeriods: [],
      animals: [],
      healthNotes: visibleWarnings,
      cageMovements: [],
      userAssignments: [],
    });
    mocks.healthNoteFindMany.mockResolvedValue([visibleWarnings[0], olderCritical]);

    const detail = await getCageDetailView("cage-a", actor);

    expect(mocks.healthNoteFindMany).toHaveBeenCalledWith({
      where: {
        cageId: "cage-a",
        labId: "lab-a",
        resolved: false,
        OR: [{ followupRequired: true }, { severity: { in: ["warning", "critical"] } }],
      },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        note: true,
        severity: true,
        followupRequired: true,
        resolved: true,
        createdAt: true,
      },
    });
    expect(detail?.notes).toHaveLength(50);
    expect(detail?.notes.some((note) => note.id === olderCritical.id)).toBe(false);
    expect(detail?.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "rule-cage-note-older-critical",
        severity: "critical",
        message: olderCritical.note,
      }),
    ]));
  });
});
