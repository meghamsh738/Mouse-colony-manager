import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { seedRoleQaDatabase } from "../../prisma/seed-role-qa";
import { getActorCapabilities } from "../../src/lib/capabilities";
import { executeDecideCorrectionRequest, executeSubmitCorrectionRequest } from "../../src/lib/correction-write";
import { prisma } from "../../src/lib/prisma";
import { SEEDED_ROLE_QA_EMAILS } from "../../src/lib/seed-metadata";
import type { ResolvedActor } from "../../src/lib/session";

const BROWSER_LITTER_ID = "m15-browser-corrected-litter";
const BROWSER_SAMPLE_ID = "sample-001";

async function correctionActor(userId: string, activeLabId: string | null, duties: ResolvedActor["activeDuties"]): Promise<ResolvedActor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const identity = await prisma.externalIdentityLink.findFirstOrThrow({ where: { userId, active: true } });
  const canonicalRole = user.role === "facility_admin" ? "facility_admin" as const : "lab_user" as const;
  const membership = activeLabId ? await prisma.labMembership.findFirstOrThrow({ where: { userId, labId: activeLabId, active: true }, include: { lab: true } }) : null;
  const activeMembership = membership ? { labId: membership.labId, labName: membership.lab.name, labCode: membership.lab.code, role: membership.role } : null;
  return {
    id: user.id, email: user.email, name: user.name, databaseRole: user.role,
    role: canonicalRole === "facility_admin" ? "admin" : "animal_staff", canonicalRole,
    authzVersion: user.authzVersion, authMethod: "synthetic_mfa", assurance: "synthetic_mfa",
    authenticatedAt: new Date().toISOString(), identityLinkId: identity.id, activeDuties: duties,
    activeLabId, activeMembership, memberships: activeMembership ? [activeMembership] : [],
    capabilities: [...getActorCapabilities({ canonicalRole, activeMembership, activeDuties: duties })],
  };
}

async function applyBrowserCorrectionFixture() {
  const manager = await correctionActor("user-lab-manager-qa", "lab-microglia", []);
  const steward = await correctionActor("user-facility-admin-approver-qa", null, ["training_administrator", "data_steward"]);
  const setup = await prisma.breedingSetup.findFirstOrThrow({ where: { labId: "lab-microglia", status: "active" }, select: { id: true } });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.litter.create({ data: { id: BROWSER_LITTER_ID, breedingSetupId: setup.id, birthDate: new Date("2026-03-20T00:00:00.000Z"), litterSizeBirth: 4 } });
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
  });
  const sample = await prisma.sampleRecord.findUniqueOrThrow({ where: { id: BROWSER_SAMPLE_ID }, select: { collectedAt: true } });
  for (const command of [
    { domain: "litter_birth" as const, targetEntityId: BROWSER_LITTER_ID, sourceEventAt: new Date("2026-03-20T00:00:00.000Z"), proposedCorrection: { birthDate: "2026-03-10T00:00:00.000Z" } },
    { domain: "biosample" as const, targetEntityId: BROWSER_SAMPLE_ID, sourceEventAt: sample.collectedAt, proposedCorrection: { collectedAt: "2026-09-30T12:00:00.000Z", notes: "Browser corrected biosample marker." } },
  ]) {
    const submitted = await executeSubmitCorrectionRequest({ actor: manager, idempotencyKey: `browser-submit-${command.domain}-${randomUUID()}`, requestId: `browser-submit-request-${randomUUID()}`, command: {
      labId: "lab-microglia", domain: command.domain, targetEntityId: command.targetEntityId, sourceEventAt: command.sourceEventAt,
      reason: "Synthetic browser projection fixture.", proposedCorrection: command.proposedCorrection,
    } });
    if (!submitted.ok || !submitted.result || typeof submitted.result !== "object" || Array.isArray(submitted.result)) throw new Error("Could not create browser correction fixture.");
    const correctionId = String((submitted.result as { correctionId: unknown }).correctionId);
    const approved = await executeDecideCorrectionRequest({ actor: steward, correctionId, expectedVersion: 1, decision: "approve", decisionReason: "Synthetic browser Data Steward approval.", idempotencyKey: `browser-approve-${command.domain}-${randomUUID()}`, requestId: `browser-approve-request-${randomUUID()}` });
    if (!approved.ok) throw new Error(`Could not approve browser correction fixture: ${approved.message}`);
  }
}

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
  await applyBrowserCorrectionFixture();
});

test("requesters and an independent Data Steward use a responsive fail-closed correction workflow", async ({ page }) => {
  const blockedReason = "Synthetic browser QA request for a structural weaning correction.";

  await signIn(page, SEEDED_ROLE_QA_EMAILS.labManager);
  await page.goto("/");
  await expect(page.getByTestId(`dashboard-litter-correction-${BROWSER_LITTER_ID}`)).toContainText("corrected");
  await page.goto(`/cages/intake?mode=wean&litterId=${BROWSER_LITTER_ID}`);
  await expect(page.getByTestId(`intake-litter-correction-${BROWSER_LITTER_ID}`)).toBeVisible();
  await page.goto("/samples?pageSize=1");
  await expect(page.locator("p:visible, dd:visible").filter({ hasText: "Browser corrected biosample marker." }).first()).toBeVisible();
  await expect(page.locator(`[data-testid="sample-correction-${BROWSER_SAMPLE_ID}"]:visible, [data-testid="sample-correction-mobile-${BROWSER_SAMPLE_ID}"]:visible`)).toHaveCount(1);
  await page.goto("/workbook?section=biosamples&sheet=all&search=Browser%20corrected%20biosample%20marker");
  await expect(page.locator(`[data-testid="workbook-sample-correction-${BROWSER_SAMPLE_ID}"]:visible, [data-testid="workbook-sample-correction-mobile-${BROWSER_SAMPLE_ID}"]:visible`)).toHaveCount(1);
  await expectNoHorizontalOverflow(page);

  await page.goto("/corrections");
  await expect(page.getByTestId("correction-workspace")).toHaveAttribute("data-correction-access", "requester");
  await expect(page.getByTestId("correction-policy-marker")).toContainText("A blocked request is never an applied correction");
  await expect(page.getByTestId("correction-effective-projection").filter({ hasText: "Synthetic corrected movement reason" })).toContainText("Synthetic corrected movement reason");
  await expect(page.getByTestId("correction-reconciliation").filter({ hasText: "without source-row or physical-state mutation" }).first()).toBeVisible();
  await page.goto("/animals/animal-003");
  await expect(page.getByText("Synthetic corrected movement reason.")).toBeVisible();
  await expect(page.getByTestId("timeline-correction-movement-move-001")).toContainText("Corrected metadata");
  await expectNoHorizontalOverflow(page);

  await page.goto("/corrections");

  const requestForm = page.getByTestId("correction-request-form");
  await requestForm.getByTestId("correction-domain-picker").selectOption("litter_weaning");
  const targetValue = await requestForm.getByTestId("correction-target-picker").locator("option").evaluateAll((options) =>
    options.find((option) => option.textContent?.includes("litter-001"))?.getAttribute("value") ?? "",
  );
  expect(targetValue).not.toBe("");
  await requestForm.getByTestId("correction-target-picker").selectOption(targetValue);
  await requestForm.locator('textarea[name="reason"]').fill(blockedReason);
  await requestForm.getByRole("button", { name: "Submit correction request" }).click();
  await expect(page.getByTestId("correction-notice")).toContainText(/recorded but is blocked from approval/i, { timeout: 30_000 });
  await expect(page).toHaveURL(/notice=request-blocked/);
  await expectNoHorizontalOverflow(page);
  await page.goto("/breeding");
  await expect(page.getByTestId("litter-correction-litter-001")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await signIn(page, SEEDED_ROLE_QA_EMAILS.facilityAdminApprover);
  await page.goto("/corrections");
  await expect(page.getByTestId("correction-workspace")).toHaveAttribute("data-correction-access", "data_steward");
  const blockedCard = page.getByTestId("correction-card").filter({ hasText: blockedReason });
  await expect(blockedCard.getByTestId("correction-block-code")).toContainText("generated_weaning_state_requires_policy");
  await expect(blockedCard.getByRole("button", { name: "Apply metadata supersession" })).toBeDisabled();
  await expect(blockedCard).toContainText("not a successful correction");
  await expectNoHorizontalOverflow(page);

  await signIn(page, SEEDED_ROLE_QA_EMAILS.labViewer);
  await page.goto("/corrections");
  await expect(page).toHaveURL(/\/access-denied/);
});
