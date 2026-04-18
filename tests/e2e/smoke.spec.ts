import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { SEEDED_DEV_EMAILS, SEEDED_DEV_PASSWORD } from "../../src/lib/seed-metadata";

test.describe.configure({ timeout: 90_000 });

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

test("admin can add a new animal record from the colony table", async ({ page }, testInfo) => {
  const seed = projectSeed(testInfo.project.name);
  const animalId = `CM-${seed.suffix}21`;
  const labId = `MC-2026-${seed.suffix}21`;

  await signInAs(page, "admin");
  await page.goto("/animals");

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

  await signInAs(page, "staff");
  await page.goto("/scan");
  await page.getByTestId("barcode-manual-input").fill("CM-A101-003");
  await page.getByRole("button", { name: "Open cage" }).click();

  await expect(page).toHaveURL(/\/scan\/CM-A101-003$/);
  await page.getByTestId("health-note-text").fill(noteText);
  await submitAfterBlur(page, "health-note-submit");

  await expect(page.getByText("Health note logged for CM-A101-003.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(noteText).first()).toBeVisible({ timeout: 30_000 });
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
  await expect(page.getByText("CM-26003")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open mobile scan view" })).toBeVisible();
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

test("researcher can review experiment overview and candidate helper", async ({ page }) => {
  await signInAs(page, "researcher");
  await page.goto("/experiments");

  await expect(page.getByText("EXP-LPS-005")).toBeVisible();
  await expect(page.getByText("PRJ-NEURO-07")).toBeVisible();
  await expect(page.getByText("Included for review despite current blocker").first()).toBeVisible();
});

test("admin can review breeding overview and generator suggestions", async ({ page }) => {
  await signInAs(page, "admin");
  await page.goto("/breeding");

  await expect(page.getByText("breeding-001")).toBeVisible();
  await expect(page.getByText("litter-001 born").first()).toBeVisible();
  await expect(page.getByText("Cross can yield desired dual-transgenic pups").first()).toBeVisible();
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

  await signInAs(page, "admin");
  await page.goto("/animals/animal-009");

  await page.getByTestId("genotype-record-allele").selectOption(seed.genotypeAlleleId);
  await page.getByTestId("genotype-record-zygosity").fill("+/-");
  await page.getByTestId("genotype-record-source-type").selectOption("manual PCR");
  await page.getByTestId("genotype-record-assay-type").fill("gel PCR");
  await page.getByTestId("genotype-record-sample-date").fill("2026-04-09");
  await page.getByTestId("genotype-record-result-date").fill("2026-04-09");
  await page.getByTestId("genotype-record-result-text").fill(resultText);
  await submitAfterBlur(page, "genotype-record-submit");

  await expect(page.getByText(seed.genotypeExpect).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("genotype-record-history").getByText(resultText)).toBeVisible({ timeout: 30_000 });
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

  await page.getByTestId("animal-lifecycle-target").selectOption("euthanized");
  await page.getByTestId("animal-lifecycle-date").fill("2026-04-09");
  await page.getByTestId("animal-lifecycle-reason").fill("Terminal tissue collection completed during endpoint round.");
  await submitAfterBlur(page, "animal-lifecycle-submit");

  await expect(page.getByText(`${seed.lifecycleAnimalCode} marked euthanized.`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("euthanized").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Terminal tissue collection completed during endpoint round.").first()).toBeVisible({
    timeout: 30_000,
  });

  await page.getByTestId("animal-lifecycle-target").selectOption("archived");
  await page.getByTestId("animal-lifecycle-date").fill("2026-04-10");
  await page.getByTestId("animal-lifecycle-reason").fill("Archived after post-procedure disposition review.");
  await submitAfterBlur(page, "animal-lifecycle-submit");

  await expect(page.getByText("archived").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("This animal is already archived and cannot move to another lifecycle state.")).toBeVisible({
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
