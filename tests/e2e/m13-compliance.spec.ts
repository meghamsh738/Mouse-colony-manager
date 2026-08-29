import { expect, test, type Page } from "@playwright/test";

import { seedRoleQaDatabase } from "../../prisma/seed-role-qa";
import { SEEDED_ROLE_QA_EMAILS } from "../../src/lib/seed-metadata";

function requireRoleQaPassword() {
  const password = process.env.ROLE_QA_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error(
      "ROLE_QA_PASSWORD must be supplied by the operator and contain at least 12 characters.",
    );
  }
  return password;
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(requireRoleQaPassword());
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => url.pathname !== "/login", {
    timeout: 30_000,
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
}

test.describe.configure({ timeout: 60_000 });

test.beforeEach(async () => {
  await seedRoleQaDatabase();
});

test("independent duty holders see only their protocol or training controls", async ({
  page,
}) => {
  await signIn(page, SEEDED_ROLE_QA_EMAILS.facilityAdmin);
  await page.goto("/administration/compliance");
  await expect(
    page.getByRole("heading", {
      name: "Protocol and competency administration",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("synthetic-compliance-boundary")).toBeVisible();
  await expect(page.getByTestId("maker-checker-notice")).toBeVisible();
  await expect(page.getByText("QA-ACTIVE-6", { exact: false })).toBeVisible();
  await expect(page.getByTestId("protocol-draft-form")).toHaveCount(0);
  await expect(page.getByTestId("competency-issue-form")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await signIn(page, SEEDED_ROLE_QA_EMAILS.facilityAdminApprover);
  await page.goto("/administration/compliance");
  await expect(page.getByTestId("competency-issue-form")).toBeVisible();
  await expect(page.getByTestId("protocol-draft-form")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("lab owner sees only active, in-scope protocol choices in operational flows", async ({
  page,
}) => {
  await signIn(page, SEEDED_ROLE_QA_EMAILS.labOwner);

  await page.goto("/administration/compliance");
  await expect(page.getByTestId("protocol-draft-form")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/breeding");
  await page.getByRole("button", { name: /^Create setup:/ }).click();
  const breedingOptions = await page
    .getByTestId("breeding-create-protocol")
    .locator("option")
    .allTextContents();
  expect(breedingOptions.join(" ")).toContain("QA-ACTIVE-6");
  expect(breedingOptions.join(" ")).not.toContain("QA-EXPIRED");
  expect(breedingOptions.join(" ")).not.toContain("QA-SUSPENDED");
  await expectNoHorizontalOverflow(page);

  await page.goto("/experiments");
  await page.getByRole("button", { name: /^New experiment:/ }).click();
  const experimentOptions = await page
    .locator('select[name="protocolAuthorizationId"]')
    .first()
    .locator("option")
    .allTextContents();
  expect(experimentOptions.join(" ")).toContain("QA-ACTIVE-6");
  expect(experimentOptions.join(" ")).not.toContain("QA-EXPIRED");
  await expectNoHorizontalOverflow(page);

  await page.goto("/cages/intake?mode=purchase");
  await page.getByRole("combobox", { name: "Strain row 1" }).selectOption(
    "strain-creer",
  );
  const intakeOptions = await page
    .locator('select[name="protocolAuthorizationId"]')
    .locator("option")
    .allTextContents();
  expect(intakeOptions.join(" ")).toContain("QA-ACTIVE-6");
  expect(intakeOptions.join(" ")).not.toContain("QA-WRONG-PROCEDURE");
  await expectNoHorizontalOverflow(page);
});

test("lab viewer can read the compliance boundary without mutation controls", async ({
  page,
}) => {
  await signIn(page, SEEDED_ROLE_QA_EMAILS.labViewer);
  await page.goto("/administration/compliance");
  await expect(page.getByText("No administration duty assigned")).toBeVisible();
  await expect(page.getByTestId("protocol-draft-form")).toHaveCount(0);
  await expect(page.getByTestId("competency-issue-form")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Record decision" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.goto("/breeding");
  await expect(page.getByTestId("breeding-create-form")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
