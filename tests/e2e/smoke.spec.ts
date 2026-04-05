import { expect, test, type Page } from "@playwright/test";

const credentials = {
  admin: { email: "admin@colony.local", password: "colony123" },
  staff: { email: "staff@colony.local", password: "colony123" },
  researcher: { email: "researcher@colony.local", password: "colony123" },
} as const;

function projectSeed(projectName: string) {
  const normalized = projectName.toLowerCase();

  return {
    suffix: normalized === "mobile" ? "902" : "901",
    reservationAnimalId: normalized === "mobile" ? "animal-012" : "animal-014",
    noteSuffix: normalized === "mobile" ? "mobile" : "desktop",
  };
}

async function signInAs(page: Page, account: keyof typeof credentials) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByTestId("login-email").fill(credentials[account].email);
  await page.getByTestId("login-password").fill(credentials[account].password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("stat-active-mice")).toBeVisible({ timeout: 15_000 });
}

async function submitAfterBlur(page: Page, testId: string) {
  await page.evaluate(() => {
    const active = document.activeElement;

    if (active instanceof HTMLElement) {
      active.blur();
    }
  });

  const button = page.getByTestId(testId);
  await button.scrollIntoViewIfNeeded();
  await button.dispatchEvent("click");
}

test("demo user can log in and reach the dashboard", async ({ page }) => {
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

  await expect(page.getByText(`${animalId} was added to the active colony.`)).toBeVisible();
  await page.getByTestId("colony-search").fill(animalId);
  await expect(page.locator('[data-testid="colony-table"] tbody tr')).toHaveCount(1);
  await expect(page.getByRole("link", { name: animalId })).toBeVisible();
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

  await expect(page.getByText("Health note logged for CM-A101-003.")).toBeVisible();
  await expect(page.getByText(noteText).first()).toBeVisible();
});

test("researcher sees reservation conflicts and can reserve an eligible animal", async ({ page }, testInfo) => {
  const seed = projectSeed(testInfo.project.name);

  await signInAs(page, "researcher");

  await page.goto("/animals/animal-005");
  await page.getByTestId("reservation-experiment").selectOption("experiment-002");
  await submitAfterBlur(page, "reservation-submit");
  await expect(page.getByText("CM-26005 still needs genotype confirmation before reservation.")).toBeVisible();

  await page.goto(`/animals/${seed.reservationAnimalId}`);
  await page.getByTestId("reservation-experiment").selectOption("experiment-002");
  await submitAfterBlur(page, "reservation-submit");

  await expect(page.getByText("Reserved for EXP-LPS-005.")).toBeVisible();
  await expect(page.getByText("reserved · LPS low dose")).toBeVisible();
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
