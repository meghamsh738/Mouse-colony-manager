import { beforeAll, describe, expect, it } from "vitest";

import { evaluateBreedingRuleRisks, getBreedingOverviewView, getBreedingSuggestionsView } from "@/lib/breeding-read";
import { getAnimalDetailView, getAnimalListView } from "@/lib/animals-read";
import {
  getAnimalTransferWorkspaceView,
  getCageDetailView,
  getCageListView,
  getPrintableCageLabelView,
  getScanCageViewByBarcode,
} from "@/lib/cages-read";
import {
  getColonyCompositionView,
  getDashboardAlertsView,
  getDashboardHighlightsView,
  getDashboardMetricsView,
} from "@/lib/dashboard-read";
import { buildCsvExport } from "@/lib/export-csv";
import { getInvoiceDetailView } from "@/lib/billing-read";
import { finalizeInvoice, generateLabInvoice, voidInvoice } from "@/lib/billing-write";
import { getNotificationInboxView } from "@/lib/notifications-read";
import {
  createCageWithAssignments,
  receivePurchasedAnimals,
  weanLitterWithCagePlan,
} from "@/lib/cage-intake-write";
import { getCageIntakeOptionsView } from "@/lib/cage-intake-read";
import { executeCloseCageCommand } from "@/lib/cage-closure-write";
import { getActorCapabilities } from "@/lib/capabilities";
import { prepareWorkflowReview } from "@/lib/command-foundation";
import { prisma } from "@/lib/prisma";
import { SEED_REFERENCE_DATE } from "@/lib/seed-metadata";
import {
  addCageHealthNote,
  createAnimalRecord,
  createBreedingSetup,
  createCryostorageRecord,
  createSampleRecord,
  deletePlannedExperimentAssignment,
  demoteReservedExperimentAssignments,
  importGenotypeCsvBatch,
  moveAnimalToCage,
  moveCageLocation,
  planExperimentCohortAssignments,
  promotePlannedExperimentAssignments,
  recordAnimalGenotype,
  recordBreedingLitter,
  reserveAnimalForExperiment,
  transferCageToLab,
  updateCageDetails,
  updatePlannedExperimentAssignment,
  updateRuleConfig,
  updateAnimalLifecycleStatus,
  weanLitterToCages,
} from "@/lib/colony-write";
import {
  getExperimentCandidateView,
  getExperimentOverviewView,
  getExperimentPlannerView,
  parseExperimentPlannerFilters,
} from "@/lib/experiments-read";
import { getBreedingForecastView, getForecastSummaryView, getSurplusMinimizationView } from "@/lib/forecast-read";
import { getRecentAuditLogsView, getRuleSummaryView } from "@/lib/settings-read";
import { getCryostorageInventoryView } from "@/lib/cryostorage-read";
import { getSampleInventoryView } from "@/lib/samples-read";
import { seedDatabase } from "../../prisma/seed";

async function resetColonyState() {
  process.env.COLONY_REFERENCE_DATE = SEED_REFERENCE_DATE;
  await seedDatabase();
}

describe("colony logic", () => {
  const globalActor = { id: "user-admin", role: "admin" as const };
  const resolvedGlobalActor = {
    id: "user-admin",
    email: "admin@colony.local",
    name: "Facility Administrator",
    role: "admin" as const,
    databaseRole: "admin" as const,
    canonicalRole: "facility_admin" as const,
    authzVersion: 1,
    activeLabId: null,
    activeMembership: null,
    memberships: [],
    capabilities: [...getActorCapabilities({ canonicalRole: "facility_admin", activeMembership: null })],
  };
  const microStaffActor = {
    id: "user-staff",
    role: "animal_staff" as const,
    activeLabId: "lab-microglia",
  };
  beforeAll(async () => {
    await resetColonyState();
  }, 120_000);

  it("builds genotype summaries from allele rows", async () => {
    const animal = await getAnimalDetailView("animal-003", globalActor);

    expect(animal?.genotypeSummary).toContain("CreER +/-");
    expect(animal?.genotypeSummary).toContain("tdTomato +/-");
  });

  it("generates rule-driven alerts for overdue and conflicting states", async () => {
    const alerts = await getDashboardAlertsView(globalActor);
    const alertTypes = alerts.map((alert) => alert.alertType);

    expect(alertTypes).toContain("breeder_too_old");
    expect(alertTypes).toContain("genotype_pending");
    expect(alertTypes).toContain("mixed_sex_holding");
    expect(alertTypes).toContain("weaning_due");
  });

  it("ranks breeding suggestions with the best pair first", async () => {
    const suggestions = await getBreedingSuggestionsView(globalActor);

    expect(suggestions[0]?.priorityScore).toBeGreaterThan(suggestions[1]?.priorityScore ?? 0);
    expect(suggestions[0]?.expectedGenotypeProbability).toBeGreaterThan(0.2);
    expect(suggestions[0]?.expectedLitterSize).toBeGreaterThan(0);
    expect(suggestions[0]?.estimatedSurplusPups).toBeGreaterThanOrEqual(0);
    expect(suggestions[0]?.fertilitySummary).toContain("Sire:");
    expect(suggestions[0]?.lineFertilitySummary).toContain("Line fertility model");
    expect(suggestions.some((suggestion) => suggestion.ruleSeverity !== "ok")).toBe(true);
  });

  it("evaluates harmful and het-only breeding rule risks from allele metadata", () => {
    const risks = evaluateBreedingRuleRisks(
      [
        {
          zygosity: "+/-",
          allele: {
            name: "CreER",
            harmfulHomozygous: true,
            maintainAsHet: true,
            prohibitedPairings: ["CreER+/+ x CreER+/+"],
          },
        },
      ],
      [
        {
          zygosity: "+/-",
          allele: {
            name: "CreER",
            harmfulHomozygous: true,
            maintainAsHet: true,
            prohibitedPairings: ["CreER+/+ x CreER+/+"],
          },
        },
      ],
    );

    expect(risks.severity).toBe("critical");
    expect(risks.warnings).toContain("Harmful homozygous risk for CreER");
    expect(risks.warnings).toContain("CreER line is configured to maintain as heterozygous");
  });

  it("returns experiment candidates with eligibility scores", async () => {
    const candidates = await getExperimentCandidateView();

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.score).toBeGreaterThan(0);
  });

  it("builds a filtered experiment planner with cohort picks and exclusion reasons", async () => {
    const planner = await getExperimentPlannerView(
      microStaffActor,
      parseExperimentPlannerFilters({
        desiredNumber: "3",
        sex: "either",
        minAgeDays: "35",
        maxAgeDays: "140",
        genotypeKeyword: "Cre",
        groupCount: "2",
        randomSeed: "seed-42",
        maxSameCagePerGroup: "1",
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
    expect(planner.randomization.strategy).toContain("Balance by age band before assignment");
    expect(planner.randomization.strategy).toContain("Limit same-cage animals per treatment arm to 1");
    expect(planner.randomization.groups.reduce((sum, group) => sum + group.members.length, 0)).toBe(planner.selected.length);
    expect(planner.randomization.groups.every((group) => group.summary.averageAgeDays >= 0)).toBe(true);
    expect(planner.exclusions.some((item) => item.reason.length > 0 && item.count > 0)).toBe(true);
    expect(planner.exclusions.some((item) => item.exampleAnimalIds.length > 0)).toBe(true);
    expect(planner.summary.allocationWarnings).toBeGreaterThan(0);
    expect(planner.summary.multiProjectCandidates).toBe(0);
    expect(planner.candidates.some((candidate) => candidate.allocationRisk === "unallocated")).toBe(true);
  });

  it("persists the current experiment planner cohort as planned assignments", async () => {
    const planner = await getExperimentPlannerView(
      microStaffActor,
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
      microStaffActor,
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
      microStaffActor,
    );

    expect(planned.ok).toBe(true);

    const promoted = await promotePlannedExperimentAssignments(
      {
        experimentId: "experiment-002",
      },
      microStaffActor,
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
      microStaffActor,
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
      microStaffActor,
    );

    expect(updated.ok).toBe(true);

    const removed = await deletePlannedExperimentAssignment(
      {
        assignmentId: assignmentToDelete!.id,
      },
      microStaffActor,
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
      microStaffActor,
    );

    expect(planned.ok).toBe(true);

    const promoted = await promotePlannedExperimentAssignments(
      {
        experimentId: "experiment-002",
      },
      microStaffActor,
    );

    expect(promoted.ok).toBe(true);

    const rolledBack = await demoteReservedExperimentAssignments(
      {
        experimentId: "experiment-002",
      },
      microStaffActor,
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
    const [summary, rows, surplus, longRange] = await Promise.all([
      getForecastSummaryView(resolvedGlobalActor),
      getBreedingForecastView(resolvedGlobalActor),
      getSurplusMinimizationView(resolvedGlobalActor),
      getSurplusMinimizationView(resolvedGlobalActor, 90),
    ]);

    expect(summary.activeBreedingForecasts).toBeGreaterThan(0);
    expect(summary.cryostorageBackups).toBeGreaterThan(0);
    expect(summary.projectedPups30Days).toBeGreaterThan(0);
    expect(summary.pendingDemand45Days).toBeGreaterThanOrEqual(0);
    expect(summary.projectedSurplus45Days).toBeGreaterThanOrEqual(0);
    expect(summary.longRangeHorizonDays).toBe(90);
    expect(summary.pendingDemandLongRangeDays).toBeGreaterThanOrEqual(summary.pendingDemand45Days);
    expect(summary.projectedExperimentReadyLongRangeDays).toBeGreaterThanOrEqual(summary.projectedExperimentReady45Days);
    expect(rows[0]?.pairLabel).toContain("CM-");
    expect(rows[0]?.expectedUsablePups).toBeGreaterThan(0);
    expect(rows[0]?.expectedSurplusPups).toBeGreaterThanOrEqual(0);
    expect(rows[0]?.lineFertilitySummary).toContain("Line fertility model");
    expect(surplus.recommendations.length).toBeGreaterThan(0);
    expect(longRange.horizonDays).toBe(90);
    expect(longRange.demandAnimals).toBeGreaterThanOrEqual(surplus.demandAnimals);
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
    const animals = await getAnimalListView(globalActor);
    expect(animals.some((animal) => animal.animalId === "CM-TEST-101")).toBe(true);
  });

  it("creates a charged cage, moves animals atomically, and blocks assignments above its override", async () => {
    await resetColonyState();
    const result = await createCageWithAssignments(
      {
        cages: [
          {
            clientId: "holding-1",
            labId: "lab-microglia",
            roomId: "room-a101",
            rackId: "rack-a101-2",
            cageNumber: "090",
            capacityOverride: 2,
            status: "active",
            chargeCategoryId: "charge-standard",
            startDate: "2026-05-01",
          },
        ],
        assignments: [
          { subjectId: "animal-003", destination: { kind: "new", clientId: "holding-1" } },
          { subjectId: "animal-014", destination: { kind: "new", clientId: "holding-1" } },
        ],
        movedAt: "2026-05-01",
        reason: "Create a new holding group.",
      },
      { id: "user-admin", role: "admin" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.entityId) throw new Error("Expected a created cage.");
    const cage = await prisma.cage.findUnique({
      where: { id: result.entityId },
      include: { animals: { where: { outcomeStatus: "alive" } }, chargePeriods: true },
    });
    expect(cage?.barcode).toBe("CM-A101-R2-090");
    expect(cage?.animals).toHaveLength(2);
    expect(cage?.chargePeriods).toHaveLength(1);

    const blocked = await createAnimalRecord(
      {
        animalId: "CM-CAP-003",
        labId: "MC-CAP-003",
        sex: "female",
        dob: "2026-03-15",
        strainId: "strain-creer-tdt",
        cageId: result.entityId,
      },
      { id: "user-admin", role: "admin" },
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain("capacity");
  }, 45_000);

  it("rejects a timestamped cage start before immutable billing history is created", async () => {
    await resetColonyState();
    const result = await createCageWithAssignments(
      {
        cages: [
          {
            clientId: "fractional-charge-start",
            labId: "lab-microglia",
            roomId: "room-a101",
            rackId: "rack-a101-2",
            cageNumber: "095",
            status: "active",
            chargeCategoryId: "charge-standard",
            startDate: "2026-05-01T12:00:00.000Z",
          },
        ],
        assignments: [],
        movedAt: "2026-05-01",
        reason: "Must reject a fractional billing day.",
      },
      { id: "user-admin", role: "admin" },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("valid cage start date");
    expect(await prisma.cage.count({ where: { cageNumber: "095" } })).toBe(0);
  }, 45_000);

  it("receives purchased animals with provenance and an underfilled cage plan", async () => {
    await resetColonyState();
    const animals = Array.from({ length: 7 }, (_, index) => ({
      rowId: `purchase-${index + 1}`,
      sourceAnimalId: `VENDOR-${index + 1}`,
      sex: "female" as const,
      strainId: "strain-wt",
      dob: "2026-03-01",
      destination:
        index < 6
          ? ({ kind: "new", clientId: "purchase-a" } as const)
          : ({ kind: "new", clientId: "purchase-b" } as const),
    }));
    const result = await receivePurchasedAnimals(
      {
        labId: "lab-microglia",
        vendor: "Example Mouse Vendor",
        orderReference: "PO-2026-090",
        arrivalDate: "2026-05-04",
        disposition: "quarantine",
        animals,
        cages: [
          {
            clientId: "purchase-a",
            labId: "lab-microglia",
            roomId: "room-a102",
            rackId: "rack-a102-1",
            cageNumber: "091",
            status: "quarantine",
            startDate: "2026-05-04",
          },
          {
            clientId: "purchase-b",
            labId: "lab-microglia",
            roomId: "room-a102",
            rackId: "rack-a102-1",
            cageNumber: "092",
            status: "quarantine",
            startDate: "2026-05-04",
          },
        ],
      },
      { id: "user-admin", role: "admin" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.entityId) throw new Error("Expected an intake batch.");
    const batch = await prisma.animalIntakeBatch.findUnique({
      where: { id: result.entityId },
      include: { animals: true },
    });
    expect(batch?.animals).toHaveLength(7);
    expect(batch?.animals[0]?.sourceAnimalId).toMatch(/^VENDOR-/);
    expect(batch?.animals.every((animal) => animal.owningLabId === "lab-microglia")).toBe(true);
  }, 45_000);

  it("weans a same-sex litter across multiple newly charged cages", async () => {
    await resetColonyState();
    const setup = await createBreedingSetup(
      {
        sireId: "animal-001",
        damId: "animal-002",
        startDate: "2026-04-08",
        targetGenotype: "Capacity split verification",
        allowOverride: true,
      },
      { id: "user-admin", role: "admin" },
    );
    if (!setup.ok || !setup.entityId) throw new Error("Expected breeding setup.");
    const litter = await recordBreedingLitter(
      { breedingSetupId: setup.entityId, birthDate: "2026-04-10", litterSizeBirth: 7 },
      { id: "user-admin", role: "admin" },
    );
    if (!litter.ok || !litter.entityId) throw new Error("Expected litter.");

    const result = await weanLitterWithCagePlan(
      {
        litterId: litter.entityId,
        weanDate: "2026-05-01",
        strainId: "strain-creer-tdt",
        pups: Array.from({ length: 7 }, (_, index) => ({
          rowId: `female-${index + 1}`,
          sex: "female" as const,
          destination:
            index < 6
              ? ({ kind: "new", clientId: "wean-a" } as const)
              : ({ kind: "new", clientId: "wean-b" } as const),
        })),
        cages: [
          {
            clientId: "wean-a",
            labId: "lab-microglia",
            roomId: "room-a101",
            rackId: "rack-a101-2",
            cageNumber: "093",
            status: "active",
            startDate: "2026-05-01",
          },
          {
            clientId: "wean-b",
            labId: "lab-microglia",
            roomId: "room-a101",
            rackId: "rack-a101-2",
            cageNumber: "094",
            status: "active",
            startDate: "2026-05-01",
          },
        ],
      },
      { id: "user-admin", role: "admin" },
    );

    expect(result.ok).toBe(true);
    const linkedPups = await prisma.litterAnimal.count({ where: { litterId: litter.entityId } });
    const chargedCages = await prisma.cage.count({ where: { cageNumber: { in: ["093", "094"] }, chargePeriods: { some: {} } } });
    expect(linkedPups).toBe(7);
    expect(chargedCages).toBe(2);
  }, 45_000);

  it("records a sample inventory entry and exposes it in the inventory and animal timeline", async () => {
    const sampleLabel = "DNA-26004-B";
    const result = await createSampleRecord(
      {
        animalId: "animal-004",
        projectId: "project-micro",
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

    const [inventory, animal] = await Promise.all([
      getSampleInventoryView({ id: "user-admin", role: "admin" }),
      getAnimalDetailView("animal-004", { id: "user-admin", role: "admin" }),
    ]);

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

    const inventory = await getCryostorageInventoryView({ id: "user-admin", role: "admin" });
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

  it("surfaces only actionable health notes in dashboard follow-ups and notifications", async () => {
    const quietNoteText = "Routine quiet cage check for dashboard filtering coverage.";
    const warningNoteText = "Mild barbering warning for dashboard filtering coverage.";

    const quietNote = await addCageHealthNote(
      {
        cageId: "cage-a101-003",
        noteType: "routine_welfare",
        severity: "info",
        note: quietNoteText,
        followupRequired: false,
        actionTaken: "No follow-up needed.",
      },
      { id: "user-staff", role: "animal_staff" },
    );
    const warningNote = await addCageHealthNote(
      {
        cageId: "cage-a101-003",
        noteType: "grooming_issue",
        severity: "warning",
        note: warningNoteText,
        followupRequired: false,
        actionTaken: "Review on next room round.",
      },
      { id: "user-staff", role: "animal_staff" },
    );

    expect(quietNote.ok).toBe(true);
    expect(warningNote.ok).toBe(true);

    const [alerts, highlights, inbox] = await Promise.all([
      getDashboardAlertsView(globalActor),
      getDashboardHighlightsView(globalActor),
      getNotificationInboxView(globalActor),
    ]);

    expect(alerts.some((alert) => alert.message.includes(quietNoteText))).toBe(false);
    expect(highlights.staffFollowups.some((alert) => alert.message.includes(quietNoteText))).toBe(false);
    expect(inbox.notifications.some((notification) => notification.message.includes(quietNoteText))).toBe(false);
    expect(alerts.some((alert) => alert.message.includes(warningNoteText))).toBe(true);
    expect(highlights.staffFollowups.some((alert) => alert.message.includes(warningNoteText))).toBe(true);
    expect(inbox.notifications.some((notification) => notification.message.includes(warningNoteText))).toBe(true);
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

  it("moves a live animal between cages and records the transfer audit trail", async () => {
    const moved = await moveAnimalToCage(
      {
        animalId: "animal-014",
        toCageId: "cage-a102-004",
        movedAt: "2026-04-10",
        reason: "Moved for unit-test cage balancing coverage.",
      },
      { id: "user-staff", role: "animal_staff" },
    );

    expect(moved.ok).toBe(true);
    if (!moved.ok) {
      throw new Error("Expected animal transfer to succeed.");
    }

    const source = await getCageDetailView("cage-a101-003");
    const destination = await getCageDetailView("cage-a102-004");
    const animal = await prisma.animal.findUnique({
      where: { id: "animal-014" },
      select: {
        currentCageId: true,
      },
    });
    const movement = await prisma.animalMovement.findUnique({ where: { id: moved.movementId } });
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        entityId: "animal-014",
        action: "move_cage",
      },
      orderBy: { timestamp: "desc" },
    });

    expect(source?.occupants.some((occupant) => occupant.id === "animal-014")).toBe(false);
    expect(destination?.occupants.some((occupant) => occupant.id === "animal-014")).toBe(true);
    expect(destination?.alerts.some((alert) => alert.alertType === "mixed_sex_holding")).toBe(false);
    expect(animal?.currentCageId).toBe("cage-a102-004");
    expect(movement).toMatchObject({
      animalId: "animal-014",
      fromCageId: "cage-a101-003",
      toCageId: "cage-a102-004",
      movedById: "user-staff",
    });
    expect(auditLog?.entityType).toBe("animal");
    expect(auditLog?.newValue).toMatchObject({
      currentCageId: "cage-a102-004",
      cageBarcode: "CM-A102-004",
    });
  }, 15_000);

  it("rejects invalid or unauthorized animal cage transfers", async () => {
    const unauthorized = await moveAnimalToCage(
      {
        animalId: "animal-005",
        toCageId: "cage-a101-003",
        movedAt: "2026-04-10",
        reason: "Researcher should not transfer animals.",
      },
      { id: "user-researcher", role: "researcher" },
    );
    const missingAnimal = await moveAnimalToCage(
      {
        animalId: "missing-animal",
        toCageId: "cage-a101-003",
        movedAt: "2026-04-10",
        reason: "Missing animal coverage.",
      },
      { id: "user-staff", role: "animal_staff" },
    );
    const nonLive = await moveAnimalToCage(
      {
        animalId: "animal-010",
        toCageId: "cage-a101-003",
        movedAt: "2026-04-10",
        reason: "Archived animal coverage.",
      },
      { id: "user-staff", role: "animal_staff" },
    );
    const sameCage = await moveAnimalToCage(
      {
        animalId: "animal-005",
        toCageId: "cage-a101-002",
        movedAt: "2026-04-10",
        reason: "Same cage coverage.",
      },
      { id: "user-staff", role: "animal_staff" },
    );
    const invalidDate = await moveAnimalToCage(
      {
        animalId: "animal-005",
        toCageId: "cage-a101-003",
        movedAt: "not-a-date",
        reason: "Invalid date coverage.",
      },
      { id: "user-staff", role: "animal_staff" },
    );
    const emptyReason = await moveAnimalToCage(
      {
        animalId: "animal-005",
        toCageId: "cage-a101-003",
        movedAt: "2026-04-10",
        reason: " ",
      },
      { id: "user-staff", role: "animal_staff" },
    );

    await prisma.cage.update({
      where: { id: "cage-a102-004" },
      data: {
        active: false,
        status: "retired",
      },
    });

    try {
      const inactiveDestination = await moveAnimalToCage(
        {
          animalId: "animal-005",
          toCageId: "cage-a102-004",
          movedAt: "2026-04-10",
          reason: "Inactive destination coverage.",
        },
        { id: "user-staff", role: "animal_staff" },
      );

      expect(inactiveDestination.ok).toBe(false);
      expect(inactiveDestination.message).toContain("not an active operational cage");
    } finally {
      await prisma.cage.update({
        where: { id: "cage-a102-004" },
        data: {
          active: true,
          status: "experiment",
        },
      });
    }

    expect(unauthorized.ok).toBe(false);
    expect(missingAnimal.ok).toBe(false);
    expect(nonLive.ok).toBe(false);
    expect(sameCage.ok).toBe(false);
    expect(invalidDate.ok).toBe(false);
    expect(emptyReason.ok).toBe(false);
  }, 15_000);

  it("blocks reservation for genotype-pending animals and allows eligible ones", async () => {
    const blocked = await reserveAnimalForExperiment(
      {
        animalId: "animal-005",
        experimentId: "experiment-002",
        startDate: "2026-04-08",
      },
      microStaffActor,
    );

    expect(blocked.ok).toBe(false);

    const allowed = await reserveAnimalForExperiment(
      {
        animalId: "animal-004",
        experimentId: "experiment-002",
        startDate: "2026-04-08",
      },
      microStaffActor,
    );

    expect(allowed.ok).toBe(true);
    const animal = await getAnimalDetailView("animal-004", globalActor);
    expect(animal?.assignments.some((assignment) => assignment.experimentCode === "EXP-LPS-005")).toBe(true);
  });

  it("blocks underage breeder pairings without creating a setup", async () => {
    const beforeCount = (await getBreedingOverviewView(globalActor)).length;
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
    const overview = await getBreedingOverviewView(globalActor);
    expect(overview.length).toBe(beforeCount);
  });

  it("creates a breeding setup with admin override and updates breeder state", async () => {
    const result = await createBreedingSetup(
      {
        sireId: "animal-001",
        damId: "animal-002",
        startDate: "2026-04-08",
        targetGenotype: "CreER maintenance verification",
        notes: "Override duplicate breeder safeguard for migration test.",
        allowOverride: true,
      },
      { id: "user-admin", role: "admin" },
    );

    expect(result.ok).toBe(true);

    const overview = await getBreedingOverviewView(globalActor);
    expect(overview.some((breeding) => breeding.targetGenotype === "CreER maintenance verification")).toBe(true);

    const animals = await getAnimalListView(globalActor);
    expect(animals.find((animal) => animal.id === "animal-002")?.status).toBe("breeding");

    const cage = await getCageDetailView("cage-a101-001");
    expect(cage?.cage.status).toBe("breeding");
  });

  it("records a litter for an active breeding setup and exposes it on breeding and dashboard reads", async () => {
    const setup = await createBreedingSetup(
      {
        sireId: "animal-001",
        damId: "animal-002",
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

    const overview = await getBreedingOverviewView(globalActor);
    const breeding = overview.find((item) => item.id === setup.entityId);
    expect(breeding?.litter?.litterSizeBirth).toBe(7);
    expect(breeding?.litter?.notes).toBe("Observed during afternoon breeding room round.");

    const highlights = await getDashboardHighlightsView(globalActor);
    expect(highlights.upcomingWean.some((item) => item.breedingId === setup.entityId)).toBe(true);
  });

  it("weans a recorded litter into holding cages and creates linked progeny", async () => {
    const setup = await createBreedingSetup(
      {
        sireId: "animal-001",
        damId: "animal-002",
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

    const holdingCages = await createCageWithAssignments(
      {
        cages: [
          {
            clientId: "legacy-female",
            labId: "lab-microglia",
            roomId: "room-a101",
            rackId: "rack-a101-2",
            cageNumber: "095",
            status: "active",
            startDate: "2026-05-01",
          },
          {
            clientId: "legacy-male",
            labId: "lab-microglia",
            roomId: "room-a101",
            rackId: "rack-a101-2",
            cageNumber: "096",
            status: "active",
            startDate: "2026-05-01",
          },
        ],
        assignments: [],
        movedAt: "2026-05-01",
        reason: "Prepare weaning cages.",
      },
      { id: "user-admin", role: "admin" },
    );
    expect(holdingCages.ok).toBe(true);
    if (!holdingCages.ok || !holdingCages.createdCageIds) throw new Error("Expected holding cages.");
    const [femaleCageId, maleCageId] = holdingCages.createdCageIds;

    const beforeAnimals = await getAnimalListView(globalActor);
    const beforeMaleCage = await getCageDetailView(maleCageId);
    const beforeFemaleCage = await getCageDetailView(femaleCageId);

    const result = await weanLitterToCages(
      {
        litterId: litter.entityId,
        weanDate: "2026-05-01",
        femaleCount: 2,
        maleCount: 3,
        femaleCageId,
        maleCageId,
        strainId: "strain-creer-tdt",
      },
      { id: "user-admin", role: "admin" },
    );

    expect(result.ok).toBe(true);

    const afterAnimals = await getAnimalListView(globalActor);
    const afterMaleCage = await getCageDetailView(maleCageId);
    const afterFemaleCage = await getCageDetailView(femaleCageId);
    const overview = await getBreedingOverviewView(globalActor);
    const highlights = await getDashboardHighlightsView(globalActor);
    const breeding = overview.find((item) => item.id === setup.entityId);
    const createdPups = await prisma.animal.findMany({
      where: { originType: `litter ${litter.entityId}` },
      select: { owningLabId: true },
    });

    expect(afterAnimals.length).toBe(beforeAnimals.length + 5);
    expect(afterAnimals.filter((animal) => animal.status === "weaned").length).toBeGreaterThan(0);
    expect(afterMaleCage?.occupants.length).toBe((beforeMaleCage?.occupants.length ?? 0) + 3);
    expect(afterFemaleCage?.occupants.length).toBe((beforeFemaleCage?.occupants.length ?? 0) + 2);
    expect(breeding?.litter?.litterSizeWean).toBe(5);
    expect(breeding?.litter?.progenyCount).toBe(5);
    expect(createdPups).toHaveLength(5);
    expect(createdPups.every((animal) => animal.owningLabId === "lab-microglia")).toBe(true);
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

    const detail = await getAnimalDetailView("animal-009", globalActor);
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

    const [animal009, animal011] = await Promise.all([
      getAnimalDetailView("animal-009", globalActor),
      getAnimalDetailView("animal-011", globalActor),
    ]);

    expect(animal009?.genotypeSummary).toContain("CreER +/-");
    expect(animal009?.genotypingRecords.some((record) => record.resultText.includes("Imported batch call"))).toBe(true);
    expect(animal011?.genotypeSummary).toContain("CreER WT/WT");
    expect(animal011?.genotypingRecords.some((record) => record.resultText.includes("Imported vendor negative call"))).toBe(true);
  });

  it("removes a terminal animal from active views and allows later archival", async () => {
    await resetColonyState();
    const terminal = await updateAnimalLifecycleStatus(
      {
        animalId: "animal-014",
        targetStatus: "dead",
        happenedAt: "2026-04-09",
        reason: "Terminal tissue collection completed for endpoint verification.",
      },
      { id: "user-staff", role: "animal_staff" },
    );

    expect(terminal.ok).toBe(true);

    const activeAnimals = await getAnimalListView(globalActor);
    const cage = await getCageDetailView("cage-a101-003");
    const terminalDetail = await getAnimalDetailView("animal-014", globalActor);

    expect(activeAnimals.some((animal) => animal.id === "animal-014")).toBe(false);
    expect(cage?.occupants.some((animal) => animal.id === "animal-014")).toBe(false);
    expect(terminalDetail?.animal.status).toBe("dead");
    expect(terminalDetail?.animal.outcomeStatus).toBe("dead");
    expect(terminalDetail?.animal.deathReason).toContain("Terminal tissue collection");

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

    const archivedDetail = await getAnimalDetailView("animal-014", globalActor);
    expect(archivedDetail?.animal.status).toBe("archived");
    expect(archivedDetail?.animal.outcomeStatus).toBe("dead");
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
      getRecentAuditLogsView(resolvedGlobalActor),
    ]);

    expect(rules.find((rule) => rule.id === "rule-006")?.displayValue).toBe("1");
    expect(cageDetail?.alerts.some((alert) => alert.alertType === "cage_overcapacity")).toBe(true);
    expect(auditLogs[0]?.entityType).toBe("rule_config");
  }, 15_000);

  it("builds animal csv exports directly from Prisma data", async () => {
    const csv = await buildCsvExport("animals", { id: "user-admin", role: "admin" });

    expect(csv).toContain("animalId,labId,sex,age,strain,genotype,cage,status,projects,warnings");
    expect(csv).toContain("CM-26005");
    expect(csv).toContain("MC-2026-005");
  });

  it("filters animal csv exports using the current colony-table search state", async () => {
    const animals = await getAnimalListView(globalActor);
    const target = animals.find((animal) => animal.animalId === "CM-26005");
    const otherAnimal = animals.find((animal) => animal.animalId !== "CM-26005");
    const csv = await buildCsvExport(
      "animals",
      { id: "user-admin", role: "admin" },
      { search: "CM-26005" },
    );

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
    const csv = await buildCsvExport(
      "cages",
      { id: "user-admin", role: "admin" },
      { warningsOnly: true },
    );

    expect(warningCage).toBeDefined();
    expect(csv).toContain(
      "cage,room,rack,barcode,lab,status,chargeCategory,dailyRateCents,chargeState,occupants,animalIds,animalLabIds,sexComposition,strainSummary,projects,warningCount",
    );
    expect(csv).toContain(warningCage?.barcode ?? "");

    if (quietCage) {
      expect(csv).not.toContain(quietCage.barcode);
    }
  });

  it("builds printable cage labels from cage table filters", async () => {
    const singleLabel = await getPrintableCageLabelView({ search: "CM-A101-001" });
    const cageLabel = await getPrintableCageLabelView({ cageId: "cage-a101-003" });
    const breedingLabels = await getPrintableCageLabelView({ status: "breeding" });
    const warningLabels = await getPrintableCageLabelView({ warningsOnly: true });

    expect(singleLabel.labels).toHaveLength(1);
    expect(singleLabel.labels[0]).toMatchObject({
      barcode: "CM-A101-001",
      locationLabel: "A101 / R1 / 001",
    });
    expect(cageLabel.labels).toHaveLength(1);
    expect(cageLabel.labels[0]?.barcode).toBe("CM-A101-003");
    expect(breedingLabels.labels.every((label) => label.status === "breeding")).toBe(true);
    expect(warningLabels.labels.length).toBeGreaterThan(0);
    expect(warningLabels.labels.every((label) => label.warningCount > 0)).toBe(true);
  });

  it("builds animal transfer options with active destination cage context", async () => {
    await resetColonyState();
    const workspace = await getAnimalTransferWorkspaceView("cage-a101-003");

    expect(workspace.defaultDestinationCageId).toBe("cage-a101-003");
    expect(workspace.defaultDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(workspace.animalOptions.some((animal) => animal.animalId === "CM-26004")).toBe(true);
    expect(workspace.animalOptions.find((animal) => animal.animalId === "CM-26004")?.currentCageBarcode).toBe("CM-A101-002");
    expect(workspace.animalOptions.find((animal) => animal.animalId === "CM-26011")?.currentCageBarcode).toBe("CM-A101-002");
    expect(workspace.cageOptions.some((cage) => cage.id === "cage-a101-003" && cage.barcode === "CM-A101-003")).toBe(true);
    expect(workspace.cageOptions.every((cage) => cage.status !== "closed" && cage.status !== "retired")).toBe(true);
  });

  it("scopes cage and animal reads to lab memberships", async () => {
    const staffActor = { id: "user-staff", role: "animal_staff" as const };
    const readonlyActor = { id: "user-readonly", role: "read_only" as const };

    const staffCages = await getCageListView(staffActor);
    const readonlyAnimals = await getAnimalListView(readonlyActor);
    const staffIntake = await getCageIntakeOptionsView(staffActor, "litter-001");
    const readonlyIntake = await getCageIntakeOptionsView(readonlyActor, "litter-001");

    expect(staffCages.some((cage) => cage.barcode === "CM-A101-001")).toBe(true);
    expect(staffCages.some((cage) => cage.barcode === "CM-A102-005")).toBe(false);
    expect(readonlyAnimals.length).toBeGreaterThan(0);
    expect(readonlyAnimals.every((animal) => animal.owningLabId === "lab-neuroimmune")).toBe(true);
    expect(staffIntake.litter?.id).toBe("litter-001");
    expect(readonlyIntake.litter).toBeNull();
  });

  it("updates cage details and starts a replacement charge period", async () => {
    await resetColonyState();

    const result = await updateCageDetails(
      {
        cageId: "cage-a101-003",
        status: "quarantine",
        notes: "Temporary special diet monitoring.",
        welfareFlags: ["diet-watch", "hydration-check"],
        chargeCategoryId: "charge-standard",
        dailyRateCents: 199,
      },
      resolvedGlobalActor,
    );
    const detail = await getCageDetailView("cage-a101-003");
    const activePeriod = await prisma.cageChargePeriod.findFirst({
      where: { cageId: "cage-a101-003", endedAt: null },
      include: { category: true },
    });

    expect(result.ok).toBe(true);
    expect(detail?.cage.status).toBe("quarantine");
    expect(detail?.cage.welfareFlags).toEqual(["diet-watch", "hydration-check"]);
    expect(activePeriod?.category.code).toBe("STANDARD");
    expect(activePeriod?.dailyRateCents).toBe(199);

    await resetColonyState();
  });

  it("rejects routine cross-lab animal moves until the approval workflow is finalized", async () => {
    await resetColonyState();

    const rejected = await moveAnimalToCage(
      {
        animalId: "animal-003",
        toCageId: "cage-a102-005",
        movedAt: "2026-04-10",
        reason: "Cross-lab transfer check.",
      },
      { id: "user-staff", role: "animal_staff" },
    );
    const elevatedRejected = await moveAnimalToCage(
      {
        animalId: "animal-003",
        toCageId: "cage-a102-005",
        movedAt: "2026-04-10",
        reason: "Attempted elevated cross-lab transfer.",
      },
      { id: "user-admin", role: "admin" },
    );
    const animal = await prisma.animal.findUnique({
      where: { id: "animal-003" },
      select: { currentCageId: true, owningLabId: true },
    });
    const labTransfer = await prisma.animalLabTransfer.findFirst({
      where: { animalId: "animal-003", toLabId: "lab-neuroimmune" },
    });

    expect(rejected.ok).toBe(false);
    expect(elevatedRejected.ok).toBe(false);
    expect(animal).toMatchObject({ currentCageId: "cage-a101-003", owningLabId: "lab-microglia" });
    expect(labTransfer).toBeNull();

    await resetColonyState();
  });

  it("disables the legacy direct cage transfer mutation", async () => {
    await resetColonyState();

    const result = await transferCageToLab(
      {
        cageId: "cage-a101-002",
        toLabId: "lab-neuroimmune",
        movedAt: "2026-04-11",
        reason: "Lab ownership moved to pilot cohort.",
      },
      { id: "user-admin", role: "admin" },
    );
    const cage = await prisma.cage.findUnique({
      where: { id: "cage-a101-002" },
      include: {
        chargePeriods: { orderBy: { startedAt: "desc" } },
        labTransfers: true,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("source request");
    expect(cage?.labId).toBe("lab-microglia");
    expect(cage?.chargePeriods[0]?.labId).toBe("lab-microglia");
    expect(cage?.labTransfers).toHaveLength(0);

    await resetColonyState();
  });

  it("moves occupants and exits a cage in one transaction", async () => {
    await resetColonyState();
    process.env.COLONY_REFERENCE_DATE = "2026-05-01T09:00:00.000Z";

    const before = await getCageDetailView("cage-a101-003");
    const destination = await createCageWithAssignments(
      {
        cages: [
          {
            clientId: "exit-destination",
            labId: "lab-microglia",
            roomId: "room-a101",
            rackId: "rack-a101-2",
            cageNumber: "097",
            status: "active",
            startDate: "2026-04-12",
          },
        ],
        assignments: [],
        movedAt: "2026-04-12",
        reason: "Prepare cage-exit destination.",
      },
      { id: "user-manager", role: "colony_manager" },
    );
    if (!destination.ok || !destination.entityId) throw new Error("Expected an exit destination cage.");
    const destinationCageId = destination.entityId;
    await prisma.cage.update({
      where: { id: destinationCageId },
      data: { status: "breeding" },
    });
    const activeChargePeriod = before?.cage.chargePeriodId
      ? await prisma.cageChargePeriod.findUnique({ where: { id: before.cage.chargePeriodId } })
      : null;
    if (!before?.cage.labId || !activeChargePeriod) throw new Error("Expected an active cage charge period before closure.");
    const expectedVersion = (await prisma.cage.findUniqueOrThrow({ where: { id: "cage-a101-003" }, select: { version: true } })).version;
    const command = {
      cageId: "cage-a101-003",
      labId: before.cage.labId,
      closedAt: "2026-05-01",
      reason: "Cage no longer chargeable after consolidation.",
      expectedChargePeriodId: activeChargePeriod.id,
      expectedChargeCategoryId: activeChargePeriod.categoryId,
      expectedChargePeriodStartedAt: activeChargePeriod.startedAt.toISOString(),
      expectedDailyRateCents: activeChargePeriod.dailyRateCents,
      expectedCurrencyCode: activeChargePeriod.currencyCode,
      assignments: (before?.occupants ?? []).map((animal) => ({
        animalId: animal.id,
        toCageId: destinationCageId,
      })),
    };
    const actor = {
      id: "user-admin",
      email: "admin@colony.local",
      name: "Facility Administrator",
      role: "admin" as const,
      databaseRole: "admin" as const,
      canonicalRole: "facility_admin" as const,
      authzVersion: 1,
      activeLabId: null,
      activeMembership: null,
      memberships: [],
      capabilities: [...getActorCapabilities({ canonicalRole: "facility_admin", activeMembership: null })],
    };
    const review = await prepareWorkflowReview({
      actor,
      draftId: "test-cage-close-draft",
      workflowType: "cage.closure",
      requiredCapability: "cages:manage",
      labId: command.labId,
      payload: { command, expectedVersion },
    });
    if (!review.ok) throw new Error("Expected a cage closure review.");
    const result = await executeCloseCageCommand({
      actor,
      command,
      expectedVersion,
      idempotencyKey: review.snapshot.id,
      requestId: review.snapshot.id,
      workflowDraftId: review.draft.id,
      reviewSnapshotId: review.snapshot.id,
    });
    const cage = await prisma.cage.findUnique({
      where: { id: "cage-a101-003" },
      include: { chargePeriods: true, closure: true },
    });
    const remainingOccupants = await prisma.animal.count({
      where: { currentCageId: "cage-a101-003", outcomeStatus: "alive" },
    });
    const reconciledDestination = await prisma.cage.findUniqueOrThrow({
      where: { id: destinationCageId },
      select: { status: true },
    });
    const reconciliationAudit = await prisma.auditLog.findFirst({
      where: {
        entityType: "cage",
        entityId: destinationCageId,
        action: "reconcile_breeding_status",
      },
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(cage).toMatchObject({ active: false, status: "closed" });
    expect(cage?.closure?.billingCutoffAt.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(cage?.chargePeriods.every((period) => period.endedAt)).toBe(true);
    expect(remainingOccupants).toBe(0);
    expect(reconciledDestination.status).toBe("active");
    expect(reconciliationAudit?.newValue).toMatchObject({ status: "active" });

    await resetColonyState();
  });

  it("generates, finalizes, and voids cage invoices", async () => {
    await resetColonyState();

    const actor = resolvedGlobalActor;
    const draft = await generateLabInvoice(
      {
        idempotencyKey: "colony-billing-generate",
        requestId: "colony-billing-generate-request",
        labId: "lab-microglia",
        periodStart: "2026-04-01",
        periodEnd: "2026-05-01",
      },
      actor,
    );
    const invoice = draft.ok
      ? await prisma.invoice.findUnique({
          where: { id: draft.entityId },
          include: { lineItems: true },
        })
      : null;
    const finalized = draft.ok ? await finalizeInvoice({
      invoiceId: draft.entityId ?? "",
      labId: "lab-microglia",
      expectedVersion: invoice?.version ?? 1,
      idempotencyKey: "colony-billing-finalize",
      requestId: "colony-billing-finalize-request",
    }, actor) : null;
    const regenerate = await generateLabInvoice(
      {
        idempotencyKey: "colony-billing-regenerate",
        requestId: "colony-billing-regenerate-request",
        labId: "lab-microglia",
        periodStart: "2026-04-01",
        periodEnd: "2026-05-01",
      },
      actor,
    );
    const rejectedVoid = draft.ok ? await voidInvoice({
      invoiceId: draft.entityId ?? "",
      labId: "lab-microglia",
      expectedVersion: (invoice?.version ?? 1) + 1,
      idempotencyKey: "colony-billing-void-empty",
      requestId: "colony-billing-void-empty-request",
      reason: " ",
    }, actor) : null;
    const detail = draft.ok ? await getInvoiceDetailView(draft.entityId ?? "", actor) : null;
    const voided = draft.ok ? await voidInvoice({
      invoiceId: draft.entityId ?? "",
      labId: "lab-microglia",
      expectedVersion: (invoice?.version ?? 1) + 1,
      idempotencyKey: "colony-billing-void",
      requestId: "colony-billing-void-request",
      reason: "Unit test void.",
    }, actor) : null;
    const voidStatus = draft.ok
      ? await prisma.invoice.findUnique({ where: { id: draft.entityId }, select: { status: true, voidReason: true } })
      : null;

    expect(draft.ok).toBe(true);
    expect(invoice?.subtotalCents).toBe(27000);
    expect(invoice?.lineItems).toHaveLength(4);
    expect(detail?.lineItems[0]).toMatchObject({
      dayCount: expect.any(Number),
      dailyRateCents: expect.any(Number),
      amountCents: expect.any(Number),
    });
    expect(finalized?.ok).toBe(true);
    expect(regenerate.ok).toBe(false);
    expect(rejectedVoid?.ok).toBe(false);
    expect(voided?.ok).toBe(true);
    expect(voidStatus).toMatchObject({ status: "void", voidReason: "Unit test void." });

    await resetColonyState();
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
    const overview = await getBreedingOverviewView(globalActor);
    const suggestions = await getBreedingSuggestionsView(globalActor);

    expect(overview.some((breeding) => breeding.id === "breeding-001")).toBe(true);
    expect(overview.find((breeding) => breeding.id === "breeding-001")?.adults.length).toBeGreaterThan(0);
    expect(overview.find((breeding) => breeding.id === "breeding-001")?.litter?.id).toBe("litter-001");
    expect(suggestions.length).toBeGreaterThan(1);
    expect(suggestions[0]?.priorityScore).toBeGreaterThan(suggestions[1]?.priorityScore ?? 0);
  });

  it("builds dashboard metrics and highlights directly from Prisma data", async () => {
    const [metrics, composition, highlights] = await Promise.all([
      getDashboardMetricsView(globalActor),
      getColonyCompositionView(globalActor),
      getDashboardHighlightsView(globalActor),
    ]);

    expect(metrics.activeAnimals).toBeGreaterThan(0);
    expect(metrics.openAlerts).toBeGreaterThan(0);
    expect(composition.transgenic).toBeGreaterThan(0);
    expect(highlights.upcomingWean.some((item) => item.litterId === "litter-001")).toBe(true);
    expect(highlights.alerts.length).toBeGreaterThan(0);
  });

  it("builds settings rules and audit reads directly from Prisma data", async () => {
    const [rules, auditLogs] = await Promise.all([getRuleSummaryView(), getRecentAuditLogsView(resolvedGlobalActor)]);

    expect(rules.some((rule) => rule.label.includes("Breeder"))).toBe(true);
    expect(auditLogs.length).toBeGreaterThan(0);
    expect(auditLogs[0]?.timestamp.length).toBeGreaterThan(0);
  });
});
