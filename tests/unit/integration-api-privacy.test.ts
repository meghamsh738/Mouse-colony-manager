import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAnimalListView: vi.fn(),
  animalFindMany: vi.fn(),
  assignmentFindMany: vi.fn(),
}));

vi.mock("@/lib/animals-read", () => ({
  getAnimalListView: mocks.getAnimalListView,
  getAnimalDetailView: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    animal: { findMany: mocks.animalFindMany },
    experimentAssignment: { findMany: mocks.assignmentFindMany },
  },
}));

import { getAnimalApiList } from "@/lib/integration-api";

const filters = {
  search: "",
  status: "all",
  sex: "all",
  strain: "",
  projectCode: "",
  availableOnly: false,
  warningsOnly: false,
  limit: 100,
};

const animal = {
  id: "animal-1",
  animalId: "0001",
  labId: "LAB-0001",
  owningLabId: "lab-a",
  owningLabName: "Lab A",
  sex: "female",
  ageDays: 90,
  ageLabel: "3 mo",
  strain: "C57BL/6J",
  genotypeSummary: "Not recorded",
  cageLabel: "Room 1 / R1 / 1000",
  status: "colony_holding",
  projectCodes: [],
  experimentSummary: "None",
  warnings: [],
  genotypeConfirmed: false,
  availableForExperiment: false,
};

describe("integration animal privacy projections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAnimalListView.mockResolvedValue([animal]);
    mocks.animalFindMany.mockResolvedValue([{ id: animal.id, owningLabId: "lab-a", projectAllocations: [] }]);
    mocks.assignmentFindMany.mockResolvedValue([]);
  });

  it("does not query or return private experiment codes for CMU actors", async () => {
    const actor = {
      id: "cmu-user",
      role: "colony_manager" as const,
      canonicalRole: "cmu_staff" as const,
      capabilities: ["animals:read"] as const,
    };

    const result = await getAnimalApiList(filters, actor);

    expect(mocks.assignmentFindMany).not.toHaveBeenCalled();
    expect(result.data[0]?.experimentSummary).toBe("None");
  });

  it("returns same-lab experiment codes only when the actor has full experiment access", async () => {
    mocks.assignmentFindMany.mockResolvedValue([
      {
        animalId: animal.id,
        animal: { owningLabId: "lab-a" },
        experiment: { labId: "lab-a", experimentCode: "EXP-ALLOWED" },
      },
      {
        animalId: animal.id,
        animal: { owningLabId: "lab-a" },
        experiment: { labId: "lab-b", experimentCode: "EXP-FOREIGN" },
      },
    ]);
    const actor = {
      id: "lab-user",
      role: "researcher" as const,
      activeLabId: "lab-a",
      canonicalRole: "lab_user" as const,
      capabilities: ["animals:read", "experiments:full"] as const,
    };

    const result = await getAnimalApiList(filters, actor);

    expect(mocks.assignmentFindMany).toHaveBeenCalledOnce();
    expect(result.data[0]?.experimentSummary).toBe("EXP-ALLOWED");
    expect(JSON.stringify(result.data)).not.toContain("EXP-FOREIGN");
  });
});
