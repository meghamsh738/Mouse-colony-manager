import fs from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { SEEDED_DEV_EMAILS, SEEDED_DEV_PASSWORD } from "../../src/lib/seed-metadata";
import { seedDatabase } from "../../prisma/seed-database";
import { createCageWithAssignments } from "../../src/lib/cage-intake-write";
import { prisma } from "../../src/lib/prisma";

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async () => {
  await seedDatabase();
});

const credentials = {
  admin: { email: SEEDED_DEV_EMAILS.admin, password: SEEDED_DEV_PASSWORD },
  staff: { email: SEEDED_DEV_EMAILS.staff, password: SEEDED_DEV_PASSWORD },
  researcher: { email: SEEDED_DEV_EMAILS.researcher, password: SEEDED_DEV_PASSWORD },
} as const;

function projectSeed(projectName: string) {
  const normalized = projectName.toLowerCase();
  const isMobile = normalized === "mobile";

  return {
    suffix: isMobile ? "902" : "901",
    reservationAnimalId: isMobile ? "animal-012" : "animal-014",
    lifecycleAnimalId: isMobile ? "animal-014" : "animal-013",
    lifecycleAnimalCode: isMobile ? "CM-26014" : "CM-26013",
    ruleGraceDays: isMobile ? "16" : "15",
    moveRoomId: isMobile ? "room-a102" : "room-a101",
    moveRackId: isMobile ? "rack-a102-1" : "rack-a101-2",
    moveCageNumber: "006",
    moveLocationLabel: isMobile ? "A102 / R1 / 006" : "A101 / R2 / 006",
    noteSuffix: isMobile ? "mobile" : "desktop",
    genotypeAlleleId: isMobile ? "allele-tdt" : "allele-creer",
    genotypeExpect: isMobile ? "tdTomato +/-" : "CreER +/-",
  };
}

async function signInAs(page: Page, account: keyof typeof credentials) {
  await page.context().clearCookies();
  await page.goto("/");
  await page.goto("/login");
  await page.getByTestId("login-email").fill(credentials[account].email);
  await page.getByTestId("login-password").fill(credentials[account].password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("stat-active-mice")).toBeVisible({ timeout: 45_000 });
}

async function signInForApiRequests(page: Page, account: keyof typeof credentials) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByTestId("login-email").fill(credentials[account].email);
  await page.getByTestId("login-password").fill(credentials[account].password);

  await Promise.all([
    page.waitForURL(/\/$/, { waitUntil: "commit" }),
    page.getByTestId("login-submit").click(),
  ]);

  await page.goto("data:text/plain,session-ready");
}

async function submitWithinAfterBlur(page: Page, scope: Page | Locator, testId: string) {
  await page.evaluate(() => {
    const active = document.activeElement;

    if (active instanceof HTMLElement) {
      active.blur();
    }
  });

  const button = scope.getByTestId(testId);
  await button.scrollIntoViewIfNeeded();
  await button.dispatchEvent("click");
}

async function submitAfterBlur(page: Page, testId: string) {
  await submitWithinAfterBlur(page, page, testId);
}

async function enableBreedingOverride(page: Page) {
  await page.getByTestId("breeding-create-override").setChecked(true, { force: true });
  await expect(page.getByTestId("breeding-create-override")).toBeChecked();
}

test("seeded user can log in and reach the dashboard", async ({ page }) => {
  await signInAs(page, "admin");
});

test("admin can browse the read-only workbook and return to app view", async ({ page }, testInfo) => {
  await signInAs(page, "admin");

  if (testInfo.project.name === "mobile") {
    await page.locator("summary").filter({ hasText: "More" }).click();
  }
  await page.getByLabel("Main navigation").getByRole("link", { name: "Workbook" }).click();
  await expect(page).toHaveURL(/\/workbook/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  await page.getByLabel("Workbook sections").getByRole("link", { name: "Rooms" }).click();
  await page.getByLabel("Rooms sheets").getByRole("link", { name: "Room A101" }).click();
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(page.locator('.workbook-canvas a[href="/animals/animal-001"]:visible').first()).toBeVisible();
  await expect(page.locator(".workbook-canvas")).toContainText("CM-24001");

  if (testInfo.project.name === "mobile") {
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(pageOverflow).toBeLessThanOrEqual(2);
  }

  await page.getByRole("link", { name: "App view" }).click();
  await expect(page).toHaveURL(/\/cages$/);
});

test("admin can add a new animal record from the colony table", async ({ page }, testInfo) => {
  const seed = projectSeed(testInfo.project.name);
  const animalId = `CM-${seed.suffix}21`;
  const labId = `MC-2026-${seed.suffix}21`;

  await signInAs(page, "admin");
  await page.goto("/animals");

  await page.getByRole("button", { name: "Add mouse" }).click();
  await page.getByTestId("animal-create-id").fill(animalId);
  await page.getByTestId("animal-create-lab-id").fill(labId);
  await submitAfterBlur(page, "animal-create-submit");

  await page.getByTestId("colony-search").fill(animalId);
  await expect(page.locator('[data-testid="colony-table"] tbody tr')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByRole("link", { name: animalId })).toBeVisible({ timeout: 30_000 });
});

test("animal staff can scan a cage and log a welfare note", async ({ page }, testInfo) => {
  const seed = projectSeed(testInfo.project.name);
  const noteText = `Wet bedding observed during ${seed.noteSuffix} room round.`;
  const attachmentLabel = `Welfare photo ${seed.noteSuffix}`;

  await signInAs(page, "staff");
  await page.goto("/scan");
  await page.getByTestId("barcode-manual-input").fill("CM-A101-003");
  await page.getByRole("button", { name: "Open cage" }).click();

  await expect(page).toHaveURL(/\/scan\/CM-A101-003$/);
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByTestId("health-note-text").fill(noteText);
  await page.getByTestId("health-note-attachment-label").fill(attachmentLabel);
  await page.getByTestId("health-note-attachment").setInputFiles({
    name: `welfare-${seed.noteSuffix}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(`Attachment for ${noteText}`),
  });
  await submitAfterBlur(page, "health-note-submit");

  await expect(page.getByText("Health note logged for CM-A101-003.")).toBeVisible({ timeout: 30_000 });
  await page.goto("/scan/CM-A101-003");
  await expect(page.getByText(noteText).first()).toBeVisible({ timeout: 30_000 });
  await page.locator("summary").filter({ hasText: "Recent notes" }).click();
  await expect(page.getByText(attachmentLabel).first()).toBeVisible({ timeout: 30_000 });
});

test("animal staff can browse cage list and open cage detail", async ({ page }) => {
  await signInAs(page, "staff");
  await page.goto("/cages");

  const cageLink = page.getByRole("link", { name: "A101 / R2 / 003" });
  await expect(cageLink).toBeVisible();
  const href = await cageLink.getAttribute("href");

  expect(href).toBe("/cages/cage-a101-003");
  await page.goto(href!);

  await expect(page).toHaveURL(/\/cages\/cage-a101-003$/);
  await expect(page.getByText("CM-A101-003").first()).toBeVisible();
  await expect(page.getByText("CM-26003").first()).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Scan", exact: true })).toBeVisible();
});

test("admin can review and permanently close an empty cage from detail and scan views", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name === "mobile" ? "098" : "099";
  const expectedClosedDate = new Date().toISOString().slice(0, 10);
  const created = await createCageWithAssignments({
    cages: [{
      clientId: `e2e-close-${suffix}`,
      labId: "lab-microglia",
      roomId: "room-a101",
      rackId: "rack-a101-2",
      cageNumber: suffix,
      status: "active",
      startDate: "2026-04-04",
    }],
    assignments: [],
    movedAt: "2026-04-04",
    reason: "Create an empty cage for closure browser verification.",
  }, { id: "user-admin", role: "admin" });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.message);
  expect(created.entityId).toBeTruthy();
  const cage = await prisma.cage.findUniqueOrThrow({ where: { id: created.entityId! }, select: { barcode: true } });

  await signInAs(page, "admin");
  await page.goto(`/cages/${created.entityId}`);
  await page.getByRole("link", { name: /Close cage/ }).click();
  await expect(page.getByTestId("high-impact-workflow")).toBeVisible();
  await page.getByRole("button", { name: "Review closure" }).click();
  await page.getByRole("checkbox", { name: /closure and billing cutoff are permanent/i }).check();
  await page.getByRole("button", { name: /Permanently close/ }).click();

  await expect(page.getByText("Cage closed")).toBeVisible({ timeout: 30_000 });
  await page.goto(`/cages/${created.entityId}`);
  await expect(page.getByRole("heading", { name: "Closure" })).toBeVisible();
  await expect(page.getByText(`Start of ${expectedClosedDate}`)).toBeVisible();
  await expect(page.getByRole("link", { name: /Close cage/ })).toHaveCount(0);

  await page.goto(`/scan/${cage.barcode}`);
  await expect(page.getByRole("heading", { name: "Closure" })).toBeVisible();
  await expect(page.getByText(`Start of ${expectedClosedDate}`)).toBeVisible();
  await expect(page.getByRole("link", { name: /Close cage/ })).toHaveCount(0);

  const persisted = await prisma.cageClosure.findUniqueOrThrow({
    where: { cageId: created.entityId! },
    include: { chargePeriod: true },
  });
  expect(persisted.billingCutoffAt.toISOString()).toBe(`${expectedClosedDate}T00:00:00.000Z`);
  expect(persisted.chargePeriod.endedAt?.toISOString()).toBe(`${expectedClosedDate}T00:00:00.000Z`);
});

test("animal staff can open a print-ready cage label sheet", async ({ page }) => {
  await signInAs(page, "staff");
  await page.goto("/cages");

  await page.getByTestId("cage-search").fill("CM-A101-001");
  await page.getByTestId("cage-print-current").click();

  await expect(page).toHaveURL(/\/cages\/labels\?search=CM-A101-001/);
  await expect(page.getByRole("heading", { name: "Cage QR labels" })).toBeVisible();
  await expect(page.getByTestId("cage-print-label")).toHaveCount(1);
  await expect(page.getByTestId("cage-print-label").first()).toContainText("CM-A101-001");
  await expect(page.getByTestId("print-labels-button")).toBeVisible();
});

test("animal staff can transfer a mouse into a scanned cage with fallback controls", async ({ page }) => {
  await signInAs(page, "staff");
  await page.goto("/scan/CM-A101-001");

  await page.getByTestId("animal-transfer-search").fill("CM-26003");
  await page.getByTestId("animal-transfer-card").filter({ hasText: "CM-26003" }).click();
  await expect(page.getByText("Staged move: CM-26003 from CM-A101-003 to CM-A101-001.")).toBeVisible();
  await page.getByTestId("animal-transfer-date").fill("2026-04-10");
  await page.getByTestId("animal-transfer-reason").fill("Transferred during e2e cage round.");
  await submitAfterBlur(page, "animal-transfer-submit");

  await expect(page.getByText("CM-26003 moved from A101 / R2 / 003 to A101 / R1 / 001.")).toBeVisible({
    timeout: 30_000,
  });

  await page.goto("/cages/cage-a101-001");
  await expect(page.locator("tbody").first()).toContainText("CM-26003", { timeout: 30_000 });
  await page.goto("/cages/cage-a101-003");
  await expect(page.locator("tbody").first()).not.toContainText("CM-26003", { timeout: 30_000 });
});

test("animal staff can move a cage from the scan workspace and review the history entry", async ({ page }, testInfo) => {
  const seed = projectSeed(testInfo.project.name);
  const moveReason = `Relocated during ${seed.noteSuffix} monitoring sweep.`;

  await signInAs(page, "staff");
  await page.goto("/scan/CM-A102-004");

  await page.getByTestId("cage-move-room").selectOption(seed.moveRoomId);
  await page.getByTestId("cage-move-rack").selectOption(seed.moveRackId);
  await page.getByTestId("cage-move-number").fill(seed.moveCageNumber);
  await page.getByTestId("cage-move-date").fill("2026-04-09");
  await page.getByTestId("cage-move-reason").fill(moveReason);
  await submitAfterBlur(page, "cage-move-submit");

  await expect(page.getByRole("heading", { name: seed.moveLocationLabel })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(seed.moveLocationLabel).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(moveReason).first()).toBeVisible({ timeout: 30_000 });

  await page.goto("/cages/cage-a102-004");
  await expect(page).toHaveURL(/\/cages\/cage-a102-004$/);
  await expect(page.getByText(seed.moveLocationLabel).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(moveReason).first()).toBeVisible({ timeout: 30_000 });
});

test("researcher can review experiment overview and tune the distribution helper", async ({ page }) => {
  await signInAs(page, "researcher");
  await page.goto("/experiments");

  await expect(page.getByRole("heading", { name: "Experiments" })).toBeVisible();
  await expect(page.getByTestId("experiment-cohort")).toBeVisible();
  await page.getByTestId("planner-sex").selectOption("male");
  await page.getByTestId("planner-desired-number").fill("2");
  await page.getByTestId("planner-genotype").fill("Cre");
  await page.getByTestId("planner-group-count").fill("2");
  await page.getByTestId("planner-random-seed").fill("seed-77");
  await page.getByTestId("planner-max-same-cage").fill("1");
  await submitAfterBlur(page, "planner-apply");

  await expect(page).toHaveURL(/sex=male/);
  await expect(page).toHaveURL(/desiredNumber=2/);
  await expect(page).toHaveURL(/randomSeed=seed-77/);
  await expect(page.getByTestId("experiment-ranked-candidates")).toContainText("Male", { timeout: 30_000 });
  await expect(page.getByTestId("experiment-ranked-candidates")).toContainText("Multi-project allocation", { timeout: 30_000 });
  await expect(page.getByTestId("experiment-exclusions")).toContainText("Sex filter mismatch", { timeout: 30_000 });
  await expect(page.getByTestId("experiment-exclusions")).toContainText("Examples", { timeout: 30_000 });
  await expect(page.getByTestId("experiment-randomization")).toContainText("Seed seed-77", { timeout: 30_000 });
  await expect(page.getByTestId("experiment-randomization")).toContainText("Balance by age band", { timeout: 30_000 });
  await expect(page.getByTestId("experiment-randomization")).toContainText("same-cage animals per treatment arm", { timeout: 30_000 });
  await expect(page.getByTestId("planner-group-card")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId("planner-group-card").first()).toContainText("Group A", { timeout: 30_000 });

  await page.getByTestId("planner-save-experiment").selectOption("experiment-001");
  await page.getByTestId("planner-save-start-date").fill("2026-04-15");
  await page.getByTestId("planner-save-notes").fill("Persisted from the distribution helper during smoke coverage.");
  await submitAfterBlur(page, "planner-save-submit");

  await expect(page.getByText("Planned 2 cohort assignments for EXP-TAM-041.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("planned · Group A · starts 15 Apr 2026").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Planned from helper/i).first()).toBeVisible({ timeout: 30_000 });

  const plannedEditor = page.locator('[data-testid^="planned-assignment-editor-"]').first();
  const assignmentId = (await plannedEditor.getAttribute("data-testid"))?.replace("planned-assignment-editor-", "");
  expect(assignmentId).toBeTruthy();

  await plannedEditor.getByTestId(`planned-group-${assignmentId}`).fill("Group Z");
  await plannedEditor.getByTestId(`planned-notes-${assignmentId}`).fill("Adjusted in the overview editor before promotion.");
  await submitWithinAfterBlur(page, plannedEditor, `planned-update-submit-${assignmentId}`);
  await expect(page.getByText("Updated planned assignment").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/planned · Group Z · starts/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Planned entry updated/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Adjusted in the overview editor before promotion.").first()).toBeVisible({ timeout: 30_000 });

  const secondEditor = page.locator('[data-testid^="planned-assignment-editor-"]').nth(1);
  const secondAssignmentId = (await secondEditor.getAttribute("data-testid"))?.replace("planned-assignment-editor-", "");
  expect(secondAssignmentId).toBeTruthy();
  await submitWithinAfterBlur(page, secondEditor, `planned-delete-submit-${secondAssignmentId}`);
  await expect(page.getByTestId(`planned-assignment-editor-${secondAssignmentId}`)).toHaveCount(0, { timeout: 30_000 });

  await submitAfterBlur(page, "experiment-promote-submit-experiment-001");
  await expect(page.getByText("Promoted 1 planned assignment for EXP-TAM-041.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/reserved .* starts 15 Apr 2026/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Promoted from planned/i).first()).toBeVisible({ timeout: 30_000 });

  await submitAfterBlur(page, "experiment-demote-submit-experiment-001");
  await expect(page.getByText(/Rolled back to planned/i).first()).toBeVisible({ timeout: 30_000 });
});

test("researcher can query the authenticated integration API surface", async ({ page }) => {
  await signInForApiRequests(page, "researcher");

  const animalListResponse = await page.request.get("/api/v1/animals?sex=male&availableOnly=true&limit=2");
  const animalList = {
    status: animalListResponse.status(),
    body: await animalListResponse.json(),
  };

  expect(animalList.status).toBe(200);
  expect(animalList.body.meta.filters).toMatchObject({ sex: "male", availableOnly: true });
  expect(animalList.body.data.length).toBeGreaterThan(0);
  expect(
    animalList.body.data.every(
      (animal: { sex: string; availableForExperiment: boolean }) =>
        animal.sex === "male" && animal.availableForExperiment,
    ),
  ).toBe(true);

  const firstAnimalId = animalList.body.data[0]?.id as string;
  expect(firstAnimalId).toBeTruthy();

  const exportCatalogResponse = await page.request.get("/api/v1/exports");
  const exportCatalog = {
    status: exportCatalogResponse.status(),
    body: await exportCatalogResponse.json(),
  };

  expect(exportCatalog.status).toBe(200);
  expect(exportCatalog.body.data.some((entry: { entity: string }) => entry.entity === "animals")).toBe(true);

  const apiIndexResponse = await page.request.get("/api/v1");
  const apiIndex = {
    status: apiIndexResponse.status(),
    body: await apiIndexResponse.json(),
  };

  expect(apiIndex.status).toBe(200);
  expect(
    apiIndex.body.data.resources.find((resource: { name: string }) => resource.name === "projects"),
  ).toMatchObject({
    path: "/api/v1/projects",
    methods: ["GET", "POST", "PATCH"],
  });

  const projectListResponse = await page.request.get("/api/v1/projects?search=PRJ-NEURO-07&limit=1");
  const projectList = {
    status: projectListResponse.status(),
    body: await projectListResponse.json(),
  };

  expect(projectList.status).toBe(200);
  expect(projectList.body.data).toHaveLength(1);
  expect(projectList.body.data[0]).toMatchObject({
    projectCode: "PRJ-NEURO-07",
    title: "Neuroimmune response pilot",
  });

  const sampleIntakeResponse = await page.request.post("/api/v1/samples", {
    data: {
      animalCode: "CM-26003",
      projectCode: "PRJ-MICRO-24",
      sampleLabel: "API-SMOKE-001",
      sampleType: "Tail DNA",
      status: "stored",
      collectedAt: "2026-04-05",
      storageLocation: "API freezer / box 1",
      quantityLabel: "20 uL",
      notes: "Created by the authenticated integration API smoke.",
    },
  });
  const sampleIntake = {
    status: sampleIntakeResponse.status(),
    body: await sampleIntakeResponse.json(),
  };

  expect(sampleIntake.status).toBe(201);
  expect(sampleIntake.body.meta.created).toBe(true);
  expect(sampleIntake.body.data).toMatchObject({
    animalCode: "CM-26003",
    projectCode: "PRJ-MICRO-24",
    sampleLabel: "API-SMOKE-001",
    status: "stored",
  });

  const sampleLifecycleResponse = await page.request.patch("/api/v1/samples", {
    data: {
      sampleLabel: "API-SMOKE-001",
      status: "allocated",
      storageLocation: "API allocation rack / slot 2",
      quantityLabel: "10 uL remaining",
      notes: "Allocated by the authenticated integration API smoke.",
    },
  });
  const sampleLifecycle = {
    status: sampleLifecycleResponse.status(),
    body: await sampleLifecycleResponse.json(),
  };

  expect(sampleLifecycle.status).toBe(200);
  expect(sampleLifecycle.body.meta.created).toBe(false);
  expect(sampleLifecycle.body.data).toMatchObject({
    sampleLabel: "API-SMOKE-001",
    status: "allocated",
    storageLocation: "API allocation rack / slot 2",
    quantityLabel: "10 uL remaining",
  });

  const cryostorageCreateResponse = await page.request.post("/api/v1/cryostorage", {
    data: {
      strainName: "Cx3cr1-CreER",
      projectCode: "PRJ-NEURO-07",
      sampleLabel: "CRYO-SMOKE-001",
      materialType: "Frozen embryos",
      status: "stored",
      storedAt: "2026-04-12",
      storageLocation: "LN2 Tank C / Cane 2 / Goblet 1",
      quantityLabel: "14 embryos",
      recoveryNotes: "Suitable for line recovery if breeders fail.",
      notes: "Created by the authenticated integration API smoke.",
    },
  });
  const cryostorageCreate = {
    status: cryostorageCreateResponse.status(),
    body: await cryostorageCreateResponse.json(),
  };

  expect(cryostorageCreate.status).toBe(201);
  expect(cryostorageCreate.body.meta.created).toBe(true);
  expect(cryostorageCreate.body.data).toMatchObject({
    sampleLabel: "CRYO-SMOKE-001",
    strainName: "Cx3cr1-CreER",
    projectCode: "PRJ-NEURO-07",
    status: "stored",
  });

  const cryostorageUpdateResponse = await page.request.patch("/api/v1/cryostorage", {
    data: {
      sampleLabel: "CRYO-SMOKE-001",
      status: "reserved",
      storageLocation: "Recovery staging rack",
      quantityLabel: "12 embryos reserved",
      recoveryNotes: "Reserved for August recovery attempt.",
      notes: "Updated by the authenticated integration API smoke.",
    },
  });
  const cryostorageUpdate = {
    status: cryostorageUpdateResponse.status(),
    body: await cryostorageUpdateResponse.json(),
  };

  expect(cryostorageUpdate.status).toBe(200);
  expect(cryostorageUpdate.body.meta.created).toBe(false);
  expect(cryostorageUpdate.body.data).toMatchObject({
    sampleLabel: "CRYO-SMOKE-001",
    status: "reserved",
    storageLocation: "Recovery staging rack",
    quantityLabel: "12 embryos reserved",
  });

  const genotypeIntakeResponse = await page.request.post("/api/v1/genotypes", {
    multipart: {
      animalCode: "CM-25009",
      marker: "CreER",
      zygosity: "+/-",
      status: "confirmed",
      sourceType: "external vendor",
      assayType: "Transnetyx panel",
      sampleDate: "2026-04-09",
      resultDate: "2026-04-09",
      resultText: "External API smoke CreER positive call.",
      provider: "Transnetyx",
      confidence: "high",
      sampleId: "TX-SMOKE-001",
      attachmentLabel: "Vendor smoke report",
      attachment: {
        name: "vendor-smoke-report.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("smoke genotype attachment"),
      },
    },
  });
  const genotypeIntake = {
    status: genotypeIntakeResponse.status(),
    body: await genotypeIntakeResponse.json(),
  };

  expect(genotypeIntake.status).toBe(201);
  expect(genotypeIntake.body.meta.created).toBe(true);
  expect(genotypeIntake.body.data).toMatchObject({
    animalCode: "CM-25009",
    finalCall: "CreER +/-",
    markerTested: "CreER",
    sampleId: "TX-SMOKE-001",
    status: "confirmed",
  });
  expect(genotypeIntake.body.data.attachments).toEqual([
    expect.objectContaining({
      label: "Vendor smoke report",
      fileName: "vendor-smoke-report.txt",
      fileType: "text/plain",
    }),
  ]);

  const assignmentSyncResponse = await page.request.post("/api/v1/experiments/assignments", {
    data: {
      experimentCode: "EXP-LPS-005",
      startDate: "2026-04-18",
      notes: "Created by the authenticated integration API smoke.",
      assignments: [
        { animalCode: "CM-26005", treatmentGroup: "Arm A" },
        { animalCode: "CM-26012", treatmentGroup: "Arm B" },
      ],
    },
  });
  const assignmentSync = {
    status: assignmentSyncResponse.status(),
    body: await assignmentSyncResponse.json(),
  };

  expect(assignmentSync.status).toBe(201);
  expect(assignmentSync.body.meta.created).toBe(true);
  expect(assignmentSync.body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        animalCode: "CM-26005",
        experimentCode: "EXP-LPS-005",
        status: "planned",
        treatmentGroup: "Arm A",
      }),
      expect.objectContaining({
        animalCode: "CM-26012",
        experimentCode: "EXP-LPS-005",
        status: "planned",
        treatmentGroup: "Arm B",
      }),
    ]),
  );

  const assignmentPromoteResponse = await page.request.patch("/api/v1/experiments/assignments", {
    data: {
      experimentCode: "EXP-LPS-005",
      action: "promote_planned",
    },
  });
  const assignmentPromote = {
    status: assignmentPromoteResponse.status(),
    body: await assignmentPromoteResponse.json(),
  };

  expect(assignmentPromote.status).toBe(200);
  expect(assignmentPromote.body.meta.message).toContain("Promoted 2 planned assignments for EXP-LPS-005");
  expect(assignmentPromote.body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ animalCode: "CM-26005", status: "reserved" }),
      expect.objectContaining({ animalCode: "CM-26012", status: "reserved" }),
    ]),
  );

  const plannedEditCreateResponse = await page.request.post("/api/v1/experiments/assignments", {
    data: {
      experimentCode: "EXP-LPS-005",
      startDate: "2026-04-22",
      notes: "Created for planned assignment maintenance coverage.",
      assignments: [{ animalCode: "CM-26004", treatmentGroup: "Arm D" }],
    },
  });
  const plannedEditCreate = {
    status: plannedEditCreateResponse.status(),
    body: await plannedEditCreateResponse.json(),
  };

  expect(plannedEditCreate.status).toBe(201);

  const editableAssignmentId = plannedEditCreate.body.data[0]?.id as string;
  expect(editableAssignmentId).toBeTruthy();

  const assignmentUpdateResponse = await page.request.patch(`/api/v1/experiments/assignments/${editableAssignmentId}`, {
    data: {
      startDate: "2026-04-20",
      treatmentGroup: "Arm Z",
      notes: "Adjusted by the authenticated integration API smoke.",
    },
  });
  const assignmentUpdate = {
    status: assignmentUpdateResponse.status(),
    body: await assignmentUpdateResponse.json(),
  };

  expect(assignmentUpdate.status).toBe(200);
  expect(assignmentUpdate.body.meta.created).toBe(false);
  expect(assignmentUpdate.body.data).toMatchObject({
    id: editableAssignmentId,
    animalCode: "CM-26004",
    status: "planned",
    treatmentGroup: "Arm Z",
    startDate: "2026-04-20T00:00:00.000Z",
  });

  const assignmentDeleteResponse = await page.request.delete(`/api/v1/experiments/assignments/${editableAssignmentId}`);
  const assignmentDelete = {
    status: assignmentDeleteResponse.status(),
    body: await assignmentDeleteResponse.json(),
  };

  expect(assignmentDelete.status).toBe(200);
  expect(assignmentDelete.body.meta.created).toBe(false);
  expect(assignmentDelete.body.data).toMatchObject({
    id: editableAssignmentId,
    animalCode: "CM-26004",
    status: "planned",
    treatmentGroup: "Arm Z",
  });
});

test("staff can create an animal through the integration API", async ({ page }) => {
  await signInForApiRequests(page, "staff");

  const response = await page.request.post("/api/v1/animals", {
    data: {
      animalCode: "CM-26099",
      labId: "MC-2026-099",
      sex: "female",
      dob: "2026-03-10",
      strainName: "C57BL/6J",
      cageBarcode: "CM-A101-003",
      projectCode: "PRJ-NEURO-07",
      notes: "Created by the authenticated animal intake integration API smoke.",
    },
  });
  const payload = {
    status: response.status(),
    body: await response.json(),
  };

  expect(payload.status).toBe(201);
  expect(payload.body.meta.created).toBe(true);
  expect(payload.body.meta.message).toContain("CM-26099 was added to the active colony");
  expect(payload.body.data).toMatchObject({
    animal: {
      animalId: "CM-26099",
      labId: "MC-2026-099",
      status: "colony_holding",
      outcomeStatus: "alive",
    },
    cageLabel: "A101 / R2 / 003",
    strainName: "C57BL/6J",
  });
  expect(payload.body.data.projectCodes).toContain("PRJ-NEURO-07");
});

test("researcher can reserve an animal through the integration API", async ({ page }) => {
  await signInForApiRequests(page, "researcher");

  const response = await page.request.post("/api/v1/experiments/reservations", {
    data: {
      experimentCode: "EXP-LPS-005",
      animalCode: "CM-26004",
      startDate: "2026-04-18",
      treatmentGroup: "Arm C",
      notes: "Reserved by the authenticated integration API smoke.",
    },
  });
  const payload = {
    status: response.status(),
    body: await response.json(),
  };

  expect(payload.status).toBe(201);
  expect(payload.body.meta.created).toBe(true);
  expect(payload.body.data).toMatchObject({
    animalCode: "CM-26004",
    experimentCode: "EXP-LPS-005",
    status: "reserved",
    treatmentGroup: "Arm C",
  });
});

test("admin can update a rule through the integration API", async ({ page }) => {
  await signInForApiRequests(page, "admin");

  const listResponse = await page.request.get("/api/v1/rules?category=capacity&criticalOnly=true&limit=10");
  const listPayload = {
    status: listResponse.status(),
    body: await listResponse.json(),
  };

  expect(listPayload.status).toBe(200);
  expect(listPayload.body.meta.filters).toMatchObject({ category: "capacity", criticalOnly: true, limit: 10 });
  expect(listPayload.body.data.some((rule: { key: string }) => rule.key === "cage_max_occupancy")).toBe(true);

  const updateResponse = await page.request.patch("/api/v1/rules", {
    data: {
      ruleKey: "cage_max_occupancy",
      valueInput: "1",
      criticalBlock: true,
    },
  });
  const updatePayload = {
    status: updateResponse.status(),
    body: await updateResponse.json(),
  };

  expect(updatePayload.status).toBe(200);
  expect(updatePayload.body.meta.created).toBe(false);
  expect(updatePayload.body.data).toMatchObject({
    id: "rule-006",
    key: "cage_max_occupancy",
    displayValue: "1",
    editorValue: "1",
    criticalBlock: true,
  });
});

test("admin can import genotype rows through the integration API", async ({ page }) => {
  const fixturePath = path.join(process.cwd(), "tests/fixtures/genotype-import.csv");
  const fixtureBuffer = fs.readFileSync(fixturePath);

  await signInForApiRequests(page, "admin");

  const response = await page.request.post("/api/v1/genotypes/import", {
    multipart: {
      file: {
        name: "genotype-import.csv",
        mimeType: "text/csv",
        buffer: fixtureBuffer,
      },
    },
  });
  const payload = {
    status: response.status(),
    body: await response.json(),
  };

  expect(payload.status).toBe(200);
  expect(payload.body.meta.created).toBe(false);
  expect(payload.body.meta.message).toContain("Processed 2 genotype rows from genotype-import.csv. 2 succeeded.");
  expect(payload.body.data).toMatchObject({
    fileName: "genotype-import.csv",
    parsedRowCount: 2,
    preflightErrorCount: 0,
  });
});

test("staff can ingest an external cage welfare event through the integration API", async ({ page }) => {
  await signInForApiRequests(page, "staff");

  const response = await page.request.post("/api/v1/cages/health-notes", {
    multipart: {
      cageBarcode: "CM-A101-003",
      noteType: "routine_welfare",
      severity: "warning",
      note: "External rack sensor reported persistent wet bedding.",
      followupRequired: true,
      actionTaken: "Flagged for cage-change triage.",
      attachmentLabel: "Rack sensor snapshot",
      attachment: {
        name: "rack-sensor-snapshot.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("sensor snapshot"),
      },
    },
  });
  const payload = {
    status: response.status(),
    body: await response.json(),
  };

  expect(payload.status).toBe(201);
  expect(payload.body.meta.created).toBe(true);
  expect(payload.body.data).toMatchObject({
    cageBarcode: "CM-A101-003",
    noteType: "routine_welfare",
    severity: "warning",
    followupRequired: true,
  });
  expect(payload.body.data.attachments).toEqual([
    expect.objectContaining({
      label: "Rack sensor snapshot",
      fileName: "rack-sensor-snapshot.txt",
      fileType: "text/plain",
    }),
  ]);
});

test("staff can sync an external cage move through the integration API", async ({ page }) => {
  await signInForApiRequests(page, "staff");

  const response = await page.request.patch("/api/v1/cages", {
    data: {
      cageBarcode: "CM-A101-003",
      roomNumber: "A102",
      rackNumber: "R1",
      cageNumber: "009",
      movedAt: "2026-04-18",
      reason: "External room-balancing workflow relocated the cage.",
    },
  });
  const payload = {
    status: response.status(),
    body: await response.json(),
  };

  expect(payload.status).toBe(200);
  expect(payload.body.meta.created).toBe(false);
  expect(payload.body.meta.message).toContain("CM-A101-003 moved to A102 / R1 / 009");
  expect(payload.body.data).toMatchObject({
    cageBarcode: "CM-A101-003",
    roomNumber: "A102",
    rackNumber: "R1",
    cageNumber: "009",
    cageLabel: "A102 / R1 / 009",
  });
});

test("staff can sync an external animal lifecycle update through the integration API", async ({ page }) => {
  await signInForApiRequests(page, "staff");
  const currentResponse = await page.request.get("/api/v1/animals/animal-003");
  const currentPayload = await currentResponse.json();

  const response = await page.request.patch("/api/v1/animals", {
    data: {
      animalCode: "CM-26003",
      targetStatus: "euthanized",
      happenedAt: "2026-04-18",
      reason: "External colony system recorded humane endpoint completion.",
      expectedVersion: currentPayload.data.animal.version,
      confirmed: true,
    },
  });
  const payload = {
    status: response.status(),
    body: await response.json(),
  };

  expect(payload.status).toBe(200);
  expect(payload.body.meta.created).toBe(false);
  expect(payload.body.meta.message).toContain("CM-26003 marked euthanized");
  expect(payload.body.data.animal).toMatchObject({
    animalId: "CM-26003",
    status: "euthanized",
    outcomeStatus: "euthanized",
    deathReason: "External colony system recorded humane endpoint completion.",
  });
  expect(payload.body.data.cageLabel).toBe("Not in cage");
});

test("admin can create a breeding setup through the integration API", async ({ page }) => {
  await signInForApiRequests(page, "admin");

  const response = await page.request.post("/api/v1/breeding-setups", {
    data: {
      sireCode: "CM-22008",
      damCode: "CM-25009",
      startDate: "2026-04-18",
      targetGenotype: "CreER maintenance API smoke",
      targetSex: "female",
      notes: "Created by the authenticated breeding setup integration API smoke.",
      allowOverride: true,
    },
  });
  const payload = {
    status: response.status(),
    body: await response.json(),
  };

  expect(payload.status).toBe(201);
  expect(payload.body.meta.created).toBe(true);
  expect(payload.body.meta.message).toContain("Breeding setup created for CM-22008 and CM-25009");
  expect(payload.body.data).toMatchObject({
    status: "active",
    targetGenotype: "CreER maintenance API smoke",
    targetSex: "female",
  });
  expect(payload.body.data.adults).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: "sire", animalCode: "CM-22008", status: "breeding" }),
      expect.objectContaining({ role: "dam", animalCode: "CM-25009", status: "breeding" }),
    ]),
  );
});

test("admin can record a litter through the integration API", async ({ page }) => {
  await signInForApiRequests(page, "admin");

  const response = await page.request.post("/api/v1/litters", {
    data: {
      breedingSetupId: "breeding-001",
      birthDate: "2026-04-12",
      litterSizeBirth: 6,
      notes: "Created by the authenticated litter integration API smoke.",
    },
  });
  const payload = {
    status: response.status(),
    body: await response.json(),
  };

  expect(payload.status).toBe(201);
  expect(payload.body.meta.created).toBe(true);
  expect(payload.body.meta.message).toContain("Litter recorded for breeding-001");
  expect(payload.body.data).toMatchObject({
    breedingSetupId: "breeding-001",
    birthDate: "2026-04-12",
    litterSizeBirth: 6,
    targetGenotype: "Cre+/- ; tdTomato+/-",
  });
  expect(payload.body.data.adults).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: "sire", animalCode: "CM-24001" }),
      expect.objectContaining({ role: "dam", animalCode: "CM-24002" }),
    ]),
  );
});

test("admin can record weaning through the integration API", async ({ page }) => {
  await signInForApiRequests(page, "admin");

  const breedingResponse = await page.request.post("/api/v1/breeding-setups", {
    data: {
      sireCode: "CM-22008",
      damCode: "CM-25009",
      startDate: "2026-04-18",
      targetGenotype: "Weaning API smoke",
      allowOverride: true,
    },
  });
  const breedingPayload = await breedingResponse.json();

  const litterResponse = await page.request.post("/api/v1/litters", {
    data: {
      breedingSetupId: breedingPayload.data.id,
      birthDate: "2026-04-20",
      litterSizeBirth: 5,
      notes: "Created before the authenticated weaning integration API smoke.",
    },
  });
  const litterPayload = await litterResponse.json();

  const response = await page.request.post("/api/v1/weanings", {
    data: {
      litterId: litterPayload.data.id,
      weanDate: "2026-05-01",
      femaleCount: 2,
      maleCount: 3,
      femaleCageBarcode: "CM-A101-003",
      maleCageBarcode: "CM-A101-002",
      strainName: "Cx3cr1-CreER x Rosa26-LSL-tdTomato",
    },
  });
  const payload = {
    status: response.status(),
    body: await response.json(),
  };

  expect(payload.status).toBe(201);
  expect(payload.body.meta.created).toBe(true);
  expect(payload.body.meta.message).toContain("5 pups weaned");
  expect(payload.body.data).toMatchObject({
    litterId: litterPayload.data.id,
    femaleCount: 2,
    maleCount: 3,
    strainName: "Cx3cr1-CreER x Rosa26-LSL-tdTomato",
    femaleCage: { cageBarcode: "CM-A101-003" },
    maleCage: { cageBarcode: "CM-A101-002" },
  });
  expect(payload.body.data.progeny).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sex: "female", cageBarcode: "CM-A101-003" }),
      expect.objectContaining({ sex: "male", cageBarcode: "CM-A101-002" }),
    ]),
  );
});

test("staff can review the notification inbox and jump into breeding follow-up", async ({ page }) => {
  await signInAs(page, "staff");
  await page.goto("/notifications");

  await expect(page.getByRole("heading", { name: "In-app notification inbox for the active colony." })).toBeVisible();
  await expect(page.getByTestId("notification-feed")).toBeVisible();
  await expect(page.getByTestId("notification-preference-genotype_pending")).toContainText("enabled");
  await expect(page.getByTestId("notification-preference-weaning_due")).toContainText("enabled");

  const weaningLink = page.locator('[data-testid^="notification-link-weaning_due-"]').first();
  await expect(weaningLink).toBeVisible({ timeout: 30_000 });
  const href = await weaningLink.getAttribute("href");
  expect(href).toBe("/breeding");
  await page.goto(href!);

  await expect(page).toHaveURL(/\/breeding$/);
  await expect(page.getByRole("heading", { name: "Active breeding setups and suggested crosses." })).toBeVisible();
});

test("staff can review quarantine and sentinel tracking", async ({ page }) => {
  await signInAs(page, "staff");
  await page.goto("/quarantine");

  await expect(page.getByRole("heading", { name: "Quarantine and sentinel tracking." })).toBeVisible();
  await expect(page.getByTestId("quarantine-cage-list")).toBeVisible();
  await expect(page.getByTestId("quarantine-cage-cage-a102-005")).toContainText("CM-A102-005");
  await expect(page.getByTestId("quarantine-cage-cage-a102-005")).toContainText("Fighting observed in quarantine cage");

  const cageLink = page.getByRole("link", { name: "Open cage workspace" }).first();
  const href = await cageLink.getAttribute("href");
  expect(href).toBe("/cages/cage-a102-005");
});

test("admin can review breeding overview and generator suggestions", async ({ page }) => {
  await signInAs(page, "admin");
  await page.goto("/breeding");

  await expect(page.getByText("breeding-001")).toBeVisible();
  await expect(page.getByText("litter-001 born").first()).toBeVisible();
  await expect(page.getByText("Cross can yield desired dual-transgenic pups").first()).toBeVisible();
  await expect(page.getByTestId("breeding-suggestions")).toContainText("Rule risk", { timeout: 30_000 });
  await expect(page.getByTestId("breeding-suggestions")).toContainText("surplus risk", { timeout: 30_000 });
  await expect(page.getByTestId("breeding-suggestions")).toContainText("Line fertility model", { timeout: 30_000 });
  await expect(page.getByTestId("breeding-suggestions")).toContainText("Uses actual litter history", { timeout: 30_000 });
});

test("admin can create a breeding setup with override", async ({ page }, testInfo) => {
  const seed = projectSeed(testInfo.project.name);
  const targetGenotype = `CreER maintenance ${seed.noteSuffix}`;

  await signInAs(page, "admin");
  await page.goto("/breeding");

  await page.getByTestId("breeding-create-sire").selectOption("animal-008");
  await page.getByTestId("breeding-create-dam").selectOption("animal-009");
  await page.getByTestId("breeding-create-target-genotype").fill(targetGenotype);
  await enableBreedingOverride(page);
  await submitAfterBlur(page, "breeding-create-submit");

  await expect(page.getByText("Breeding setup created for CM-22008 and CM-25009.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(targetGenotype).first()).toBeVisible({ timeout: 30_000 });
});

test("admin can record a litter for a newly created breeding setup", async ({ page }, testInfo) => {
  const seed = projectSeed(testInfo.project.name);
  const targetGenotype = `Litter tracking ${seed.noteSuffix}`;
  const litterNote = `Observed ${seed.noteSuffix} litter confirmation.`;

  await signInAs(page, "admin");
  await page.goto("/breeding");

  await page.getByTestId("breeding-create-sire").selectOption("animal-008");
  await page.getByTestId("breeding-create-dam").selectOption("animal-009");
  await page.getByTestId("breeding-create-target-genotype").fill(targetGenotype);
  await enableBreedingOverride(page);
  await submitAfterBlur(page, "breeding-create-submit");

  const breedingCard = page.locator('[data-testid^="breeding-card-"]').filter({ hasText: targetGenotype }).first();
  await expect(page.getByText("Breeding setup created for CM-22008 and CM-25009.")).toBeVisible({ timeout: 30_000 });
  await expect(breedingCard).toBeVisible({ timeout: 30_000 });

  await breedingCard.getByTestId("litter-create-birth-date").fill("2026-04-10");
  await breedingCard.getByTestId("litter-create-size").fill("7");
  await breedingCard.getByTestId("litter-create-notes").fill(litterNote);
  await submitWithinAfterBlur(page, breedingCard, "litter-create-submit");

  await expect(breedingCard.getByText("7 pups recorded at birth")).toBeVisible({ timeout: 30_000 });
  await expect(breedingCard.getByText(litterNote)).toBeVisible({ timeout: 30_000 });
});

test("admin can wean a recorded litter and assign progeny cages", async ({ page }, testInfo) => {
  const seed = projectSeed(testInfo.project.name);
  const targetGenotype = `Weaning lifecycle ${seed.noteSuffix}`;

  await signInAs(page, "admin");
  await page.goto("/breeding");

  await page.getByTestId("breeding-create-sire").selectOption("animal-008");
  await page.getByTestId("breeding-create-dam").selectOption("animal-009");
  await page.getByTestId("breeding-create-target-genotype").fill(targetGenotype);
  await enableBreedingOverride(page);
  await submitAfterBlur(page, "breeding-create-submit");

  const breedingCard = page.locator('[data-testid^="breeding-card-"]').filter({ hasText: targetGenotype }).first();
  await expect(page.getByText("Breeding setup created for CM-22008 and CM-25009.")).toBeVisible({ timeout: 30_000 });
  await expect(breedingCard).toBeVisible({ timeout: 30_000 });

  await breedingCard.getByTestId("litter-create-birth-date").fill("2026-04-10");
  await breedingCard.getByTestId("litter-create-size").fill("6");
  await submitWithinAfterBlur(page, breedingCard, "litter-create-submit");

  await breedingCard.getByTestId("wean-create-date").fill("2026-05-01");
  await breedingCard.getByTestId("wean-create-female-count").fill("2");
  await breedingCard.getByTestId("wean-create-male-count").fill("3");
  await breedingCard.getByTestId("wean-create-strain").selectOption("strain-creer-tdt");
  await breedingCard.getByTestId("wean-create-female-cage").selectOption("cage-a101-003");
  await breedingCard.getByTestId("wean-create-male-cage").selectOption("cage-a101-002");
  await submitWithinAfterBlur(page, breedingCard, "wean-create-submit");

  await expect(breedingCard.getByText("5 pups weaned")).toBeVisible({ timeout: 30_000 });
  await expect(breedingCard.getByText("5 progeny linked")).toBeVisible({ timeout: 30_000 });
});

test("admin can record a genotype result from the animal detail page", async ({ page }, testInfo) => {
  const seed = projectSeed(testInfo.project.name);
  const resultText = `Expected ${seed.noteSuffix} genotype band present.`;
  const attachmentLabel = `Genotype PDF ${seed.noteSuffix}`;

  await signInAs(page, "admin");
  await page.goto("/animals/animal-009");

  await page.getByTestId("genotype-record-allele").selectOption(seed.genotypeAlleleId);
  await page.getByTestId("genotype-record-zygosity").fill("+/-");
  await page.getByTestId("genotype-record-source-type").selectOption("manual PCR");
  await page.getByTestId("genotype-record-assay-type").fill("gel PCR");
  await page.getByTestId("genotype-record-sample-date").fill("2026-04-09");
  await page.getByTestId("genotype-record-result-date").fill("2026-04-09");
  await page.getByTestId("genotype-record-result-text").fill(resultText);
  await page.getByTestId("genotype-record-attachment-label").fill(attachmentLabel);
  await page.getByTestId("genotype-record-attachment").setInputFiles({
    name: `genotype-${seed.noteSuffix}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(`Attachment for ${resultText}`),
  });
  await submitAfterBlur(page, "genotype-record-submit");

  await expect(page.getByText(seed.genotypeExpect).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("genotype-record-history").getByText(resultText)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("genotype-record-history").getByText(attachmentLabel)).toBeVisible({ timeout: 30_000 });
});

test("admin can record a sample and find it in the inventory workspace", async ({ page }, testInfo) => {
  const seed = projectSeed(testInfo.project.name);
  const sampleLabel = `DNA-${seed.suffix}-26004`;
  const sampleNote = `Recorded during ${seed.noteSuffix} sample inventory verification.`;

  await signInAs(page, "admin");
  await page.goto("/animals/animal-004");

  await page.getByTestId("sample-record-label").fill(sampleLabel);
  await page.getByTestId("sample-record-type").fill("Tail DNA");
  await page.getByTestId("sample-record-status").selectOption("stored");
  await page.getByTestId("sample-record-collected-at").fill("2026-04-11");
  await page.getByTestId("sample-record-project").selectOption("project-neuro");
  await page.getByTestId("sample-record-storage").fill("Freezer 2 / Box D / D04");
  await page.getByTestId("sample-record-quantity").fill("1 x 40 uL");
  await page.getByTestId("sample-record-notes").fill(sampleNote);
  await submitAfterBlur(page, "sample-record-submit");

  await expect(page.getByText(`Sample ${sampleLabel} recorded for CM-26004.`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sample-record-history").getByText(sampleLabel)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sample-record-history").getByText(sampleNote)).toBeVisible({ timeout: 30_000 });

  await page.goto("/samples");
  await page.getByTestId("sample-search").fill(sampleLabel);

  await expect(page.getByTestId("sample-table").getByText(sampleLabel)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sample-table").getByText("CM-26004")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sample-table").getByText(sampleNote)).toBeVisible({ timeout: 30_000 });
});

test("admin can record a cryostorage item and find it in the backup inventory workspace", async ({ page }, testInfo) => {
  const seed = projectSeed(testInfo.project.name);
  const cryoLabel = `CRYO-WT-${seed.suffix}`;
  const recoveryNote = `Recovery review scheduled during ${seed.noteSuffix} archive planning.`;

  await signInAs(page, "admin");
  await page.goto("/cryostorage");

  await page.getByTestId("cryostorage-record-strain").selectOption("strain-wt");
  await page.getByTestId("cryostorage-record-project").selectOption("project-neuro");
  await page.getByTestId("cryostorage-record-label").fill(cryoLabel);
  await page.getByTestId("cryostorage-record-material").fill("Frozen embryos");
  await page.getByTestId("cryostorage-record-status").selectOption("stored");
  await page.getByTestId("cryostorage-record-stored-at").fill("2026-04-12");
  await page.getByTestId("cryostorage-record-location").fill("LN2 Tank C / Cane 2 / Goblet 1");
  await page.getByTestId("cryostorage-record-quantity").fill("14 embryos");
  await page.getByTestId("cryostorage-record-recovery-notes").fill(recoveryNote);
  await page.getByTestId("cryostorage-record-notes").fill("Backup line kept outside the active breeding pool.");
  await submitAfterBlur(page, "cryostorage-record-submit");

  await expect(page.getByText(`Cryostorage record ${cryoLabel} saved for C57BL/6J.`)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("cryostorage-search").fill(cryoLabel);
  await expect(page.getByTestId("cryostorage-table").getByText(cryoLabel)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("cryostorage-table").getByText("Frozen embryos")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("cryostorage-table").getByText(recoveryNote)).toBeVisible({ timeout: 30_000 });
});

test("researcher can review the forecast workspace", async ({ page }) => {
  await signInAs(page, "researcher");
  await page.goto("/forecast");

  await expect(page.getByText("Projected breeding output and experiment-ready runway.")).toBeVisible();
  await expect(page.getByTestId("stat-pending-demand")).toBeVisible();
  await expect(page.getByTestId("stat-90d-gap")).toBeVisible();
  await expect(page.getByTestId("surplus-minimization")).toContainText("Surplus minimization", { timeout: 30_000 });
  await expect(page.getByTestId("long-range-forecast")).toContainText("Long-range study demand", { timeout: 30_000 });
  await expect(page.getByTestId("forecast-table").getByText("x").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Inspect frozen backups" })).toBeVisible();
});

test("admin can import genotype rows from a csv upload", async ({ page }) => {
  const fixturePath = path.join(process.cwd(), "tests/fixtures/genotype-import.csv");

  await signInAs(page, "admin");
  await page.goto("/animals");

  await page.getByTestId("genotype-import-file").setInputFiles(fixturePath);
  await submitAfterBlur(page, "genotype-import-submit");

  await expect(page.getByText("Processed 2 genotype rows from genotype-import.csv. 2 succeeded.")).toBeVisible({
    timeout: 30_000,
  });

  await page.goto("/animals/animal-011");
  await expect(page.getByText("Imported vendor batch verification for CM-26011.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("CreER WT/WT").first()).toBeVisible({ timeout: 30_000 });
});

test("animal staff can euthanize and then archive an animal record", async ({ page }, testInfo) => {
  const seed = projectSeed(testInfo.project.name);

  await signInAs(page, "staff");
  await page.goto(`/animals/${seed.lifecycleAnimalId}`);
  await page.getByRole("link", { name: /Record terminal disposition/ }).click();
  await expect(page.getByTestId("high-impact-workflow")).toBeVisible();

  await page.getByTestId("animal-lifecycle-target").selectOption("euthanized");
  await page.getByTestId("animal-lifecycle-date").fill("2026-04-09");
  await page.getByTestId("animal-lifecycle-reason").fill("Terminal tissue collection completed during endpoint round.");
  await page.getByTestId("animal-lifecycle-review").click();
  await submitAfterBlur(page, "animal-lifecycle-submit");

  await expect(page.getByText(`${seed.lifecycleAnimalCode} marked euthanized.`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("euthanized").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Terminal tissue collection completed during endpoint round.").first()).toBeVisible({
    timeout: 30_000,
  });

  await page.getByTestId("animal-lifecycle-target").selectOption("archived");
  await page.getByTestId("animal-lifecycle-date").fill("2026-04-10");
  await page.getByTestId("animal-lifecycle-reason").fill("Archived after post-procedure disposition review.");
  await page.getByTestId("animal-lifecycle-review").click();
  await submitAfterBlur(page, "animal-lifecycle-submit");

  await expect(page.getByText("archived").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Terminal disposition complete")).toBeVisible({
    timeout: 30_000,
  });

  await page.goto("/animals");
  await page.getByTestId("colony-search").fill(seed.lifecycleAnimalCode);
  await expect(page.locator('[data-testid="colony-table"] tbody tr')).toHaveCount(0, { timeout: 30_000 });
});

test("admin can update a rule threshold and see the audit trail", async ({ page }, testInfo) => {
  const seed = projectSeed(testInfo.project.name);

  await signInAs(page, "admin");
  await page.goto("/settings");

  await page.getByTestId("rule-edit-reservation_start_grace_days").click();
  await page.getByTestId("rule-value-reservation_start_grace_days").fill(seed.ruleGraceDays);
  await submitAfterBlur(page, "rule-save-reservation_start_grace_days");

  await expect(page.getByTestId("rule-value-reservation_start_grace_days")).toHaveValue(seed.ruleGraceDays, { timeout: 30_000 });
  await expect(page.getByText("updated rule_config rule-008").first()).toBeVisible({ timeout: 30_000 });
});

test("researcher sees reservation conflicts and can reserve an eligible animal", async ({ page }, testInfo) => {
  const seed = projectSeed(testInfo.project.name);

  await signInAs(page, "researcher");

  await page.goto("/animals/animal-005");
  await page.getByTestId("reservation-experiment").selectOption("experiment-002");
  await submitAfterBlur(page, "reservation-submit");
  await expect(page.getByText("CM-26005 still needs genotype confirmation before reservation.")).toBeVisible({
    timeout: 30_000,
  });

  await page.goto(`/animals/${seed.reservationAnimalId}`);
  await page.getByTestId("reservation-experiment").selectOption("experiment-002");
  await submitAfterBlur(page, "reservation-submit");

  await expect(page.getByText("reserved · LPS low dose")).toBeVisible({ timeout: 30_000 });
});

test("exports require auth and return csv for signed-in users", async ({ page }) => {
  await page.goto("/login");

  const unauthorized = await page.evaluate(async () => {
    const response = await fetch("/api/exports/animals");

    return { status: response.status };
  });

  expect(unauthorized.status).toBe(401);

  await signInAs(page, "admin");

  const authorized = await page.evaluate(async () => {
    const response = await fetch("/api/exports/animals");

    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: await response.text(),
    };
  });

  expect(authorized.status).toBe(200);
  expect(authorized.contentType).toContain("text/csv");
  expect(authorized.body).toContain("animalId");
});

test("animal and cage export controls follow the active table filters", async ({ page }) => {
  await signInAs(page, "admin");

  await page.goto("/animals");
  await page.getByTestId("colony-search").fill("CM-26005");

  const animalExportHref = await page.getByTestId("animal-export-current").getAttribute("href");
  expect(animalExportHref).toContain("search=CM-26005");

  const animalExport = await page.evaluate(async (href) => {
    const response = await fetch(href!);

    return {
      status: response.status,
      disposition: response.headers.get("content-disposition"),
      body: await response.text(),
    };
  }, animalExportHref);

  expect(animalExport.status).toBe(200);
  expect(animalExport.disposition).toContain('animals-filtered.csv');
  expect(animalExport.body).toContain("CM-26005");
  expect(animalExport.body).not.toContain("CM-26003");

  await page.goto("/cages");
  await page.getByLabel("Warnings only").check();
  const warningBarcode = (await page.getByTestId("cage-row").first().getByTestId("cage-row-barcode").textContent())?.trim();

  expect(warningBarcode).toBeTruthy();

  await page.getByTestId("cage-search").fill(warningBarcode ?? "");

  const cageExportHref = await page.getByTestId("cage-export-current").getAttribute("href");
  expect(cageExportHref).toContain(`search=${warningBarcode}`);
  expect(cageExportHref).toContain("warningsOnly=true");

  const cageExport = await page.evaluate(async (href) => {
    const response = await fetch(href!);

    return {
      status: response.status,
      disposition: response.headers.get("content-disposition"),
      body: await response.text(),
    };
  }, cageExportHref);

  expect(cageExport.status).toBe(200);
  expect(cageExport.disposition).toContain('cages-filtered.csv');
  expect(cageExport.body).toContain(warningBarcode ?? "");
});
