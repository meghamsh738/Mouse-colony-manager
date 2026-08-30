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

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(requireRoleQaPassword());
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

function capturePageErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async () => {
  await seedRoleQaDatabase();
});

test("a lab manager receives against independently reviewed health evidence and an independent approver signs census evidence", async ({ page }) => {
  const errors = capturePageErrors(page);

  await signIn(page, SEEDED_ROLE_QA_EMAILS.labManager);
  await page.goto("/reconciliation");
  await expect(page.getByRole("heading", { name: "Intake and census reconciliation", exact: true })).toBeVisible();
  await expect(page.getByTestId("reconciliation-workbench")).toContainText("Synthetic fail-closed boundary");
  await expect(page.getByTestId("reconciliation-workbench")).toContainText("pre-existing empty quarantine cage");

  let manifest = page.locator("article").filter({ hasText: "M16-QA-EXPECTED-001" });
  await expect(manifest).toContainText("health missing");
  const healthForm = manifest.locator("form").filter({ has: page.getByRole("button", { name: "Record health evidence" }) });
  await healthForm.locator('select[name="evidenceType"]').selectOption("sentinel_panel");
  await healthForm.locator('select[name="result"]').selectOption("negative");
  await healthForm.getByRole("button", { name: "Record health evidence" }).click();
  await expect(page.getByTestId("reconciliation-notice")).toContainText(/operational evidence was saved/i, { timeout: 30_000 });

  manifest = page.locator("article").filter({ hasText: "M16-QA-EXPECTED-001" });
  await expect(manifest).toContainText("health pending");

  await signIn(page, SEEDED_ROLE_QA_EMAILS.veterinarian);
  await page.goto("/reconciliation");
  manifest = page.locator("article").filter({ hasText: "M16-QA-EXPECTED-001" });
  await manifest.locator('select[name="decision"]').selectOption("compatible");
  await manifest.getByRole("button", { name: "Record independent veterinary decision" }).click();
  await expect(page.getByTestId("reconciliation-notice")).toContainText(/operational evidence was saved/i, { timeout: 30_000 });
  await expect(manifest).toContainText("health compatible");

  await signIn(page, SEEDED_ROLE_QA_EMAILS.labManager);
  await page.goto("/reconciliation");
  manifest = page.locator("article").filter({ hasText: "M16-QA-EXPECTED-001" });
  await expect(manifest).toContainText("health compatible");
  await manifest.getByRole("button", { name: "Start receiving" }).click();
  await expect(manifest.getByRole("button", { name: "Record receipt observation" })).toBeVisible({ timeout: 30_000 });
  await expect(manifest.getByRole("button", { name: "Confirm atomically" })).toBeVisible();

  const discrepancy = page.getByTestId("census-discrepancy").filter({ hasText: "unknown" }).first();
  await discrepancy.getByRole("button", { name: "Resolve without rewriting" }).click();
  await expect(discrepancy).toContainText("resolved", { timeout: 30_000 });
  await expectNoHorizontalOverflow(page);

  await signIn(page, SEEDED_ROLE_QA_EMAILS.facilityAdminApprover);
  await page.goto("/reconciliation");
  const resolved = page.getByTestId("census-discrepancy").filter({ hasText: "resolved" }).first();
  await resolved.getByRole("button", { name: "Independently sign off" }).click();
  await expect(page.getByTestId("census-discrepancy").filter({ hasText: "signed off" }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Temporary capacity exception" })).toBeVisible();
  await expect(page.getByText(/does not bypass the facility hard cage limit/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("read-only and veterinarian roles see privacy-minimized evidence without reconciliation mutation controls", async ({ page }) => {
  const errors = capturePageErrors(page);

  await signIn(page, SEEDED_ROLE_QA_EMAILS.labViewer);
  await page.goto("/reconciliation");
  await expect(page).not.toHaveURL(/\/access-denied/);
  await expect(page.getByText("M16-QA-EXPECTED-001", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create expected manifest" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Record health evidence" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resolve without rewriting" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Temporary capacity exception" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await signIn(page, SEEDED_ROLE_QA_EMAILS.veterinarian);
  await page.goto("/reconciliation");
  await expect(page).not.toHaveURL(/\/access-denied/);
  await expect(page.getByText("M16-QA-EXPECTED-001", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create expected manifest" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Grant expiring exception" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
