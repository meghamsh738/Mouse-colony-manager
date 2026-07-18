import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedDatabase } from "../../prisma/seed-database";
import { getAnimalDetailView, getAnimalPageOptions } from "@/lib/animals-read";
import { getPrintableCageLabelView } from "@/lib/cages-read";
import { allocateFacilityIdentifiers } from "@/lib/command-foundation";
import { prisma } from "@/lib/prisma";
import { getWorkbookNavigation, getWorkbookSheet, parseWorkbookState } from "@/lib/workbook-read";

const restrictedRecordId = "cryo-workbook-access-test";
const foreignExperimentId = "experiment-workbook-foreign-test";
const canonicalIds = {
  breeding: "breeding-workbook-canonical-test",
  breedingAdult: "breeding-adult-workbook-canonical-test",
  experiment: "experiment-workbook-canonical-test",
  assignment: "assignment-workbook-canonical-test",
  sample: "sample-workbook-canonical-test",
};
const transferredIds = {
  animal: "animal-workbook-transferred-test",
  animalCode: "CM-WORKBOOK-TRANSFERRED",
  labAnimalId: "WB-TRANSFERRED-001",
  breeding: "breeding-workbook-transferred-test",
  breedingAdult: "breeding-adult-workbook-transferred-test",
  litter: "litter-workbook-transferred-test",
  litterAnimal: "litter-animal-workbook-transferred-test",
  experiment: "experiment-workbook-transferred-test",
  assignment: "assignment-workbook-transferred-test",
};
const staffActor = { id: "user-staff", role: "animal_staff" as const, activeLabId: "lab-microglia" };
const cmuActor = {
  id: "user-colony-manager",
  role: "colony_manager" as const,
  canonicalRole: "cmu_staff" as const,
  capabilities: ["workbook:read", "animals:read"] as const,
};
let fixturesCreated = false;

describe("workbook access", () => {
  beforeAll(async () => {
    await seedDatabase();
    await prisma.cryostorageRecord.create({
      data: {
        id: restrictedRecordId,
        labId: "lab-neuroimmune",
        strainId: "strain-cas9",
        projectId: "project-neuro",
        sampleLabel: "CRYO-NEURO-PRIVATE-TEST",
        materialType: "Frozen sperm",
        status: "stored",
        storedAt: new Date("2026-04-01T09:00:00.000Z"),
        storageLocation: "Restricted test location",
        createdById: "user-manager",
      },
    });
    await prisma.breedingSetup.create({
      data: {
        id: canonicalIds.breeding,
        labId: "lab-microglia",
        startDate: new Date("2026-04-01T09:00:00.000Z"),
        status: "active",
        targetGenotype: "Canonical lab test",
        adults: {
          create: { id: canonicalIds.breedingAdult, animalId: "animal-010", role: "dam" },
        },
      },
    });
    await prisma.experiment.create({
      data: {
        id: canonicalIds.experiment,
        labId: "lab-microglia",
        experimentCode: "EXP-CANONICAL-LAB-TEST",
        projectId: "project-micro",
        title: "Canonical experiment lab test",
        ownerId: "user-researcher",
        status: "active",
        assignments: {
          create: {
            id: canonicalIds.assignment,
            animalId: "animal-010",
            status: "active",
            startDate: new Date("2026-04-01T09:00:00.000Z"),
          },
        },
      },
    });
    await prisma.experiment.create({
      data: {
        id: foreignExperimentId,
        labId: "lab-neuroimmune",
        experimentCode: "EXP-FOREIGN-LAB-TEST",
        projectId: "project-neuro",
        title: "Foreign experiment lab test",
        ownerId: "user-manager",
        status: "active",
      },
    });
    await prisma.$transaction(async (tx) => {
      const [facilityAnimalId] = await allocateFacilityIdentifiers(tx, "animal", 1);
      await tx.animal.create({
        data: {
          id: transferredIds.animal,
          facilityAnimalId,
          animalId: transferredIds.animalCode,
          labId: transferredIds.labAnimalId,
          owningLabId: "lab-microglia",
          sex: "male",
          dob: new Date("2025-11-01T00:00:00.000Z"),
          strainId: "strain-wt",
          status: "archived",
          originType: "internal breeding",
          experimentalStatus: "Completed",
          outcomeStatus: "euthanized",
          deathDate: new Date("2026-04-02T00:00:00.000Z"),
        },
      });
    });
    await prisma.breedingSetup.create({
      data: {
        id: transferredIds.breeding,
        labId: "lab-microglia",
        startDate: new Date("2026-01-01T09:00:00.000Z"),
        endDate: new Date("2026-03-01T09:00:00.000Z"),
        status: "retired",
        targetGenotype: "Historical transfer privacy test",
        adults: {
          create: { id: transferredIds.breedingAdult, animalId: transferredIds.animal, role: "sire" },
        },
        litters: {
          create: {
            id: transferredIds.litter,
            birthDate: new Date("2026-02-01T09:00:00.000Z"),
            litterSizeBirth: 1,
            litterSizeWean: 1,
            litterAnimals: {
              create: { id: transferredIds.litterAnimal, animalId: transferredIds.animal },
            },
          },
        },
      },
    });
    await prisma.experiment.create({
      data: {
        id: transferredIds.experiment,
        labId: "lab-microglia",
        experimentCode: "EXP-TRANSFERRED-PRIVACY-TEST",
        projectId: "project-micro",
        title: "Historical transfer privacy test",
        ownerId: "user-researcher",
        status: "completed",
        assignments: {
          create: {
            id: transferredIds.assignment,
            animalId: transferredIds.animal,
            status: "completed",
            startDate: new Date("2026-01-05T09:00:00.000Z"),
            endDate: new Date("2026-02-05T09:00:00.000Z"),
          },
        },
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('mcm.allow_destructive_seed', 'true', true)`;
      await tx.animal.update({
        where: { id: transferredIds.animal },
        data: { owningLabId: "lab-neuroimmune" },
      });
    });
    await prisma.sampleRecord.create({
      data: {
        id: canonicalIds.sample,
        labId: "lab-microglia",
        animalId: "animal-010",
        sampleLabel: "SAMPLE-CANONICAL-LAB-TEST",
        sampleType: "Tissue",
        status: "stored",
        collectedAt: new Date("2026-04-01T09:00:00.000Z"),
      },
    });
    fixturesCreated = true;
  });

  afterAll(async () => {
    if (!fixturesCreated) return;
    await prisma.sampleRecord.deleteMany({ where: { id: canonicalIds.sample } });
    await prisma.experiment.deleteMany({ where: { id: foreignExperimentId } });
    await prisma.experiment.deleteMany({ where: { id: transferredIds.experiment } });
    await prisma.breedingSetup.deleteMany({ where: { id: transferredIds.breeding } });
    await prisma.animal.deleteMany({ where: { id: transferredIds.animal } });
    await prisma.experiment.deleteMany({ where: { id: canonicalIds.experiment } });
    await prisma.breedingSetup.deleteMany({ where: { id: canonicalIds.breeding } });
    await prisma.cryostorageRecord.deleteMany({ where: { id: restrictedRecordId } });
  });

  it("does not expose another lab's cryostorage record to staff", async () => {
    const state = parseWorkbookState({ section: "cryostorage" });
    const staffSheet = await getWorkbookSheet(staffActor, state);
    const adminSheet = await getWorkbookSheet({ id: "user-admin", role: "admin" }, state);

    expect(staffSheet.kind).toBe("cryostorage");
    expect(adminSheet.kind).toBe("cryostorage");
    if (staffSheet.kind !== "cryostorage" || adminSheet.kind !== "cryostorage") return;

    expect(staffSheet.rows.some((row) => row.id === restrictedRecordId)).toBe(false);
    expect(adminSheet.rows.some((row) => row.id === restrictedRecordId)).toBe(true);
  });

  it("uses canonical lab ownership for workbook sheets and nested rows", async () => {
    const breeding = await getWorkbookSheet(staffActor, parseWorkbookState({ section: "breeding" }));
    const experiments = await getWorkbookSheet(staffActor, parseWorkbookState({ section: "experiments" }));
    const samples = await getWorkbookSheet(staffActor, parseWorkbookState({ section: "biosamples" }));

    expect(breeding.kind).toBe("breeding");
    expect(experiments.kind).toBe("experiments");
    expect(samples.kind).toBe("biosamples");
    if (breeding.kind !== "breeding" || experiments.kind !== "experiments" || samples.kind !== "biosamples") return;

    expect(breeding.rows.some((row) => row.id === canonicalIds.breeding)).toBe(true);
    expect(experiments.groups.some((group) =>
      group.experimentId === canonicalIds.experiment
      && group.assignments.some((assignment) => assignment.id === canonicalIds.assignment),
    )).toBe(true);
    expect(samples.rows.some((row) => row.id === canonicalIds.sample)).toBe(true);
  });

  it("keeps historical rows without exposing an animal's current state after a lab transfer", async () => {
    const state = parseWorkbookState({ history: "true" });
    const breeding = await getWorkbookSheet(staffActor, { ...state, section: "breeding" });
    const experiments = await getWorkbookSheet(staffActor, { ...state, section: "experiments" });

    expect(breeding.kind).toBe("breeding");
    expect(experiments.kind).toBe("experiments");
    if (breeding.kind !== "breeding" || experiments.kind !== "experiments") return;

    const setup = breeding.rows.find((row) => row.id === transferredIds.breeding);
    expect(setup).toBeDefined();
    expect(setup?.sire).toBeNull();
    expect(setup?.dam).toBeNull();
    expect(setup?.litters.flatMap((litter) => litter.progeny)).toEqual([]);

    const experimentGroups = experiments.groups.filter((group) => group.experimentId === transferredIds.experiment);
    expect(experimentGroups).toHaveLength(1);
    expect(experimentGroups[0]?.treatmentGroup).toBe("No assignments");
    expect(experimentGroups[0]?.assignments).toEqual([]);
    expect(JSON.stringify(experimentGroups)).not.toContain(transferredIds.animalCode);
  });

  it("scopes experiment child sheets and direct sheet IDs by Experiment.labId", async () => {
    const navigation = await getWorkbookNavigation(staffActor, parseWorkbookState({ section: "experiments" }));
    const inaccessibleDirectSheet = await getWorkbookSheet(staffActor, parseWorkbookState({
      section: "experiments",
      sheet: foreignExperimentId,
    }));

    expect(navigation.childSheets.some((sheet) => sheet.id === canonicalIds.experiment)).toBe(true);
    expect(navigation.childSheets.some((sheet) => sheet.id === foreignExperimentId)).toBe(false);
    expect(inaccessibleDirectSheet.kind).toBe("experiments");
    if (inaccessibleDirectSheet.kind === "experiments") expect(inaccessibleDirectSheet.groups).toEqual([]);
  });

  it("limits animal project and experiment options to the active lab", async () => {
    const options = await getAnimalPageOptions(staffActor);
    const detail = await getAnimalDetailView("animal-003", staffActor);

    expect(options.projectOptions.map((option) => option.id)).toContain("project-micro");
    expect(options.projectOptions.map((option) => option.id)).not.toContain("project-neuro");
    expect(detail?.projectOptions.map((option) => option.id)).toContain("project-micro");
    expect(detail?.projectOptions.map((option) => option.id)).not.toContain("project-neuro");
    expect(detail?.experimentOptions.every((option) => option.label.includes("EXP-NEURO") === false)).toBe(true);
  });

  it("redacts private experiment workbook and animal data from CMU", async () => {
    const navigation = await getWorkbookNavigation(cmuActor, parseWorkbookState({ section: "experiments" }));
    const experimentSheet = await getWorkbookSheet(cmuActor, parseWorkbookState({ section: "experiments" }));
    const overview = await getWorkbookSheet(cmuActor, parseWorkbookState({ section: "overview" }));
    const detail = await getAnimalDetailView("animal-003", cmuActor);

    expect(navigation.childSheets).toEqual([{ id: "all", label: "All" }]);
    expect(experimentSheet).toEqual({ kind: "experiments", groups: [] });
    expect(overview.kind).toBe("overview");
    if (overview.kind === "overview") {
      expect(overview.metrics.some((metric) => metric.label === "Active experiments")).toBe(false);
      expect(overview.activeWork.some((row) => row.type === "Experiment")).toBe(false);
    }
    expect(detail?.assignments).toEqual([]);
    expect(detail?.experimentOptions).toEqual([]);
    expect(detail?.timeline.some((entry) => entry.label.startsWith("Experiment "))).toBe(false);
  });

  it("does not expose biosample sheets or rows to CMU through workbook access", async () => {
    const navigation = await getWorkbookNavigation(cmuActor, parseWorkbookState({ section: "overview" }));

    expect(navigation.allowedSections).not.toContain("biosamples");
    await expect(getWorkbookSheet(cmuActor, parseWorkbookState({ section: "biosamples" }))).rejects.toThrow(
      "Biosample workbook access denied",
    );
  });

  it("filters printable labels by Cage.labId through the actor-aware cage read", async () => {
    const staffLabels = await getPrintableCageLabelView({}, staffActor);
    const globalLabels = await getPrintableCageLabelView({}, { id: "user-admin", role: "admin" });
    const accessibleCageIds = await prisma.cage.findMany({
      where: { labId: "lab-microglia" },
      select: { id: true },
    });
    const allowed = new Set(accessibleCageIds.map((cage) => cage.id));

    expect(staffLabels.labels.length).toBeGreaterThan(0);
    expect(staffLabels.labels.every((label) => allowed.has(label.id))).toBe(true);
    expect(globalLabels.total).toBeGreaterThan(staffLabels.total);
  });
});
