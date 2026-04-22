import { beforeAll, describe, expect, it } from "vitest";

import { getBreedingOverviewView, getBreedingSuggestionsView } from "@/lib/breeding-read";
import { getAnimalDetailView, getAnimalListView } from "@/lib/animals-read";
import { getCageDetailView, getCageListView, getScanCageViewByBarcode } from "@/lib/cages-read";
import {
  getColonyCompositionView,
  getDashboardAlertsView,
  getDashboardHighlightsView,
  getDashboardMetricsView,
} from "@/lib/dashboard-read";
import { buildCsvExport } from "@/lib/export-csv";
import {
  getExperimentCandidateView,
  getExperimentOverviewView,
  getExperimentPlannerView,
  parseExperimentPlannerFilters,
} from "@/lib/experiments-read";
import { getBreedingForecastView, getForecastSummaryView } from "@/lib/forecast-read";
  import {
    addCageHealthNote,
    createAnimalRecord,
    createBreedingSetup,
    createCryostorageRecord,
    createSampleRecord,
    importGenotypeCsvBatch,
    moveCageLocation,
    demoteReservedExperimentAssignments,
    planExperimentCohortAssignments,
    promotePlannedExperimentAssignments,
    updatePlannedExperimentAssignment,
    deletePlannedExperimentAssignment,
    recordAnimalGenotype,
    recordBreedingLitter,
    reserveAnimalForExperiment,
  updateRuleConfig,
  updateAnimalLifecycleStatus,
  weanLitterToCages,
} from "@/lib/colony-write";
import { getRecentAuditLogsView, getRuleSummaryView } from "@/lib/settings-read";
import { getCryostorageInventoryView } from "@/lib/cryostorage-read";
import { getSampleInventoryView } from "@/lib/samples-read";
import { seedDatabase } from "../../prisma/seed";

async function resetColonyState() {
  await seedDatabase();
}

describe("colony logic", () => {
  beforeAll(async () => {
    await resetColonyState();
  }, 120_000);

  it("builds genotype summaries from allele rows", async () => {
    const animal = await getAnimalDetailView("animal-003");

    expect(animal?.genotypeSummary).toContain("CreER +/-");
    expect(animal?.genotypeSummary).toContain("tdTomato +/-");
  });

  it("generates rule-driven alerts for overdue and conflicting states", async () => {
    const alerts = await getDashboardAlertsView();
    const alertTypes = alerts.map((alert) => alert.alertType);

    expect(alertTypes).toContain("breeder_too_old");
    expect(alertTypes).toContain("genotype_pending");
    expect(alertTypes).toContain("mixed_sex_holding");
    expect(alertTypes).toContain("weaning_due");
  });

  it("ranks breeding suggestions with the best pair first", async () => {
    const suggestions = await getBreedingSuggestionsView();

    expect(suggestions[0]?.priorityScore).toBeGreaterThan(suggestions[1]?.priorityScore ?? 0);
    expect(suggestions[0]?.expectedGenotypeProbability).toBeGreaterThan(0.2);
  });

  it("returns experiment candidates with eligibility scores", async () => {
    const candidates = await getExperimentCandidateView();

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.score).toBeGreaterThan(0);
  });

  it("builds a filtered experiment planner with cohort picks and exclusion reasons", async () => {
    const planner = await getExperimentPlannerView(
      parseExperimentPlannerFilters({
        desiredNumber: "3",
        sex: "either",
        minAgeDays: "35",
        maxAgeDays: "140",
        genotypeKeyword: "Cre",
        groupCount: "2",
        randomSeed: "seed-42",
        includeReserved: "false",
        allowOverlap: "false",
      }),
    );

    expect(planner.summary.totalReviewed).toBeGreaterThan(0);
    expect(planner.selected.length).toBeLessThanOrEqual(3);
    expect(planner.selected.length).toBeGreaterThan(0);
    expect(planner.candidates.every((candidate) => candidate.ageDays >= 35 && candidate.ageDays <= 140)).toBe(true);
    expect(planner.randomization.groups).toHaveLength(2);
    expect(planner.randomization.seed).toBe("seed-42");
    expect(planner.randomization.groups.reduce((sum, group) => sum + group.members.length, 0)).toBe(planner.selected.length);
    expect(planner.exclusions.some((item) => item.reason.length > 0 && item.count > 0)).toBe(true);
  });

  it("persists the current experiment planner cohort as planned assignments", async () => {
    const planner = await getExperimentPlannerView(
      parseExperimentPlannerFilters({
        desiredNumber: "2",
        sex: "male",
        minAgeDays: "35",
        maxAgeDays: "140",
        genotypeKeyword: "Cre",
        groupCount: "2",
        randomSeed: "plan-seed-99",
      }),
    );

    const result = await planExperimentCohortAssignments(
      {
        experimentId: "experiment-001",
        startDate: "2026-04-15",
        notes: "Unit-test cohort planning coverage.",
        selectedAnimals: planner.randomization.groups.flatMap((group) =>
          group.members.map((member) => ({
            animalId: member.animalId,
            treatmentGroup: group.name,
          })),
        ),
      },
      { id: "user-researcher", role: "researcher" },
    );

    expect(result.ok).toBe(true);
    const selectedAnimalIds = planner.randomization.groups.flatMap((group) => group.members.map((member) => member.animalId));

    const overview = await getExperimentOverviewView();
    const experiment = overview.find((item) => item.experimentCode === "EXP-TAM-041");
    const plannedAssignments =
      experiment?.assignments.filter((assignment) => selectedAnimalIds.includes(assignment.animalId)) ?? [];

    expect(plannedAssignments).toHaveLength(selectedAnimalIds.length);
    expect(plannedAssignments.every((assignment) => assignment.provenance?.action === "plan")).toBe(true);
    expect(plannedAssignments.every((assignment) => Boolean(assignment.provenance?.actorName))).toBe(true);
  });

  it("promotes planned cohort assignments into reserved experiment reservations", async () => {
    const planned = await planExperimentCohortAssignments(
      {
        experimentId: "experiment-002",
        startDate: "2026-04-15",
        notes: "Promotion coverage setup.",
        selectedAnimals: [
          { animalId: "CM-26011", treatmentGroup: "Group A" },
          { animalId: "CM-26013", treatmentGroup: "Group B" },
        ],
      },
      { id: "user-researcher", role: "researcher" },
    );

    expect(planned.ok).toBe(true);

    const promoted = await promotePlannedExperimentAssignments(
      {
        experimentId: "experiment-002",
      },
      { id: "user-researcher", role: "researcher" },
    );

    expect(promoted.ok).toBe(true);

    const overview = await getExperimentOverviewView();
    const experiment = overview.find((item) => item.experimentCode === "EXP-LPS-005");
    const reservedAssignments =
      experiment?.assignments.filter((assignment) => ["CM-26011", "CM-26013"].includes(assignment.animalId)) ?? [];

    expect(reservedAssignments).toHaveLength(2);
    expect(reservedAssignments.every((assignment) => assignment.provenance?.action === "promote_plan")).toBe(true);
  });

  it("updates and removes planned experiment assignments before promotion", async () => {
    const planned = await planExperimentCohortAssignments(
      {
        experimentId: "experiment-002",
        startDate: "2026-04-15",
        notes: "Editable cohort coverage setup.",
        selectedAnimals: [
          { animalId: "CM-26005", treatmentGroup: "Group A" },
          { animalId: "CM-26012", treatmentGroup: "Group B" },
        ],
      },
      { id: "user-researcher", role: "researcher" },
    );

    expect(planned.ok).toBe(true);

    const overview = await getExperimentOverviewView();
    const experiment = overview.find((item) => item.experimentCode === "EXP-LPS-005");
    const assignmentToUpdate = experiment?.assignments.find((assignment) => assignment.animalId === "CM-26005");
    const assignmentToDelete = experiment?.assignments.find((assignment) => assignment.animalId === "CM-26012");

    expect(assignmentToUpdate?.status).toBe("planned");
    expect(assignmentToDelete?.status).toBe("planned");

    const updated = await updatePlannedExperimentAssignment(
      {
        assignmentId: assignmentToUpdate!.id,
        startDate: "2026-04-18",
        treatmentGroup: "Group C",
        notes: "Updated before cohort promotion.",
      },
      { id: "user-researcher", role: "researcher" },
    );

    expect(updated.ok).toBe(true);

    const removed = await deletePlannedExperimentAssignment(
      {
        assignmentId: assignmentToDelete!.id,
      },
      { id: "user-researcher", role: "researcher" },
    );

    expect(removed.ok).toBe(true);

    const refreshedOverview = await getExperimentOverviewView();
    const refreshedExperiment = refreshedOverview.find((item) => item.experimentCode === "EXP-LPS-005");
    const refreshedUpdated = refreshedExperiment?.assignments.find((assignment) => assignment.id === assignmentToUpdate?.id);
    const refreshedDeleted = refreshedExperiment?.assignments.find((assignment) => assignment.id === assignmentToDelete?.id);

    expect(refreshedUpdated?.treatmentGroup).toBe("Group C");
    expect(refreshedUpdated?.startDate.slice(0, 10)).toBe("2026-04-18");
    expect(refreshedUpdated?.provenance?.action).toBe("update_plan");
    expect(refreshedDeleted).toBeUndefined();
  });

  it("rolls back promoted reserved cohort assignments to planned state", async () => {
    const planned = await planExperimentCohortAssignments(
      {
        experimentId: "experiment-002",
        startDate: "2026-04-15",
        notes: "Rollback cohort coverage setup.",
        selectedAnimals: [
          { animalId: "CM-26005", treatmentGroup: "Group A" },
          { animalId: "CM-26012", treatmentGroup: "Group B" },
        ],
      },
      { id: "user-researcher", role: "researcher" },
    );

    expect(planned.ok).toBe(true);

    const promoted = await promotePlannedExperimentAssignments(
      {
        experimentId: "experiment-002",
      },
      { id: "user-researcher", role: "researcher" },
    );

    expect(promoted.ok).toBe(true);

    const rolledBack = await demoteReservedExperimentAssignments(
      {
        experimentId: "experiment-002",
      },
      { id: "user-researcher", role: "researcher" },
    );

    expect(rolledBack.ok).toBe(true);

    const overview = await getExperimentOverviewView();
    const experiment = overview.find((item) => item.experimentCode === "EXP-LPS-005");
    const plannedAssignments =
      experiment?.assignments.filter((assignment) => ["CM-26005", "CM-26012"].includes(assignment.animalId)) ?? [];

    expect(plannedAssignments).toHaveLength(2);
    expect(plannedAssignments.every((assignment) => assignment.provenance?.action === "demote_reservation")).toBe(true);
  });

  it("builds a live colony forecast from active breedings and backup inventory", async () => {
    const [summary, rows] = await Promise.all([getForecastSummaryView(), getBreedingForecastView()]);

    expect(summary.activeBreedingForecasts).toBeGreaterThan(0);
    expect(summary.cryostorageBackups).toBeGreaterThan(0);
    expect(summary.projectedPups30Days).toBeGreaterThan(0);
    expect(rows[0]?.pairLabel).toContain("CM-");
    expect(rows[0]?.expectedUsablePups).toBeGreaterThan(0);
  });

  it("creates a new animal record and exposes it through alert and candidate helpers", async () => {
    const result = await createAnimalRecord(
      {
        animalId: "CM-TEST-101",
        labId: "MC-TEST-101",
        sex: "female",
        dob: "2026-03-15",
        strainId: "strain-creer-tdt",
        cageId: "cage-a101-003",
        projectId: "project-micro",
      },
      { id: "user-admin", role: "admin" },
    );

    expect(result.ok).toBe(true);
    const animals = await getAnimalListView();
    expect(animals.some((animal) => animal.animalId === "CM-TEST-101")).toBe(true);
  });

  it("records a sample inventory entry and exposes it in the inventory and animal timeline", async () => {
    const sampleLabel = "DNA-26004-B";
    const result = await createSampleRecord(
      {
        animalId: "animal-004",
        projectId: "project-neuro",
        sampleLabel,
        sampleType: "Tail DNA",
        status: "stored",
        collectedAt: "2026-04-09",
        storageLocation: "Freezer 2 / Box D / D04",
        quantityLabel: "1 x 40 uL",
        notes: "Verification aliquot for migration coverage.",
      },
      { id: "user-admin", role: "admin" },
    );

    expect(result.ok).toBe(true);

    const [inventory, animal] = await Promise.all([getSampleInventoryView(), getAnimalDetailView("animal-004")]);

    expect(inventory.some((record) => record.sampleLabel === sampleLabel && record.animalCode === "CM-26004")).toBe(true);
    expect(animal?.sampleRecords.some((record) => record.sampleLabel === sampleLabel)).toBe(true);
    expect(animal?.timeline.some((event) => event.description.includes(sampleLabel))).toBe(true);
  });

  it("records a cryostorage inventory entry and exposes it in the inventory view", async () => {
    const cryoLabel = "CRYO-WT-2026-04";
    const result = await createCryostorageRecord(
      {
        strainId: "strain-wt",
        projectId: "project-neuro",
        sampleLabel: cryoLabel,
        materialType: "Frozen embryos",
        status: "stored",
        storedAt: "2026-04-12",
        storageLocation: "LN2 Tank C / Cane 2 / Goblet 1",
        quantityLabel: "14 embryos",
        recoveryNotes: "Hold as the reserve wild-type restart line.",
        notes: "Verification record for cryostorage coverage.",
      },
      { id: "user-admin", role: "admin" },
    );

    expect(result.ok).toBe(true);

    const inventory = await getCryostorageInventoryView();
    expect(
      inventory.some(
        (record) =>
          record.sampleLabel === cryoLabel &&
          record.strainName === "C57BL/6J" &&
          record.projectCode === "PRJ-NEURO-07",
      ),
    ).toBe(true);
  });

  it("adds a cage health note that surfaces as a cage alert", async () => {
    const note = await addCageHealthNote(
      {
        cageId: "cage-a101-003",
        noteType: "routine_welfare",
        severity: "warning",
        note: "Wet bedding noted during welfare round.",
        followupRequired: true,
        actionTaken: "Flag for cage change.",
        attachment: {
          file: new File([Buffer.from("welfare attachment")], "welfare-note.pdf", { type: "application/pdf" }),
          label: "Wet bedding photo",
        },
      },
      { id: "user-staff", role: "animal_staff" },
    );

    expect(note.ok).toBe(true);
    const [cage, scan] = await Promise.all([
      getCageDetailView("cage-a101-003"),
      getScanCageViewByBarcode("CM-A101-003"),
    ]);
    expect(cage?.alerts.some((alert) => alert.message.includes("Wet bedding noted during welfare round."))).toBe(true);
    expect(cage?.notes[0]?.attachments[0]?.fileName).toBe("welfare-note.pdf");
    expect(scan?.notes[0]?.attachments[0]?.label).toBe("Wet bedding photo");
  });

  it("moves a cage, updates the live location, and records movement history", async () => {
    const moved = await moveCageLocation(
      {
        cageId: "cage-a102-004",
        roomId: "room-a101",
        rackId: "rack-a101-2",
        cageNumber: "006",
        movedAt: "2026-04-09",
        reason: "Relocated for imaging access verification.",
      },
      { id: "user-staff", role: "animal_staff" },
    );

    expect(moved.ok).toBe(true);

    const [detail, scanView, cageList] = await Promise.all([
      getCageDetailView("cage-a102-004"),
      getScanCageViewByBarcode("CM-A102-004"),
      getCageListView(),
    ]);

    expect(detail?.cageLabel).toBe("A101 / R2 / 006");
    expect(detail?.movementHistory[0]?.toLocation).toBe("A101 / R2 / 006");
    expect(detail?.movementHistory[0]?.reason).toContain("imaging access verification");
    expect(scanView?.cage.roomNumber).toBe("A101");
    expect(scanView?.cage.rackNumber).toBe("R2");
    expect(scanView?.cage.cageNumber).toBe("006");
    expect(cageList.find((cage) => cage.id === "cage-a102-004")?.roomNumber).toBe("A101");
  }, 15_000);

  it("blocks reservation for genotype-pending animals and allows eligible ones", async () => {
    const blocked = await reserveAnimalForExperiment(
      {
        animalId: "animal-005",
        experimentId: "experiment-002",
        startDate: "2026-04-08",
      },
      { id: "user-researcher", role: "researcher" },
    );

    expect(blocked.ok).toBe(false);

    const allowed = await reserveAnimalForExperiment(
      {
        animalId: "animal-004",
        experimentId: "experiment-002",
        startDate: "2026-04-08",
      },
      { id: "user-researcher", role: "researcher" },
    );

    expect(allowed.ok).toBe(true);
    const animal = await getAnimalDetailView("animal-004");
    expect(animal?.assignments.some((assignment) => assignment.experimentCode === "EXP-LPS-005")).toBe(true);
  });

  it("blocks underage breeder pairings without creating a setup", async () => {
    const beforeCount = (await getBreedingOverviewView()).length;
    const result = await createBreedingSetup(
      {
        sireId: "animal-004",
        damId: "animal-014",
        startDate: "2026-04-08",
        targetGenotype: "CreER ; tdTomato",
      },
      { id: "user-admin", role: "admin" },
    );

    expect(result.ok).toBe(false);
    const overview = await getBreedingOverviewView();
    expect(overview.length).toBe(beforeCount);
  });

  it("creates a breeding setup with admin override and updates breeder state", async () => {
    const result = await createBreedingSetup(
      {
        sireId: "animal-008",
        damId: "animal-009",
        startDate: "2026-04-08",
        targetGenotype: "CreER maintenance verification",
        notes: "Override duplicate breeder safeguard for migration test.",
        allowOverride: true,
      },
      { id: "user-admin", role: "admin" },
    );

    expect(result.ok).toBe(true);

    const overview = await getBreedingOverviewView();
    expect(overview.some((breeding) => breeding.targetGenotype === "CreER maintenance verification")).toBe(true);

    const animals = await getAnimalListView();
    expect(animals.find((animal) => animal.id === "animal-009")?.status).toBe("breeding");

    const cage = await getCageDetailView("cage-a102-005");
    expect(cage?.cage.status).toBe("breeding");
  });

  it("records a litter for an active breeding setup and exposes it on breeding and dashboard reads", async () => {
    const setup = await createBreedingSetup(
      {
        sireId: "animal-008",
        damId: "animal-009",
        startDate: "2026-04-08",
        targetGenotype: "Litter tracking verification",
        notes: "Create active setup before litter entry.",
        allowOverride: true,
      },
      { id: "user-admin", role: "admin" },
    );

    expect(setup.ok).toBe(true);
    if (!setup.ok || !setup.entityId) {
      throw new Error("Expected breeding setup creation to return an entity id.");
    }

    const litter = await recordBreedingLitter(
      {
        breedingSetupId: setup.entityId,
        birthDate: "2026-04-10",
        litterSizeBirth: 7,
        notes: "Observed during afternoon breeding room round.",
      },
      { id: "user-admin", role: "admin" },
    );

    expect(litter.ok).toBe(true);

    const overview = await getBreedingOverviewView();
    const breeding = overview.find((item) => item.id === setup.entityId);
    expect(breeding?.litter?.litterSizeBirth).toBe(7);
    expect(breeding?.litter?.notes).toBe("Observed during afternoon breeding room round.");

    const highlights = await getDashboardHighlightsView();
    expect(highlights.upcomingWean.some((item) => item.breedingId === setup.entityId)).toBe(true);
  });

  it("weans a recorded litter into holding cages and creates linked progeny", async () => {
    const setup = await createBreedingSetup(
      {
        sireId: "animal-008",
        damId: "animal-009",
        startDate: "2026-04-08",
        targetGenotype: "Weaning verification",
        notes: "Create setup before full litter lifecycle test.",
        allowOverride: true,
      },
      { id: "user-admin", role: "admin" },
    );

    expect(setup.ok).toBe(true);
    if (!setup.ok || !setup.entityId) {
      throw new Error("Expected breeding setup creation to return an entity id.");
    }

    const litter = await recordBreedingLitter(
      {
        breedingSetupId: setup.entityId,
        birthDate: "2026-04-10",
        litterSizeBirth: 6,
        notes: "Observed and ready for weaning assignment.",
      },
      { id: "user-admin", role: "admin" },
    );

    expect(litter.ok).toBe(true);
    if (!litter.ok || !litter.entityId) {
      throw new Error("Expected litter creation to return an entity id.");
    }

    const beforeAnimals = await getAnimalListView();
    const beforeMaleCage = await getCageDetailView("cage-a101-002");
    const beforeFemaleCage = await getCageDetailView("cage-a101-003");

    const result = await weanLitterToCages(
      {
        litterId: litter.entityId,
        weanDate: "2026-05-01",
        femaleCount: 2,
        maleCount: 3,
        femaleCageId: "cage-a101-003",
        maleCageId: "cage-a101-002",
        strainId: "strain-creer-tdt",
      },
      { id: "user-admin", role: "admin" },
    );

    expect(result.ok).toBe(true);

    const afterAnimals = await getAnimalListView();
    const afterMaleCage = await getCageDetailView("cage-a101-002");
    const afterFemaleCage = await getCageDetailView("cage-a101-003");
    const overview = await getBreedingOverviewView();
    const highlights = await getDashboardHighlightsView();
    const breeding = overview.find((item) => item.id === setup.entityId);

    expect(afterAnimals.length).toBe(beforeAnimals.length + 5);
    expect(afterAnimals.filter((animal) => animal.status === "weaned").length).toBeGreaterThan(0);
    expect(afterMaleCage?.occupants.length).toBe((beforeMaleCage?.occupants.length ?? 0) + 3);
    expect(afterFemaleCage?.occupants.length).toBe((beforeFemaleCage?.occupants.length ?? 0) + 2);
    expect(breeding?.litter?.litterSizeWean).toBe(5);
    expect(breeding?.litter?.progenyCount).toBe(5);
    expect(highlights.upcomingWean.some((item) => item.breedingId === setup.entityId)).toBe(false);
  }, 45_000);

  it("records a genotype result and updates the animal detail genotype views", async () => {
    const result = await recordAnimalGenotype(
      {
        animalId: "animal-009",
        alleleId: "allele-creer",
        zygosity: "+/-",
        status: "confirmed",
        sourceType: "manual PCR",
        assayType: "gel PCR",
        sampleDate: "2026-04-09",
        resultDate: "2026-04-09",
        resultText: "Expected CreER band present at the correct size.",
        confidence: "high",
        sampleId: "PCR-25009",
        attachment: {
          file: new File([Buffer.from("genotype attachment")], "genotype-report.pdf", { type: "application/pdf" }),
          label: "Vendor result PDF",
        },
      },
      { id: "user-admin", role: "admin" },
    );

    expect(result.ok).toBe(true);

    const detail = await getAnimalDetailView("animal-009");
    expect(detail?.genotypeSummary).toContain("CreER +/-");
    expect(detail?.effectiveAlleles.some((allele) => allele.alleleName === "CreER" && allele.callStatus === "confirmed")).toBe(
      true,
    );
    expect(detail?.genotypingRecords[0]?.markerTested).toBe("CreER");
    expect(detail?.genotypingRecords[0]?.resultText).toContain("Expected CreER band present");
    expect(detail?.genotypingRecords[0]?.attachments[0]?.label).toBe("Vendor result PDF");
    expect(detail?.genotypingRecords[0]?.attachments[0]?.fileName).toBe("genotype-report.pdf");
    expect(detail?.timeline.some((event) => event.description.includes("CreER +/-"))).toBe(true);
  });

  it("imports genotype rows from a vendor-style csv batch", async () => {
    const csv = [
      "subject_id,marker,call,status,source,assay,sample_date,result_date,result_text,provider,confidence,sample_id",
      "CM-25009,CreER,+/-,confirmed,manual PCR,gel PCR,2026-04-09,2026-04-09,Imported batch call for CM-25009,,high,PCR-25009-BATCH",
      "MC-2026-011,CreER,negative,confirmed,external vendor,Transnetyx panel,2026-04-09,2026-04-09,Imported vendor negative call,Transnetyx,high,TX-26011",
    ].join("\n");

    const result = await importGenotypeCsvBatch(
      {
        csvText: csv,
        fileName: "vendor-genotypes.csv",
      },
      { id: "user-admin", role: "admin" },
    );

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Processed 2 genotype rows");

    const [animal009, animal011] = await Promise.all([getAnimalDetailView("animal-009"), getAnimalDetailView("animal-011")]);

    expect(animal009?.genotypeSummary).toContain("CreER +/-");
    expect(animal009?.genotypingRecords.some((record) => record.resultText.includes("Imported batch call"))).toBe(true);
    expect(animal011?.genotypeSummary).toContain("CreER WT/WT");
    expect(animal011?.genotypingRecords.some((record) => record.resultText.includes("Imported vendor negative call"))).toBe(true);
  });

  it("removes a terminal animal from active views and allows later archival", async () => {
    const euthanized = await updateAnimalLifecycleStatus(
      {
        animalId: "animal-014",
        targetStatus: "euthanized",
        happenedAt: "2026-04-09",
        reason: "Terminal tissue collection completed for endpoint verification.",
      },
      { id: "user-staff", role: "animal_staff" },
    );

    expect(euthanized.ok).toBe(true);

    const activeAnimals = await getAnimalListView();
    const cage = await getCageDetailView("cage-a101-003");
    const euthanizedDetail = await getAnimalDetailView("animal-014");

    expect(activeAnimals.some((animal) => animal.id === "animal-014")).toBe(false);
    expect(cage?.occupants.some((animal) => animal.id === "animal-014")).toBe(false);
    expect(euthanizedDetail?.animal.status).toBe("euthanized");
    expect(euthanizedDetail?.animal.outcomeStatus).toBe("euthanized");
    expect(euthanizedDetail?.animal.deathReason).toContain("Terminal tissue collection");

    const archived = await updateAnimalLifecycleStatus(
      {
        animalId: "animal-014",
        targetStatus: "archived",
        happenedAt: "2026-04-10",
        reason: "Archived after terminal disposition review.",
      },
      { id: "user-admin", role: "admin" },
    );

    expect(archived.ok).toBe(true);

    const archivedDetail = await getAnimalDetailView("animal-014");
    expect(archivedDetail?.animal.status).toBe("archived");
    expect(archivedDetail?.animal.outcomeStatus).toBe("euthanized");
    expect(archivedDetail?.timeline.some((event) => event.label === "Archived")).toBe(true);
  }, 15_000);

  it("updates a rule threshold and applies the new value to downstream alerts", async () => {
    const updated = await updateRuleConfig(
      {
        ruleId: "rule-006",
        valueInput: "1",
        criticalBlock: true,
      },
      { id: "user-admin", role: "admin" },
    );

    expect(updated.ok).toBe(true);

    const [rules, cageDetail, auditLogs] = await Promise.all([
      getRuleSummaryView(),
      getCageDetailView("cage-a101-002"),
      getRecentAuditLogsView(),
    ]);

    expect(rules.find((rule) => rule.id === "rule-006")?.displayValue).toBe("1");
    expect(cageDetail?.alerts.some((alert) => alert.alertType === "cage_overcapacity")).toBe(true);
    expect(auditLogs[0]?.entityType).toBe("rule_config");
  }, 15_000);

  it("builds animal csv exports directly from Prisma data", async () => {
    const csv = await buildCsvExport("animals");

    expect(csv).toContain("animalId,labId,sex,age,strain,genotype,cage,status,projects,warnings");
    expect(csv).toContain("CM-26005");
    expect(csv).toContain("MC-2026-005");
  });

  it("filters animal csv exports using the current colony-table search state", async () => {
    const animals = await getAnimalListView();
    const target = animals.find((animal) => animal.animalId === "CM-26005");
    const otherAnimal = animals.find((animal) => animal.animalId !== "CM-26005");
    const csv = await buildCsvExport("animals", { search: "CM-26005" });

    expect(target).toBeDefined();
    expect(otherAnimal).toBeDefined();
    expect(csv?.split("\n")).toHaveLength(2);
    expect(csv).toContain(target?.animalId ?? "");
    expect(csv).not.toContain(otherAnimal?.animalId ?? "");
  });

  it("filters cage csv exports down to warning-bearing operational cages", async () => {
    const cages = await getCageListView();
    const warningCage = cages.find((cage) => cage.warningCount > 0);
    const quietCage = cages.find((cage) => cage.warningCount === 0);
    const csv = await buildCsvExport("cages", { warningsOnly: true });

    expect(warningCage).toBeDefined();
    expect(csv).toContain("cage,room,rack,barcode,status,occupants,sexComposition,strainSummary,warningCount");
    expect(csv).toContain(warningCage?.barcode ?? "");

    if (quietCage) {
      expect(csv).not.toContain(quietCage.barcode);
    }
  });

  it("builds cage list and detail views directly from Prisma data", async () => {
    const cages = await getCageListView();
    const detail = await getCageDetailView("cage-a101-003");

    expect(cages.some((cage) => cage.barcode === "CM-A101-003")).toBe(true);
    expect(detail?.cageLabel).toBe("A101 / R2 / 003");
    expect(detail?.occupants.some((animal) => animal.animalId === "CM-26003")).toBe(true);
    expect(detail?.occupants.length).toBeGreaterThan(0);
    expect(detail?.occupants[0]?.genotypeSummary.length).toBeGreaterThan(0);
  });

  it("resolves the mobile scan cage view directly from barcode", async () => {
    const scanView = await getScanCageViewByBarcode("CM-A101-003");

    expect(scanView?.cage.id).toBe("cage-a101-003");
    expect(scanView?.cage.roomNumber).toBe("A101");
    expect(scanView?.occupants.some((animal) => animal.animalId === "CM-26003")).toBe(true);
  });

  it("builds experiment overview and candidate reads directly from Prisma data", async () => {
    const overview = await getExperimentOverviewView();
    const candidates = await getExperimentCandidateView();

    expect(overview.some((experiment) => experiment.experimentCode === "EXP-LPS-005")).toBe(true);
    expect(overview.find((experiment) => experiment.experimentCode === "EXP-LPS-005")?.assignments.length).toBeGreaterThan(0);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.cageLabel.length).toBeGreaterThan(0);
  });

  it("builds breeding overview and suggestion reads directly from Prisma data", async () => {
    const overview = await getBreedingOverviewView();
    const suggestions = await getBreedingSuggestionsView();

    expect(overview.some((breeding) => breeding.id === "breeding-001")).toBe(true);
    expect(overview.find((breeding) => breeding.id === "breeding-001")?.adults.length).toBeGreaterThan(0);
    expect(overview.find((breeding) => breeding.id === "breeding-001")?.litter?.id).toBe("litter-001");
    expect(suggestions.length).toBeGreaterThan(1);
    expect(suggestions[0]?.priorityScore).toBeGreaterThan(suggestions[1]?.priorityScore ?? 0);
  });

  it("builds dashboard metrics and highlights directly from Prisma data", async () => {
    const [metrics, composition, highlights] = await Promise.all([
      getDashboardMetricsView(),
      getColonyCompositionView(),
      getDashboardHighlightsView(),
    ]);

    expect(metrics.activeAnimals).toBeGreaterThan(0);
    expect(metrics.openAlerts).toBeGreaterThan(0);
    expect(composition.transgenic).toBeGreaterThan(0);
    expect(highlights.upcomingWean.some((item) => item.litterId === "litter-001")).toBe(true);
    expect(highlights.alerts.length).toBeGreaterThan(0);
  });

  it("builds settings rules and audit reads directly from Prisma data", async () => {
    const [rules, auditLogs] = await Promise.all([getRuleSummaryView(), getRecentAuditLogsView()]);

    expect(rules.some((rule) => rule.label.includes("Breeder"))).toBe(true);
    expect(auditLogs.length).toBeGreaterThan(0);
    expect(auditLogs[0]?.timestamp.length).toBeGreaterThan(0);
  });
});
