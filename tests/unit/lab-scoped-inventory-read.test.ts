import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActorLabAccess: vi.fn(),
  animalFindMany: vi.fn(),
  labFindMany: vi.fn(),
  projectFindMany: vi.fn(),
  experimentFindMany: vi.fn(),
  sampleFindMany: vi.fn(),
  strainFindMany: vi.fn(),
  cryostorageFindMany: vi.fn(),
}));

vi.mock("@/lib/lab-access", () => ({
  getActorLabAccess: mocks.getActorLabAccess,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (queries: unknown[]) => Promise.all(queries),
    animal: { findMany: mocks.animalFindMany },
    lab: { findMany: mocks.labFindMany },
    project: { findMany: mocks.projectFindMany },
    experiment: { findMany: mocks.experimentFindMany },
    sampleRecord: { findMany: mocks.sampleFindMany },
    strain: { findMany: mocks.strainFindMany },
    cryostorageRecord: { findMany: mocks.cryostorageFindMany },
  },
}));

import { getCryostorageInventoryView, getCryostoragePageOptions } from "@/lib/cryostorage-read";
import { getSampleInventoryView, getSamplePageOptions } from "@/lib/samples-read";

const labActor = { id: "user-lab-a", role: "researcher" as const, activeLabId: "lab-a" };
const globalActor = { id: "user-admin", role: "admin" as const, activeLabId: null };

describe("lab-scoped sample and cryostorage reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.animalFindMany.mockResolvedValue([]);
    mocks.labFindMany.mockResolvedValue([]);
    mocks.projectFindMany.mockResolvedValue([]);
    mocks.experimentFindMany.mockResolvedValue([]);
    mocks.sampleFindMany.mockResolvedValue([]);
    mocks.strainFindMany.mockResolvedValue([]);
    mocks.cryostorageFindMany.mockResolvedValue([]);
    mocks.getActorLabAccess.mockImplementation(async (actor: typeof labActor | typeof globalActor) => ({
      canViewAll: actor.role === "admin",
      memberLabIds: actor.role === "admin" ? [] : ["lab-a"],
      manageableLabIds: actor.role === "admin" ? [] : ["lab-a"],
      membershipByLabId: new Map(),
    }));
  });

  it("constrains sample records and animal/project options to the active lab", async () => {
    await Promise.all([getSampleInventoryView(labActor), getSamplePageOptions(labActor)]);

    expect(mocks.getActorLabAccess).toHaveBeenCalledWith(labActor);
    expect(mocks.sampleFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { labId: { in: ["lab-a"] } } }));
    expect(mocks.animalFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { owningLabId: { in: ["lab-a"] } } }));
    expect(mocks.projectFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { labId: { in: ["lab-a"] } } }));
    expect(mocks.experimentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ labId: { in: ["lab-a"] } }),
    }));
  });

  it("keeps terminal experiments available for existing links but excludes them from new biosample intake", async () => {
    mocks.experimentFindMany.mockResolvedValue([
      { id: "experiment-active", experimentCode: "EXP-A", title: "Active", projectId: "project-a", status: "active" },
      { id: "experiment-complete", experimentCode: "EXP-C", title: "Complete", projectId: "project-a", status: "completed" },
    ]);

    const options = await getSamplePageOptions(labActor);

    expect(options.experimentOptions.map((option) => option.id)).toEqual(["experiment-active", "experiment-complete"]);
    expect(options.activeExperimentOptions.map((option) => option.id)).toEqual(["experiment-active"]);
  });

  it("retains a source lab's historical sample after the linked animal transfers", async () => {
    mocks.sampleFindMany.mockResolvedValue([{
      id: "sample-1",
      labId: "lab-a",
      sampleLabel: "S-1",
      sampleType: "DNA",
      status: "stored",
      collectedAt: new Date("2026-01-01T00:00:00.000Z"),
      storageLocation: null,
      quantityLabel: null,
      notes: null,
      animal: { id: "animal-1", animalId: "A-1", owningLabId: "foreign-lab" },
      project: null,
    }]);

    const result = await getSampleInventoryView(labActor);

    expect(result).toEqual([
      expect.objectContaining({
        id: "sample-1",
        labId: "lab-a",
        animalId: "animal-1",
        animalCode: "A-1",
      }),
    ]);
  });

  it("filters inventory records whose optional project belongs to a different lab", async () => {
    mocks.sampleFindMany.mockResolvedValue([{
      id: "sample-1", labId: "lab-a", sampleLabel: "S-1", sampleType: "DNA", status: "stored",
      collectedAt: new Date("2026-01-01T00:00:00.000Z"), storageLocation: null, quantityLabel: null, notes: null,
      animal: { id: "animal-1", animalId: "A-1", owningLabId: "lab-a" },
      project: { projectCode: "FOREIGN", labId: "lab-b" },
    }]);
    mocks.cryostorageFindMany.mockResolvedValue([{
      id: "cryo-1", labId: "lab-a", sampleLabel: "C-1", materialType: "embryo", status: "stored",
      storedAt: new Date("2026-01-01T00:00:00.000Z"), storageLocation: null, quantityLabel: null,
      recoveryNotes: null, notes: null, strain: { id: "strain-1", name: "C57BL/6J" },
      project: { projectCode: "FOREIGN", labId: "lab-b" },
    }]);

    expect(await getSampleInventoryView(labActor)).toEqual([]);
    expect(await getCryostorageInventoryView(labActor)).toEqual([]);
  });

  it("filters a same-lab sample linked to an experiment owned by another lab", async () => {
    mocks.sampleFindMany.mockResolvedValue([{
      id: "sample-foreign-experiment",
      labId: "lab-a",
      sampleLabel: "S-FOREIGN-EXP",
      sampleType: "DNA",
      status: "stored",
      collectedAt: new Date("2026-01-01T00:00:00.000Z"),
      storageLocation: null,
      quantityLabel: null,
      notes: null,
      version: 1,
      animal: { id: "animal-1", animalId: "A-1", labId: "LAB-A-1" },
      project: null,
      experiment: { id: "experiment-b", experimentCode: "EXP-FOREIGN", labId: "lab-b" },
    }]);

    expect(await getSampleInventoryView(labActor)).toEqual([]);
  });

  it("constrains cryostorage records and project options to the active lab", async () => {
    await Promise.all([getCryostorageInventoryView(labActor), getCryostoragePageOptions(labActor)]);

    expect(mocks.cryostorageFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { labId: { in: ["lab-a"] } } }));
    expect(mocks.labFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true, id: { in: ["lab-a"] } },
    }));
    expect(mocks.projectFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { labId: { in: ["lab-a"] } } }));
  });

  it("leaves list and option queries unscoped for global roles", async () => {
    await Promise.all([
      getSampleInventoryView(globalActor),
      getSamplePageOptions(globalActor),
      getCryostorageInventoryView(globalActor),
      getCryostoragePageOptions(globalActor),
    ]);

    expect(mocks.sampleFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    expect(mocks.cryostorageFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    expect(mocks.animalFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    expect(mocks.labFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true } }));
    expect(mocks.projectFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
