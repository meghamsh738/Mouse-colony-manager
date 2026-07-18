import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SUPPORTED_BILLING_CURRENCY_CODES } from "@/lib/currency";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "prisma/migrations/0026_invoice_governance/migration.sql"),
  "utf8",
);
const verifier = fs.readFileSync(
  path.resolve(process.cwd(), "scripts/verify-billing-governance.ts"),
  "utf8",
);
const seedDatabase = fs.readFileSync(path.resolve(process.cwd(), "prisma/seed-database.ts"), "utf8");

describe("invoice governance migration", () => {
  it("applies the governance changes atomically", () => {
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toContain('CREATE TYPE "InvoiceAdjustmentType"');
    expect(migration).toContain('CREATE TABLE "InvoiceAdjustment"');
    expect(migration).toContain('CREATE SEQUENCE "InvoiceFinalNumber_seq"');
    expect(migration).toContain('CREATE UNIQUE INDEX "InvoiceAdjustment_reversesAdjustmentId_key"');
    expect(migration).toContain('ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
    expect(migration.indexOf('LOCK TABLE "Invoice"')).toBeLessThan(migration.indexOf("DO $$"));
    expect(migration).toContain("IN SHARE ROW EXCLUSIVE MODE");
  });

  it("snapshots charge-category labels before terminal invoice governance", () => {
    expect(migration).toContain('UPDATE "InvoiceLineItem" line');
    expect(migration).toContain("category.name || ' [' || category.code || ']'");
    expect(verifier).toContain("Terminal invoice category snapshot changed after the live rate was renamed");
  });

  it("uses exact UTC service days without silent rounding", () => {
    expect(migration).toContain("fractional UTC service days");
    expect(migration).toContain("Cage charge periods with fractional UTC service days");
    expect(migration).toContain('CREATE TRIGGER "CageChargePeriod_utc_boundary_guard"');
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON "CageChargePeriod"');
    expect(migration).toContain("Cage charge periods must use exact UTC calendar-day boundaries");
    expect(migration).toContain('"endedAt" <= "startedAt"');
    expect(migration).toContain('NEW."endedAt" <= NEW."startedAt"');
    expect(migration).toContain('CHECK ("endedAt" IS NULL OR "endedAt" > "startedAt")');
    expect(migration).toContain("date_trunc('day', NEW.\"serviceStart\")");
    expect(migration).toContain("EXTRACT(EPOCH FROM (NEW.\"serviceEnd\" - NEW.\"serviceStart\"))::bigint / 86400");
    expect(migration.toUpperCase()).not.toContain("CEIL(");
    expect(verifier).toContain('expectRejected("fractional charge-period insert"');
  });

  it("rejects malformed billing currencies before they can break rendering", () => {
    expect(migration).toContain('"CageChargeCategory_currency_code_format_check"');
    expect(migration).toContain('"CageChargePeriod_currency_code_format_check"');
    expect(migration).toContain('"Invoice_currency_code_format_check"');
    expect(migration).toContain('CREATE FUNCTION "is_supported_billing_currency"');
    expect(migration).toContain('NOT "is_supported_billing_currency"("currencyCode")');
    expect(migration).toContain('CHECK ("is_supported_billing_currency"("currencyCode"))');
    const sqlCurrencyList = migration
      .slice(migration.indexOf("ARRAY["), migration.indexOf("]::TEXT[]"))
      .match(/'([A-Z]{3})'/g)
      ?.map((value) => value.slice(1, -1));
    expect(sqlCurrencyList).toEqual([...SUPPORTED_BILLING_CURRENCY_CODES]);
    expect(verifier).toContain('currencyCode: "ZZZ"');
    expect(verifier).toContain('expectRejected("zero-length charge-period insert"');
  });

  it("makes charge periods and adjustments append-only", () => {
    expect(migration).toContain('CREATE TRIGGER "CageChargePeriod_append_only_guard"');
    expect(migration).toContain('CREATE TRIGGER "CageChargePeriod_truncate_guard"');
    expect(migration).toContain('CREATE TRIGGER "InvoiceAdjustment_append_only_guard"');
    expect(migration).toContain('CREATE TRIGGER "InvoiceAdjustment_truncate_guard"');
    expect(migration).toContain("A cage charge period may only be closed once");
    expect(migration).toContain("Invoice adjustments are append-only");
    expect(migration).toContain("TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'");
    expect(verifier).toContain('expectRejected("closed charge period mutation"');
    expect(verifier).toContain('expectRejected("adjustment update"');
    expect(verifier).toContain('expectRejected("adjustment delete"');
  });

  it("defers authoritative total checks until the transaction boundary", () => {
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "Invoice_financial_totals_guard"');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "InvoiceLineItem_financial_totals_guard"');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "InvoiceAdjustment_financial_totals_guard"');
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration).toContain('"totalCents" = "subtotalCents" + "adjustmentTotalCents"');
    expect(seedDatabase).toContain("await prisma.$transaction(async (tx) => {");
    expect(seedDatabase).toContain("await tx.invoice.createMany");
    expect(seedDatabase).toContain("await tx.invoiceLineItem.createMany");
    expect(seedDatabase).toContain("prisma.invoiceAdjustment.deleteMany()");
  });

  it("binds terminal transitions to immutable numbers, totals, and next versions", () => {
    expect(migration).toContain("A final invoice number is immutable");
    expect(migration).toContain("NEW.version <> OLD.version + 1");
    expect(migration).toContain("Finalization may only assign terminal metadata and the next immutable invoice version");
    expect(migration).toContain("A finalized invoice can only transition to void without changing its financial history");
    expect(verifier).toContain('expectRejected("final number mutation"');
    expect(verifier).toContain("Final invoice number did not use the immutable facility sequence");
  });
});
