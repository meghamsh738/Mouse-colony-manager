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

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async () => {
  await seedRoleQaDatabase();
});

test("welfare duties preserve clinical privacy and responsive subject selection", async ({ page }) => {
  await signIn(page, SEEDED_ROLE_QA_EMAILS.veterinarian);
  await page.goto("/welfare");
  await expect(page.getByTestId("welfare-workspace")).toHaveAttribute("data-welfare-access", "designated_veterinarian");
  await expect(page.getByTestId("welfare-policy-marker")).toContainText("synthetic-fail-closed-v1");
  await expect(page.getByTestId("welfare-private-clinical")).toBeVisible();
  await expect(page.getByTestId("welfare-treatment-order")).toContainText("Synthetic QA compound");
  await expectNoHorizontalOverflow(page);

  await signIn(page, SEEDED_ROLE_QA_EMAILS.cmuStaff);
  await page.goto("/welfare");
  await expect(page.getByTestId("welfare-workspace")).toHaveAttribute("data-welfare-access", "welfare_officer");
  await expect(page.getByTestId("welfare-private-clinical")).toHaveCount(0);
  await expect(page.getByTestId("welfare-treatment-order")).toHaveCount(0);
  await expect(page.getByText("Synthetic QA compound")).toHaveCount(0);

  const subjectPicker = page.getByTestId("welfare-subject-picker");
  const cageValue = await subjectPicker.locator("option").evaluateAll((options) =>
    options.find((option) => option.textContent?.startsWith("Cage "))?.getAttribute("value") ?? "",
  );
  expect(cageValue).toMatch(/^cage:/);
  await subjectPicker.selectOption(cageValue);
  const openForm = page.getByTestId("welfare-open-form");
  await expect(openForm.locator('input[name="subjectType"]')).toHaveValue("cage");
  await expect(openForm.locator('input[name="subjectId"]')).not.toHaveValue("");
  await expect(openForm.locator('input[name="expectedSubjectVersion"]')).not.toHaveValue("");
  await expectNoHorizontalOverflow(page);

  await signIn(page, SEEDED_ROLE_QA_EMAILS.labOwner);
  await page.goto("/welfare");
  await expect(page).toHaveURL(/\/access-denied/);
  await expect(page.getByRole("heading", { name: "This workspace is not available" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
