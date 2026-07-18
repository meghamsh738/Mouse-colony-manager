import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const billingWrite = fs.readFileSync(path.resolve(process.cwd(), "src/lib/billing-write.ts"), "utf8");
const billingActions = fs.readFileSync(path.resolve(process.cwd(), "src/app/billing/actions.ts"), "utf8");
const notificationCatalog = fs.readFileSync(path.resolve(process.cwd(), "src/lib/notification-catalog.ts"), "utf8");

function exportedFunctionBody(name: string, nextName: string) {
  const start = billingWrite.indexOf(`export async function ${name}`);
  const end = billingWrite.indexOf(`export async function ${nextName}`, start + 1);
  return billingWrite.slice(start, end < 0 ? undefined : end);
}

describe("billing command wiring", () => {
  it.each([
    ["upsertCageChargeCategory", "generateLabInvoice", "billing:manage"],
    ["generateLabInvoice", "addInvoiceAdjustment", "billing:generate"],
    ["addInvoiceAdjustment", "finalizeInvoice", "billing:finalize"],
    ["finalizeInvoice", "voidInvoice", "billing:finalize"],
  ])("routes %s through an idempotent capability-bound command", (name, nextName, capability) => {
    const body = exportedFunctionBody(name, nextName);
    expect(body).toContain("executeIdempotentCommand");
    expect(body).toContain(`requiredCapability: "${capability}"`);
    expect(body).toContain("idempotencyKey:");
    expect(body).toContain("requestId:");
  });

  it("uses optimistic invoice versions for adjustments and terminal transitions", () => {
    for (const [name, nextName] of [
      ["addInvoiceAdjustment", "finalizeInvoice"],
      ["finalizeInvoice", "voidInvoice"],
      ["voidInvoice", ""],
    ]) {
      expect(exportedFunctionBody(name, nextName)).toContain("expectedVersion: input.expectedVersion");
    }
  });

  it("uses optimistic versions for cage-rate edits", () => {
    const body = exportedFunctionBody("upsertCageChargeCategory", "generateLabInvoice");
    expect(body).toContain("expectedVersion: input.expectedVersion");
    expect(body).toContain("version: { increment: 1 }");
    expect(body).toContain('code: "stale_conflict"');
    expect(body).toContain("resultingVersion: saved.version");
    expect(body).toContain("normalizeCurrencyCode(input.currencyCode)");
    expect(billingActions).toContain("expectedVersion: z.coerce.number().int().nonnegative()");
    expect(billingActions).toContain("refine(isSupportedCurrencyCode)");
  });

  it("materializes lab-member notifications for finalization and voiding", () => {
    expect(exportedFunctionBody("finalizeInvoice", "voidInvoice")).toContain("materializeInvoiceNotification");
    expect(exportedFunctionBody("voidInvoice", "")).toContain("materializeInvoiceNotification");
    expect(notificationCatalog).toContain('audiencePolicy: "lab_members_only"');
    expect(notificationCatalog).toContain('alertTypes: ["invoice_finalized", "invoice_voided"]');
  });

  it("requires billing finalization authority at the server-action boundary", () => {
    expect(billingActions.match(/requireUser\(\{ capability: "billing:finalize" \}\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(billingActions.match(/expectedVersion: z\.coerce\.number\(\)\.int\(\)\.positive\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(billingActions.match(/labId: z\.string\(\)\.trim\(\)\.min\(1\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(billingActions).toContain("finalizeInvoice(parsed.data, user)");
    expect(billingActions).toContain("voidInvoice(parsed.data, user)");
    expect(billingActions).toContain("addInvoiceAdjustment(parsed.data, user)");
  });
});
