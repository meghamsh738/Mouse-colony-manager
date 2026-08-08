import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActorLabAccess: vi.fn(),
  ruleFindMany: vi.fn(),
  animalFindMany: vi.fn(),
  animalFindUnique: vi.fn(),
  alertFindMany: vi.fn(),
  experimentFindMany: vi.fn(),
  experimentAssignmentCount: vi.fn(),
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
    animal: { findMany: mocks.animalFindMany, findUnique: mocks.animalFindUnique },
    alert: { findMany: mocks.alertFindMany },
    experiment: { findMany: mocks.experimentFindMany },
    experimentAssignment: { count: mocks.experimentAssignmentCount },
    allele: { findMany: mocks.alleleFindMany },
    project: { findMany: mocks.projectFindMany },
  },
}));

import { getAnimalDetailView, getAnimalListView } from "@/lib/animals-read";

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
    mocks.animalFindMany.mockResolvedValue([transferredAnimal]);
    mocks.animalFindUnique.mockResolvedValue(transferredAnimal);
    mocks.alertFindMany.mockResolvedValue([sourceAlert]);
    mocks.experimentFindMany.mockResolvedValue([]);
    mocks.experimentAssignmentCount.mockResolvedValue(0);
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
    const query = mocks.animalFindUnique.mock.calls[0]?.[0];

    expect(query.include.healthNotes.where.labId).toEqual({ in: ["lab-b"] });
    expect(query.include.genotypingRecords.where).toEqual({ labId: { in: ["lab-b"] } });
    expect(detail?.notes).toEqual([]);
    expect(detail?.genotypingRecords).toEqual([]);
    expect(detail?.alerts.map((alert) => alert.message).join(" ")).not.toContain("SOURCE LAB PRIVATE");
  });
});
