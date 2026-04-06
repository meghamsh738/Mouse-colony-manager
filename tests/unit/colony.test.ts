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
import { getExperimentCandidateView, getExperimentOverviewView } from "@/lib/experiments-read";
import { addCageHealthNote, createAnimalRecord, reserveAnimalForExperiment } from "@/lib/colony-write";
import { getRecentAuditLogsView, getRuleSummaryView } from "@/lib/settings-read";
import { seedDatabase } from "../../prisma/seed";

async function resetColonyState() {
  await seedDatabase();
}

describe("colony logic", () => {
  beforeAll(async () => {
    await resetColonyState();
  }, 60_000);

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

  it("adds a cage health note that surfaces as a cage alert", async () => {
    const note = await addCageHealthNote(
      {
        cageId: "cage-a101-003",
        noteType: "routine_welfare",
        severity: "warning",
        note: "Wet bedding noted during welfare round.",
        followupRequired: true,
        actionTaken: "Flag for cage change.",
      },
      { id: "user-staff", role: "animal_staff" },
    );

    expect(note.ok).toBe(true);
    const cage = await getCageDetailView("cage-a101-003");
    expect(cage?.alerts.some((alert) => alert.message.includes("Wet bedding noted during welfare round."))).toBe(true);
  });

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

  it("builds animal csv exports directly from Prisma data", async () => {
    const csv = await buildCsvExport("animals");

    expect(csv).toContain("animalId,labId,sex,age,strain,genotype,cage,status,projects,warnings");
    expect(csv).toContain("CM-26005");
    expect(csv).toContain("MC-2026-005");
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
