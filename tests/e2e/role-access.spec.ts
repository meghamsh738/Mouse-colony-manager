import { expect, test, type Page } from "@playwright/test";

import { seedRoleQaDatabase } from "../../prisma/seed-role-qa";
import { SEEDED_ROLE_QA_EMAILS } from "../../src/lib/seed-metadata";

function requireRoleQaPassword() {
  const password = process.env.ROLE_QA_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("ROLE_QA_PASSWORD must be supplied by the operator and contain at least 12 characters.");
  }
  return password;
}

test.describe.configure({ timeout: 60_000 });

test.beforeEach(async () => {
  await seedRoleQaDatabase();
});

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(requireRoleQaPassword());
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 });
}

async function expectAllowed(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page).not.toHaveURL(/\/access-denied/);
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function expectDenied(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/access-denied/);
  await expect(page.getByRole("heading", { name: "This workspace is not available" })).toBeVisible();
}

function actionControl(page: Page, name: RegExp) {
  return page.getByRole("button", { name }).or(page.getByRole("link", { name }));
}

test("IT Head can inspect system status but cannot open colony records", async ({ page }) => {
  await signIn(page, SEEDED_ROLE_QA_EMAILS.itHead);
  await expectAllowed(page, "/system", "System");
  await expectDenied(page, "/animals");
});

test("Facility Admin can govern users but cannot inspect IT-only system status", async ({ page }) => {
  await signIn(page, SEEDED_ROLE_QA_EMAILS.facilityAdmin);
  await expectAllowed(page, "/administration/users", "Users and access");
  await expectAllowed(page, "/sops", "Standard operating procedures");
  await expect(page.getByRole("button", { name: "Create facility SOP" })).toBeVisible();
  await expectDenied(page, "/system");
});

test("CMU Staff can operate the approval queue but cannot govern users", async ({ page }) => {
  await signIn(page, SEEDED_ROLE_QA_EMAILS.cmuStaff);
  await expectAllowed(page, "/approvals", "Approvals");
  await expectAllowed(page, "/procedures", "Procedures");
  await expectAllowed(page, "/cryostorage", "Cryostorage");
  await expectDenied(page, "/administration/users");
});

test("Lab Owner can administer their lab but cannot govern unit users", async ({ page }) => {
  await signIn(page, SEEDED_ROLE_QA_EMAILS.labOwner);
  await expectAllowed(page, "/administration/labs", "Labs and members");
  await expectAllowed(page, "/sops", "Standard operating procedures");
  await expect(page.getByRole("button", { name: "Create lab SOP" })).toBeVisible();
  await expectDenied(page, "/administration/users");
});

test("Lab Manager can use approvals but cannot administer lab ownership", async ({ page }) => {
  await signIn(page, SEEDED_ROLE_QA_EMAILS.labManager);
  await expectAllowed(page, "/approvals", "Approvals");
  await expectDenied(page, "/administration/labs");
});

test("Lab Staff can manage animals but cannot use the approval queue", async ({ page }) => {
  await signIn(page, SEEDED_ROLE_QA_EMAILS.labStaff);
  await expectAllowed(page, "/animals", "Animals");
  await expect(actionControl(page, /^Add mouse(?:$|:)/)).toBeVisible();
  await expectAllowed(page, "/procedures", "Procedures");
  await expect(page.getByRole("button", { name: "Plan procedure" })).toBeVisible();
  await expectAllowed(page, "/cryostorage", "Cryostorage");
  await expect(page.getByRole("button", { name: "New request" })).toBeVisible();
  await expectDenied(page, "/approvals");
});

test("Lab Viewer can read animals without mutation or approval access", async ({ page }) => {
  await signIn(page, SEEDED_ROLE_QA_EMAILS.labViewer);
  await expectAllowed(page, "/animals", "Animals");
  await expect(actionControl(page, /^Add mouse(?:$|:)/)).toHaveCount(0);
  await expectAllowed(page, "/forecast", "Forecast");
  await expectAllowed(page, "/procedures", "Procedures");
  await expect(page.getByRole("button", { name: "Plan procedure" })).toHaveCount(0);
  await expectAllowed(page, "/sops", "Standard operating procedures");
  await expect(page.getByRole("button", { name: /Create .* SOP/ })).toHaveCount(0);
  await expectDenied(page, "/approvals");
});

test("Lab Owner can publish a privacy-safe strain-directory example", async ({ page }) => {
  await signIn(page, SEEDED_ROLE_QA_EMAILS.labOwner);
  await expectAllowed(page, "/strains", "Strain directory");

  await page.getByRole("button", { name: /^Create private draft:/ }).click();
  const createForm = page.locator("form").filter({ has: page.locator('select[name="strainId"]') });
  await createForm.locator('select[name="strainId"]').selectOption("strain-creer");
  await createForm.locator('select[name="contactUserId"]').selectOption("user-lab-owner-qa");
  await createForm.getByRole("button", { name: "Create private draft", exact: true }).click();
  await expect(page.getByText(/Private strain-directory draft created/)).toBeVisible({ timeout: 30_000 });

  await page.goto("/strains");
  const managedListing = page.locator("details").filter({
    has: page.getByText("Cx3cr1-CreER", { exact: true }),
  });
  await managedListing.locator("summary").click();
  const manageForm = managedListing.locator("form");
  await manageForm.locator('select[name="status"]').selectOption("shared");
  await manageForm.getByRole("button", { name: "Save listing" }).click();
  await expect(page.getByText("Listing is now visible in the unit-wide directory.")).toBeVisible({ timeout: 30_000 });

  await page.goto("/strains");
  const sharedListings = page.getByTestId("strain-directory-listings");
  await expect(sharedListings).toContainText("Cx3cr1-CreER");
  await expect(sharedListings).toContainText("QA Lab Owner");
  await expect(sharedListings).not.toContainText("CM-26001");
  await expect(sharedListings).not.toContainText("A101 / R1 / 001");
});
