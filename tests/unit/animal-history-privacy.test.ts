import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActorLabAccess: vi.fn(),
  ruleFindMany: vi.fn(),
  animalCount: vi.fn(),
  animalFindMany: vi.fn(),
  animalFindFirst: vi.fn(),
  alertFindMany: vi.fn(),
  experimentFindMany: vi.fn(),
  experimentAssignmentCount: vi.fn(),
  healthNoteFindFirst: vi.fn(),
  genotypingRecordFindFirst: vi.fn(),
  alleleFindMany: vi.fn(),
  projectFindMany: vi.fn(),
}));

vi.mock("@/lib/lab-access", () => ({
  getActorLabAccess: mocks.getActorLabAccess,
  getActorReadLabAccess: mocks.getActorLabAccess,
  canViewLab: (access: { canViewAll: boolean; memberLabIds: string[] }, labId?: string | null) =>
    access.canViewAll || Boolean(labId && access.memberLabIds.includes(labId)),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ruleConfig: { findMany: mocks.ruleFindMany },
    animal: { count: mocks.animalCount, findMany: mocks.animalFindMany, findFirst: mocks.animalFindFirst },
    alert: { findMany: mocks.alertFindMany },
    experiment: { findMany: mocks.experimentFindMany },
    experimentAssignment: { count: mocks.experimentAssignmentCount },
    healthNote: { findFirst: mocks.healthNoteFindFirst },
    genotypingRecord: { findFirst: mocks.genotypingRecordFindFirst },
    allele: { findMany: mocks.alleleFindMany },
    project: { findMany: mocks.projectFindMany },
  },
}));

import {
  getAnimalDetailView,
  getAnimalInventoryPageView,
  getAnimalListView,
  normalizeAnimalInventoryQuery,
} from "@/lib/animals-read";

const actor = {
  id: "lab-b-user",
  role: "read_only" as const,
  activeLabId: "lab-b",
  canonicalRole: "lab_user" as const,
  capabilities: ["animals:read"] as const,
};

const sourceNote = {
  id: "source-note",
  labId: "lab-a",
  note: "SOURCE LAB PRIVATE NOTE",
  noteType: "veterinary_concern",
  severity: "warning",
  resolved: false,
  followupRequired: true,
  createdAt: new Date("2026-01-10T00:00:00.000Z"),
  attachments: [],
};

const sourceGenotype = {
  id: "source-genotype",
  labId: "lab-a",
  markerTested: "Private marker",
  sourceType: "PCR",
  assayType: "endpoint",
  sampleId: null,
  status: "pending",
  sampleDate: new Date("2026-01-01T00:00:00.000Z"),
  resultDate: new Date("2026-01-02T00:00:00.000Z"),
  resultText: "Private result",
  provider: null,
  confidence: null,
  finalCall: "Pending",
  attachments: [],
};

const transferredAnimal = {
  id: "animal-transferred",
  version: 1,
  animalId: "0001",
  labId: "LAB-0001",
  owningLabId: "lab-b",
  sex: "female",
  dob: new Date("2026-01-01T00:00:00.000Z"),
  status: "colony_holding",
  originType: "transfer",
  outcomeStatus: "alive",
  experimentalStatus: null,
  deathDate: null,
  deathReason: null,
  strain: { name: "C57BL/6J" },
  owningLab: { id: "lab-b", name: "Lab B", code: "LAB-B" },
  currentCage: null,
  sire: null,
  dam: null,
  alleles: [],
  projectAllocations: [],
  breedingAdults: [],
  experimentAssignments: [],
  healthNotes: [sourceNote],
  genotypingRecords: [sourceGenotype],
  sampleRecords: [],
  statusEvents: [],
};

const sourceAlert = {
  id: "source-alert",
  labId: "lab-a",
  entityType: "animal",
  entityId: transferredAnimal.id,
  alertType: "private_source_alert",
  severity: "warning",
  message: "SOURCE LAB PRIVATE ALERT",
  source: "manual",
  status: "open",
  generatedAt: new Date("2026-01-10T00:00:00.000Z"),
  resolvedAt: null,
};

describe("transferred animal history privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActorLabAccess.mockResolvedValue({
      canViewAll: false,
      memberLabIds: ["lab-b"],
      manageableLabIds: [],
      membershipByLabId: new Map(),
    });
    mocks.ruleFindMany.mockResolvedValue([]);
    mocks.animalCount.mockResolvedValue(1);
    mocks.animalFindMany.mockResolvedValue([transferredAnimal]);
    mocks.animalFindFirst.mockResolvedValue(transferredAnimal);
    mocks.alertFindMany.mockResolvedValue([sourceAlert]);
    mocks.experimentFindMany.mockResolvedValue([]);
    mocks.experimentAssignmentCount.mockResolvedValue(0);
    mocks.healthNoteFindFirst.mockResolvedValue(null);
    mocks.genotypingRecordFindFirst.mockResolvedValue(null);
    mocks.alleleFindMany.mockResolvedValue([]);
    mocks.projectFindMany.mockResolvedValue([]);
  });

  it("filters source-lab notes, genotype history, and alerts from the destination lab list", async () => {
    const rows = await getAnimalListView(actor);
    const query = mocks.animalFindMany.mock.calls[0]?.[0];

    expect(query.include.healthNotes.where).toEqual({ labId: { in: ["lab-b"] } });
    expect(query.include.genotypingRecords.where).toEqual({ labId: { in: ["lab-b"] } });
    expect(mocks.alertFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ labId: { in: ["lab-b"] } }),
    }));
    expect(rows[0]?.warnings.join(" ")).not.toContain("SOURCE LAB PRIVATE");
  });

  it("filters source-lab notes, genotype history, and alerts from destination lab detail", async () => {
    const detail = await getAnimalDetailView(transferredAnimal.id, actor);
    const query = mocks.animalFindFirst.mock.calls[0]?.[0];

    expect(query.where).toEqual({ id: transferredAnimal.id, owningLabId: { in: ["lab-b"] } });
    expect(query.include.healthNotes.where.labId).toEqual({ in: ["lab-b"] });
    expect(query.include.healthNotes.take).toBe(50);
    expect(query.include.healthNotes.select.attachments.where.labId).toEqual({ in: ["lab-b"] });
    expect(query.include.genotypingRecords.where).toEqual({ labId: { in: ["lab-b"] } });
    expect(query.include.genotypingRecords.take).toBe(50);
    expect(query.include.sampleRecords).toMatchObject({ where: { labId: { in: ["lab-b"] } }, take: 50 });
    expect(query.include.statusEvents.take).toBe(50);
    expect(query.include.experimentAssignments.take).toBe(50);
    expect(mocks.healthNoteFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ animalId: transferredAnimal.id, labId: { in: ["lab-b"] } }),
    }));
    expect(mocks.genotypingRecordFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ animalId: transferredAnimal.id, labId: { in: ["lab-b"] }, status: "pending" }),
    }));
    expect(detail?.notes).toEqual([]);
    expect(detail?.genotypingRecords).toEqual([]);
    expect(detail?.alerts.map((alert) => alert.message).join(" ")).not.toContain("SOURCE LAB PRIVATE");
  });

  it("fails closed in the root Prisma query before any follow-up detail reads", async () => {
    mocks.animalFindFirst.mockResolvedValue(null);

    await expect(getAnimalDetailView("foreign-animal", actor)).resolves.toBeNull();

    expect(mocks.animalFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "foreign-animal", owningLabId: { in: ["lab-b"] } },
    }));
    expect(mocks.alertFindMany).not.toHaveBeenCalled();
    expect(mocks.experimentFindMany).not.toHaveBeenCalled();
    expect(mocks.experimentAssignmentCount).not.toHaveBeenCalled();
  });

  it("normalizes and bounds inventory query parameters", () => {
    expect(normalizeAnimalInventoryQuery({
      availableOnly: "true",
      page: "0",
      pageSize: "999",
      search: ["  C57BL/6J  ", "ignored"],
      status: "reserved",
    })).toEqual({
      availableOnly: true,
      page: 1,
      pageSize: 100,
      search: "C57BL/6J",
      status: "reserved",
    });
  });

  it("paginates authorized whole-colony search before projecting animal rows", async () => {
    mocks.animalCount.mockResolvedValue(250);

    const page = await getAnimalInventoryPageView(actor, {
      page: "2",
      pageSize: "100",
      search: "C57BL",
      status: "breeding",
    });
    const countQuery = mocks.animalCount.mock.calls[0]?.[0];
    const listQuery = mocks.animalFindMany.mock.calls[0]?.[0];

    expect(page).toMatchObject({ page: 2, pageCount: 3, pageSize: 100, totalCount: 250 });
    expect(countQuery.where).toMatchObject({
      owningLabId: { in: ["lab-b"] },
      outcomeStatus: "alive",
      AND: [{ status: "breeding" }],
    });
    expect(countQuery.where.OR).toEqual(expect.arrayContaining([
      { animalId: { contains: "C57BL", mode: "insensitive" } },
      { strain: { name: { contains: "C57BL", mode: "insensitive" } } },
    ]));
    expect(listQuery).toMatchObject({
      orderBy: [{ animalId: "asc" }, { id: "asc" }],
      skip: 100,
      take: 100,
      where: countQuery.where,
    });
  });

  it("applies the complete experiment-availability boundary before pagination", async () => {
    mocks.alertFindMany
      .mockResolvedValueOnce([{ entityId: "animal-critical" }])
      .mockResolvedValueOnce([]);

    await getAnimalInventoryPageView(actor, { availableOnly: "true" });
    const where = mocks.animalCount.mock.calls[0]?.[0]?.where;

    expect(mocks.alertFindMany.mock.calls[0]?.[0]).toMatchObject({
      select: { entityId: true },
      where: {
        entityType: "animal",
        labId: { in: ["lab-b"] },
        severity: "critical",
        status: "open",
      },
    });
    expect(where.AND).toEqual([
      expect.objectContaining({
        alleles: { every: { callStatus: "confirmed" }, some: {} },
        experimentAssignments: { none: { status: "active" } },
        healthNotes: {
          none: {
            followupRequired: true,
            labId: { in: ["lab-b"] },
            resolved: false,
            severity: "critical",
          },
        },
        id: { notIn: ["animal-critical"] },
        status: "colony_holding",
      }),
    ]);
  });
});
