import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  labFindMany: vi.fn(),
  cageFindMany: vi.fn(),
  ruleFindMany: vi.fn(),
  breedingFindMany: vi.fn(),
  animalCount: vi.fn(),
  animalGroupBy: vi.fn(),
  experimentFindMany: vi.fn(),
  cryoCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: db.userFindUnique },
    lab: { findMany: db.labFindMany },
    cage: { findMany: db.cageFindMany },
    ruleConfig: { findMany: db.ruleFindMany },
    breedingSetup: { findMany: db.breedingFindMany },
    animal: { count: db.animalCount, groupBy: db.animalGroupBy },
    experiment: { findMany: db.experimentFindMany },
    cryostorageRecord: { count: db.cryoCount },
  },
}));

import { getForecastWorkspaceView } from "@/lib/forecast-read";
import type { ResolvedActor } from "@/lib/session";

const actor = {
  id: "facility-1",
  email: "facility@example.test",
  name: "Facility admin",
  role: "facility_admin",
  databaseRole: "facility_admin",
  canonicalRole: "facility_admin",
  authzVersion: 3,
  activeLabId: null,
  activeMembership: null,
  memberships: [],
  capabilities: ["forecast:read"],
} as ResolvedActor;

beforeEach(() => {
  vi.clearAllMocks();
  db.userFindUnique.mockResolvedValue({ active: true, authzVersion: 3, role: "facility_admin" });
  db.labFindMany.mockResolvedValue([
    { id: "lab-1", name: "Lab One", code: "L1" },
    { id: "lab-2", name: "Lab Two", code: "L2" },
  ]);
  db.cageFindMany.mockResolvedValue([{
    id: "cage-1",
    barcode: "CM-1001",
    cageNumber: "001",
    room: { roomNumber: "A101" },
    rack: { rackNumber: "R1" },
    userAssignments: [{ userId: "user-1", user: { name: "User One", email: "one@example.test" } }],
  }]);
  db.ruleFindMany.mockResolvedValue([]);
  db.breedingFindMany.mockResolvedValue([]);
  db.animalCount.mockResolvedValue(0);
  db.animalGroupBy.mockResolvedValue([]);
  db.experimentFindMany.mockResolvedValue([]);
  db.cryoCount.mockResolvedValue(0);
});

describe("forecast scope", () => {
  it("applies validated lab, responsible user, and cage IDs to every animal-backed forecast query", async () => {
    const view = await getForecastWorkspaceView(actor, {
      labId: "lab-1",
      responsibleUserId: "user-1",
      cageId: "cage-1",
    });

    expect(view.scope.invalid).toBe(false);
    expect(db.cageFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ labId: { in: ["lab-1"] } }),
    }));
    expect(db.breedingFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        labId: { in: ["lab-1"] },
        adults: { some: { animal: { currentCageId: { in: ["cage-1"] } } } },
      }),
    }));
    expect(db.animalCount).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ owningLabId: { in: ["lab-1"] }, currentCageId: { in: ["cage-1"] } }),
    }));
    expect(db.experimentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        labId: { in: ["lab-1"] },
        assignments: { some: expect.objectContaining({ animal: { currentCageId: { in: ["cage-1"] } } }) },
      }),
    }));
    expect(view.summary.cryostorageBackups).toBe(0);
    expect(db.cryoCount).not.toHaveBeenCalled();
  });

  it("returns an empty server scope for inaccessible cage or user IDs", async () => {
    const view = await getForecastWorkspaceView(actor, {
      labId: "lab-1",
      responsibleUserId: "foreign-user",
      cageId: "foreign-cage",
    });

    expect(view.scope.invalid).toBe(true);
    expect(db.breedingFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ adults: { some: { animal: { currentCageId: { in: [] } } } } }),
    }));
    expect(db.animalCount).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ currentCageId: { in: [] } }),
    }));
  });

  it("requires an active current actor with forecast capability", async () => {
    db.userFindUnique.mockResolvedValue({ active: false, authzVersion: 3, role: "facility_admin" });
    const view = await getForecastWorkspaceView(actor);

    expect(view.scope.invalid).toBe(true);
    expect(view.scope.options.labs).toEqual([]);
    expect(db.labFindMany).not.toHaveBeenCalled();
  });
});
