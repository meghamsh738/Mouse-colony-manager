import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  experimentFindMany: vi.fn(),
  auditFindMany: vi.fn(),
  getActorLabAccess: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    experiment: { findMany: mocks.experimentFindMany },
    auditLog: { findMany: mocks.auditFindMany },
  },
}));

vi.mock("@/lib/lab-access", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/lab-access")>();
  return {
    ...original,
    getActorLabAccess: mocks.getActorLabAccess,
  };
});

import { getExperimentOverviewView } from "@/lib/experiments-read";

const operationalExperiment = {
  id: "experiment-1",
  labId: "lab-a",
  experimentCode: "EXP-001",
  title: "Operational study",
  status: "active",
  version: 4,
  plannedStartAt: null,
  plannedEndAt: null,
  operationalContact: "CMU desk",
  procedureSummary: "Daily observation",
  treatmentSummary: null,
  welfareRisks: "Monitor weight",
  scheduleNotes: null,
  operationalNotes: "Use room entry protocol",
  lab: { code: "LAB-A" },
  project: { id: "project-1", projectCode: "PROJECT-A" },
  owner: { name: "Lab owner", email: "owner@example.test" },
  assignments: [
    {
      id: "assignment-1",
      status: "active",
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: null,
      treatmentGroup: "Control",
      version: 2,
      animal: {
        id: "animal-1",
        animalId: "0001",
        sex: "female",
        strain: { name: "C57BL/6J" },
        alleles: [],
        currentCage: null,
      },
    },
  ],
};

describe("operational experiment projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActorLabAccess.mockResolvedValue({ canViewAll: true, memberLabIds: [] });
    mocks.experimentFindMany.mockResolvedValue([operationalExperiment]);
    mocks.auditFindMany.mockResolvedValue([]);
  });

  it("omits every private-capable key for CMU actors", async () => {
    const [experiment] = await getExperimentOverviewView({ id: "cmu-1", role: "colony_manager" });

    expect(experiment).toBeDefined();
    expect(experiment?.visibility).toBe("operational");
    expect(Object.hasOwn(experiment ?? {}, "researchNotes")).toBe(false);
    expect(Object.hasOwn(experiment ?? {}, "resultSummary")).toBe(false);
    expect(Object.hasOwn(experiment?.assignments[0] ?? {}, "notes")).toBe(false);
    expect(JSON.stringify(experiment)).not.toContain("researchNotes");
    expect(JSON.stringify(experiment)).not.toContain("resultSummary");
  });
});
