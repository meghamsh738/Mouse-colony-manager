import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  });

  return {
    transaction: vi.fn(),
    labMembership: model(),
    ruleConfig: model(),
    animal: model(),
    cage: model(),
    room: model(),
    rack: model(),
    project: model(),
    user: model(),
    sampleRecord: model(),
    cryostorageRecord: model(),
    experiment: model(),
    experimentAssignment: model(),
    strain: model(),
    allele: model(),
    auditLog: model(),
    cageMovement: model(),
    animalMovement: model(),
    animalLabTransfer: model(),
  };
});

vi.mock("@/lib/prisma", () => {
  const prisma = {
    $transaction: mocks.transaction,
    labMembership: mocks.labMembership,
    ruleConfig: mocks.ruleConfig,
    animal: mocks.animal,
    cage: mocks.cage,
    room: mocks.room,
    rack: mocks.rack,
    project: mocks.project,
    user: mocks.user,
    sampleRecord: mocks.sampleRecord,
    cryostorageRecord: mocks.cryostorageRecord,
    experiment: mocks.experiment,
    experimentAssignment: mocks.experimentAssignment,
    strain: mocks.strain,
    allele: mocks.allele,
    auditLog: mocks.auditLog,
    cageMovement: mocks.cageMovement,
    animalMovement: mocks.animalMovement,
    animalLabTransfer: mocks.animalLabTransfer,
  };

  mocks.transaction.mockImplementation(async (operation: unknown) => {
    if (Array.isArray(operation)) {
      return Promise.all(operation);
    }

    return (operation as (tx: typeof prisma) => unknown)(prisma);
  });

  return { prisma };
});

import {
  createAnimalRecord,
  createSampleRecord,
  demoteReservedExperimentAssignments,
  importGenotypeCsvBatch,
  moveAnimalToCage,
  moveCageLocation,
  promotePlannedExperimentAssignments,
  updateCryostorageRecord,
  updateAnimalLifecycleStatus,
  updatePlannedExperimentAssignment,
  updateProjectRecord,
  updateSampleRecord,
} from "@/lib/colony-write";

// Session resolution maps a non-viewer lab membership to this legacy write-layer role.
const managerInLabA = { id: "user-two-labs", role: "animal_staff" as const, activeLabId: "lab-a" };
const viewerInLabB = { id: "user-two-labs", role: "read_only" as const, activeLabId: "lab-b" };

const foreignCage = {
  id: "cage-b",
  barcode: "B-CAGE-1",
  labId: "lab-b",
  roomId: "room-b",
  rackId: "rack-b",
  cageNumber: "1",
  active: true,
  status: "active",
  room: { roomNumber: "B1" },
  rack: { rackNumber: "B-R1" },
};

function expectNoScientificWrite() {
  expect(mocks.sampleRecord.create).not.toHaveBeenCalled();
  expect(mocks.sampleRecord.update).not.toHaveBeenCalled();
  expect(mocks.cryostorageRecord.update).not.toHaveBeenCalled();
  expect(mocks.project.update).not.toHaveBeenCalled();
  expect(mocks.experimentAssignment.update).not.toHaveBeenCalled();
  expect(mocks.cage.update).not.toHaveBeenCalled();
  expect(mocks.cageMovement.create).not.toHaveBeenCalled();
  expect(mocks.animal.update).not.toHaveBeenCalled();
  expect(mocks.animalMovement.create).not.toHaveBeenCalled();
  expect(mocks.auditLog.create).not.toHaveBeenCalled();
}

describe("lab write isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const model of [
      mocks.animal,
      mocks.cage,
      mocks.room,
      mocks.rack,
      mocks.project,
      mocks.user,
      mocks.sampleRecord,
      mocks.cryostorageRecord,
      mocks.experiment,
      mocks.experimentAssignment,
      mocks.strain,
      mocks.allele,
      mocks.ruleConfig,
    ]) {
      model.findUnique.mockReset().mockResolvedValue(undefined);
      model.findFirst.mockReset().mockResolvedValue(undefined);
      model.findMany.mockReset().mockResolvedValue([]);
    }
    mocks.transaction.mockImplementation(async (operation: unknown) => {
      if (Array.isArray(operation)) {
        return Promise.all(operation);
      }

      const tx = {
        labMembership: mocks.labMembership,
        ruleConfig: mocks.ruleConfig,
        animal: mocks.animal,
        cage: mocks.cage,
        sampleRecord: mocks.sampleRecord,
        cryostorageRecord: mocks.cryostorageRecord,
        project: mocks.project,
        experiment: mocks.experiment,
        experimentAssignment: mocks.experimentAssignment,
        auditLog: mocks.auditLog,
        cageMovement: mocks.cageMovement,
        animalMovement: mocks.animalMovement,
        animalLabTransfer: mocks.animalLabTransfer,
      };
      return (operation as (client: typeof tx) => unknown)(tx);
    });
    mocks.labMembership.findMany.mockResolvedValue([
      { labId: "lab-a", role: "manager" },
      { labId: "lab-b", role: "viewer" },
    ]);
  });

  it("does not let an active Lab A manager update a Lab B sample through a Lab A animal relation", async () => {
    mocks.sampleRecord.findUnique.mockResolvedValue({
      id: "sample-b",
      labId: "lab-b",
      sampleLabel: "B-SAMPLE-1",
      status: "stored",
      storageLocation: "B freezer",
      quantityLabel: null,
      notes: null,
      animal: { animalId: "A-ANIMAL-1", owningLabId: "lab-a" },
    });

    const result = await updateSampleRecord(
      { sampleId: "sample-b", expectedVersion: 1, notes: "foreign edit" },
      managerInLabA,
    );

    expect(result.ok).toBe(false);
    expectNoScientificWrite();
  });

  it("does not let an active Lab A manager assign a direct Lab B project ID to a Lab A sample", async () => {
    mocks.animal.findUnique.mockResolvedValue({
      id: "animal-a",
      animalId: "A-ANIMAL-1",
      labId: "lab-a",
      owningLabId: "lab-a",
      dob: new Date("2026-01-01T00:00:00.000Z"),
      status: "colony_holding",
    });
    mocks.project.findUnique.mockResolvedValue({
      id: "project-b",
      projectCode: "B-PROJECT",
      labId: "lab-b",
      owner: { labMemberships: [{ labId: "lab-a" }, { labId: "lab-b" }] },
    });

    const result = await createSampleRecord({
      animalId: "animal-a",
      projectId: "project-b",
      sampleLabel: "A-SAMPLE-NEW",
      sampleType: "DNA",
      status: "stored",
      collectedAt: "2026-02-01",
    }, managerInLabA);

    expect(result.ok).toBe(false);
    expectNoScientificWrite();
  });

  it("does not return a historical source-lab sample ID as an idempotent match after animal transfer", async () => {
    mocks.labMembership.findMany.mockResolvedValue([{ labId: "lab-b", role: "manager" }]);
    mocks.animal.findUnique.mockResolvedValue({
      id: "animal-transferred",
      animalId: "0007",
      owningLabId: "lab-b",
      dob: new Date("2026-01-01T00:00:00.000Z"),
    });
    mocks.sampleRecord.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate sample label", {
        code: "P2002",
        clientVersion: "6.19.3",
      }),
    );
    mocks.sampleRecord.findUnique.mockResolvedValue({
      id: "sample-from-lab-a",
      labId: "lab-a",
      animalId: "animal-transferred",
      animal: { animalId: "0007", owningLabId: "lab-b" },
    });

    const result = await createSampleRecord(
      {
        animalId: "animal-transferred",
        sampleLabel: "DNA-HISTORICAL-COLLISION",
        sampleType: "Tail DNA",
        status: "stored",
        collectedAt: "2026-02-01",
        storageLocation: "Freezer B / Box 1 / A01",
      },
      { id: "manager-b", role: "animal_staff", activeLabId: "lab-b" },
    );

    expect(result).toEqual({
      ok: false,
      message: "Sample label already exists. Use a unique label for this inventory record.",
    });
    expect(result).not.toHaveProperty("entityId");
  });

  it("accepts a concurrent duplicate only when every normalized biosample field is equivalent", async () => {
    mocks.animal.findUnique.mockResolvedValue({
      id: "animal-a",
      animalId: "0001",
      owningLabId: "lab-a",
      dob: new Date("2026-01-01T00:00:00.000Z"),
    });
    mocks.sampleRecord.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate sample label", {
        code: "P2002",
        clientVersion: "6.19.3",
      }),
    );
    mocks.sampleRecord.findUnique.mockResolvedValue({
      id: "sample-a",
      labId: "lab-a",
      animalId: "animal-a",
      projectId: null,
      experimentId: null,
      sampleLabel: "DNA-EQUIVALENT",
      sampleType: "Tail DNA",
      status: "stored",
      collectedAt: new Date("2026-02-01T00:00:00.000Z"),
      storageLocation: "Freezer A / Box 1 / A01",
      quantityLabel: "40 uL",
      notes: "Retained aliquot",
      animal: { animalId: "0001", owningLabId: "lab-a" },
    });

    const result = await createSampleRecord(
      {
        animalId: "animal-a",
        sampleLabel: " DNA-EQUIVALENT ",
        sampleType: " Tail DNA ",
        status: "stored",
        collectedAt: "2026-02-01",
        storageLocation: " Freezer A / Box 1 / A01 ",
        quantityLabel: " 40 uL ",
        notes: " Retained aliquot ",
      },
      managerInLabA,
    );

    expect(result).toMatchObject({ ok: true, entityId: "sample-a" });
  });

  it("preserves a terminal experiment link but rejects creating a new one through a forged update", async () => {
    mocks.sampleRecord.findUnique.mockResolvedValue({
      id: "sample-a",
      labId: "lab-a",
      sampleLabel: "DNA-A",
      projectId: "project-a",
      experimentId: null,
      status: "stored",
      storageLocation: "Freezer A",
      quantityLabel: "20 uL",
      notes: null,
      version: 1,
      animal: { animalId: "0001" },
    });
    mocks.experiment.findUnique.mockResolvedValue({
      id: "experiment-complete",
      labId: "lab-a",
      projectId: "project-a",
      status: "completed",
    });

    const result = await updateSampleRecord(
      {
        sampleId: "sample-a",
        expectedVersion: 1,
        experimentId: "experiment-complete",
        status: "stored",
      },
      managerInLabA,
    );

    expect(result).toEqual({
      ok: false,
      message: "Only planned or active experiments can receive a new biosample link.",
    });
    expect(mocks.sampleRecord.updateMany).not.toHaveBeenCalled();
  });

  it("does not create a Lab A cage animal with a Lab B project", async () => {
    mocks.animal.findUnique.mockResolvedValue(null);
    mocks.cage.findUnique.mockResolvedValue({
      id: "cage-a",
      labId: "lab-a",
      active: true,
      status: "active",
      barcode: "A-CAGE-1",
    });
    mocks.strain.findUnique.mockResolvedValue({ id: "strain-a" });
    mocks.project.findUnique.mockResolvedValue({ id: "project-b", projectCode: "B-PROJECT", labId: "lab-b" });

    const result = await createAnimalRecord({
      animalId: "A-ANIMAL-NEW",
      labId: "LAB-IDENTIFIER-NEW",
      sex: "female",
      dob: "2026-01-01",
      strainId: "strain-a",
      cageId: "cage-a",
      projectId: "project-b",
    }, managerInLabA);

    expect(result.ok).toBe(false);
    expectNoScientificWrite();
  });

  it("rejects direct Lab B cryostorage, project, and experiment-assignment IDs for an active Lab A manager", async () => {
    mocks.cryostorageRecord.findUnique.mockResolvedValue({
      id: "cryo-b",
      labId: "lab-b",
      sampleLabel: "B-CRYO-1",
      status: "stored",
      storageLocation: "B tank",
      quantityLabel: null,
      recoveryNotes: null,
      notes: null,
      strain: { name: "Strain B" },
    });
    mocks.project.findUnique.mockResolvedValue({
      id: "project-b",
      labId: "lab-b",
      projectCode: "B-PROJECT",
      title: "Lab B project",
      ownerId: "owner-b",
      notes: null,
    });
    mocks.experimentAssignment.findUnique.mockResolvedValue({
      id: "assignment-b",
      status: "planned",
      startDate: new Date("2026-03-01T00:00:00.000Z"),
      treatmentGroup: "Control",
      notes: null,
      experiment: { id: "experiment-b", experimentCode: "B-EXP", labId: "lab-b" },
      animal: { animalId: "B-ANIMAL-1", owningLabId: "lab-b" },
    });

    const results = await Promise.all([
      updateCryostorageRecord({ recordId: "cryo-b", notes: "foreign edit" }, managerInLabA),
      updateProjectRecord({ projectId: "project-b", title: "foreign edit" }, managerInLabA),
      updatePlannedExperimentAssignment({
        assignmentId: "assignment-b",
        startDate: "2026-03-02",
        treatmentGroup: "Treatment",
      }, managerInLabA),
    ]);

    expect(results.every((result) => !result.ok)).toBe(true);
    expectNoScientificWrite();
  });

  it("rejects direct Lab B cage and animal move IDs for an active Lab A manager", async () => {
    mocks.cage.findUnique
      .mockResolvedValueOnce(foreignCage)
      .mockResolvedValueOnce({ ...foreignCage, id: "cage-b2", barcode: "B-CAGE-2", cageNumber: "2" })
      .mockResolvedValueOnce({
        id: "cage-b2",
        barcode: "B-CAGE-2",
        labId: "lab-b",
        active: true,
        status: "active",
        capacityOverride: null,
        room: { facility: { maxCageOccupancy: 5 } },
        _count: { animals: 0 },
      });
    mocks.room.findUnique.mockResolvedValue({ id: "room-destination", roomNumber: "D1" });
    mocks.rack.findUnique.mockResolvedValue({
      id: "rack-destination",
      roomId: "room-destination",
      rackNumber: "D-R1",
      room: { roomNumber: "D1" },
    });
    mocks.animal.findUnique.mockResolvedValue({
      id: "animal-b",
      animalId: "B-ANIMAL-1",
      owningLabId: "lab-b",
      outcomeStatus: "alive",
      currentCageId: "cage-b",
      currentCage: foreignCage,
    });

    const cageResult = await moveCageLocation({
      cageId: "cage-b",
      roomId: "room-destination",
      rackId: "rack-destination",
      cageNumber: "9",
      movedAt: "2026-03-01",
      reason: "foreign move",
    }, managerInLabA);
    const animalResult = await moveAnimalToCage({
      animalId: "animal-b",
      toCageId: "cage-b2",
      movedAt: "2026-03-01",
      reason: "foreign move",
    }, managerInLabA);

    expect(cageResult.ok).toBe(false);
    expect(animalResult.ok).toBe(false);
    expectNoScientificWrite();
  });

  it("rejects a terminal lifecycle change for an animal outside the active lab", async () => {
    mocks.animal.findUnique.mockResolvedValue({
      id: "animal-b",
      animalId: "B-ANIMAL-1",
      labId: "B-0001",
      owningLabId: "lab-b",
      dob: new Date("2026-01-01T00:00:00.000Z"),
      status: "colony_holding",
      outcomeStatus: "alive",
      currentCageId: "cage-b",
      deathDate: null,
      deathReason: null,
      experimentalStatus: "available",
    });

    const result = await updateAnimalLifecycleStatus({
      animalId: "animal-b",
      targetStatus: "euthanized",
      happenedAt: "2026-03-01T12:00:00.000Z",
      reason: "Protocol endpoint",
    }, managerInLabA);

    expect(result).toEqual({ ok: false, message: "Animal not found." });
    expectNoScientificWrite();
  });

  it("limits genotype CSV animal lookup to the active lab's manageable records", async () => {
    mocks.animal.findMany.mockResolvedValue([]);
    mocks.allele.findMany.mockResolvedValue([]);

    await importGenotypeCsvBatch({
      csvText: [
        "subject_id,marker,call,status,source,assay,sample_date,result_date,result_text",
        "B-ANIMAL-1,Cre,+/-,confirmed,external,PCR,2026-02-01,2026-02-02,positive",
      ].join("\n"),
    }, managerInLabA);

    expect(mocks.animal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { owningLabId: { in: ["lab-a"] } },
    }));
    expectNoScientificWrite();
  });

  it("does not promote or demote assignments after the animal moved outside the experiment lab", async () => {
    const baseExperiment = {
      id: "experiment-a",
      labId: "lab-a",
      experimentCode: "EXP-A",
    };
    mocks.experiment.findUnique
      .mockResolvedValueOnce({
        ...baseExperiment,
        projectId: "project-a",
        project: { projectCode: "PROJECT-A" },
        status: "active",
        assignments: [{
          id: "assignment-a",
          animalId: "animal-b",
          startDate: new Date("2026-03-01"),
          treatmentGroup: "Treatment",
          notes: null,
          animal: {
            id: "animal-b",
            animalId: "B-ANIMAL-1",
            owningLabId: "lab-b",
            status: "colony_holding",
            outcomeStatus: "alive",
            experimentAssignments: [],
          },
        }],
      })
      .mockResolvedValueOnce({
        ...baseExperiment,
        assignments: [{
          id: "assignment-a",
          startDate: new Date("2026-03-01"),
          treatmentGroup: "Treatment",
          animal: {
            id: "animal-b",
            animalId: "B-ANIMAL-1",
            owningLabId: "lab-b",
            status: "reserved",
            outcomeStatus: "alive",
            experimentAssignments: [{ id: "assignment-a", experimentId: "experiment-a" }],
          },
        }],
      });

    const [promoteResult, demoteResult] = await Promise.all([
      promotePlannedExperimentAssignments({ experimentId: "experiment-a" }, managerInLabA),
      demoteReservedExperimentAssignments({ experimentId: "experiment-a" }, managerInLabA),
    ]);

    expect(promoteResult.ok).toBe(false);
    expect(demoteResult.ok).toBe(false);
    expect(mocks.experimentAssignment.update).not.toHaveBeenCalled();
    expect(mocks.animal.update).not.toHaveBeenCalled();
  });

  it("does not let the same lab user mutate while Lab B is active with viewer authority", async () => {
    const results = await Promise.all([
      updateSampleRecord({ sampleId: "sample-b", expectedVersion: 1, notes: "viewer edit" }, viewerInLabB),
      updateCryostorageRecord({ recordId: "cryo-b", notes: "viewer edit" }, viewerInLabB),
      updateProjectRecord({ projectId: "project-b", title: "viewer edit" }, viewerInLabB),
      updatePlannedExperimentAssignment({ assignmentId: "assignment-b", startDate: "2026-03-02" }, viewerInLabB),
      moveCageLocation({
        cageId: "cage-b",
        roomId: "room-b",
        rackId: "rack-b",
        cageNumber: "2",
        movedAt: "2026-03-01",
        reason: "viewer move",
      }, viewerInLabB),
      moveAnimalToCage({
        animalId: "animal-b",
        toCageId: "cage-b2",
        movedAt: "2026-03-01",
        reason: "viewer move",
      }, viewerInLabB),
    ]);

    expect(results.every((result) => !result.ok)).toBe(true);
    expectNoScientificWrite();
  });
});
