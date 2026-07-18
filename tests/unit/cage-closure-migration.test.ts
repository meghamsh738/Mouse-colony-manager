import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "prisma/migrations/0014_cage_closure_billing_cutoff/migration.sql"),
  "utf8",
);
const verifier = fs.readFileSync(
  path.resolve(process.cwd(), "scripts/verify-cage-closure-migration.ts"),
  "utf8",
);

function functionBody(name: string, nextMarker: string) {
  return migration.slice(migration.indexOf(`CREATE FUNCTION "${name}"`), migration.indexOf(nextMarker));
}

describe("cage closure billing-cutoff migration", () => {
  it("applies the full migration atomically", () => {
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toContain('LOCK TABLE "Cage", "Animal", "CageChargePeriod", "Invoice", "InvoiceLineItem"');
    expect(migration).toContain("IN SHARE ROW EXCLUSIVE MODE");
    expect(migration.indexOf("LOCK TABLE")).toBeLessThan(migration.indexOf("DO $$"));
  });

  it("ties one closure to one cage and one final charge period", () => {
    expect(migration).toContain('CREATE TABLE "CageClosure"');
    expect(migration).toContain('CREATE UNIQUE INDEX "CageClosure_cageId_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "CageClosure_chargePeriodId_key"');
    expect(migration).toContain('CONSTRAINT "CageClosure_cutoff_matches_closed_at_check" CHECK ("billingCutoffAt" = "closedAt")');
    expect(migration).toContain('FOREIGN KEY ("cageId", "labId") REFERENCES "Cage"("id", "labId")');
    expect(migration).toContain('CREATE UNIQUE INDEX "CageChargePeriod_id_cageId_labId_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "CageChargePeriod_id_cageId_categoryId_key"');
    expect(migration).toContain('FOREIGN KEY ("chargePeriodId", "cageId", "labId") REFERENCES "CageChargePeriod"(id, "cageId", "labId")');
    expect(migration).toContain('FOREIGN KEY ("chargePeriodId", "cageId", "categoryId") REFERENCES "CageChargePeriod"(id, "cageId", "categoryId")');
    expect(migration).toContain("Closed cages still marked active must be reconciled");
    expect(migration).toContain("Invoice service beyond a legacy cage closure cutoff must be reconciled");
    expect(migration).toContain("A legacy closed cage final charge period must end exactly at its derived closure cutoff");
    expect(migration).toContain("A new cage closure requires its actor-bound cage-closure review snapshot");
    expect(migration).toContain("The cage closure does not match its immutable reviewed payload");
    expect(migration).toContain("The cage version no longer matches its immutable closure review");
    expect(migration).toContain("A cage closure requires its active version-bound command receipt");
    expect(migration).toContain("Cage closure movements do not match the immutable reviewed assignment plan");
    expect(migration).toContain('animal."currentCageId" = movement."toCageId"');
    expect(migration).toContain("NEW.\"closedAt\" IS DISTINCT FROM DATE_TRUNC('day', NEW.\"closedAt\")");
    expect(migration).toContain("expectedChargePeriodStartedAt");
  });

  it("enforces coherent and unambiguous charge periods", () => {
    expect(migration).toContain('CONSTRAINT "CageChargePeriod_date_order_check"');
    expect(migration).toContain('CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt")');
    expect(migration).toContain('CREATE UNIQUE INDEX "CageChargePeriod_one_open_per_cage_key"');
    expect(migration).toContain('WHERE "endedAt" IS NULL');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "CageChargePeriod_current_lab_guard"');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "Cage_current_charge_lab_guard"');
    expect(migration).toContain("An open cage charge period must belong to the cage current lab");
    expect(migration).toContain("Cages with overlapping charge periods must be reconciled");
    expect(migration).toContain("Cage charge periods cannot overlap");
    expect(migration).toContain("Charge periods referenced by terminal invoices cannot be deleted");
    expect(migration).toContain("Charge-period changes cannot invalidate terminal invoice service history");
    expect(migration).toContain('WHERE cage.id IN (target_cage_id, previous_cage_id)');
    expect(migration).toContain('ORDER BY cage.id');
    expect(migration).toContain('FOR UPDATE');
    expect(verifier).toContain("overlapping cage charge periods");
    expect(verifier).toContain("verifyClosureChargePeriodRace");
    expect(verifier).toContain("reserveFacilityIdentifier");
    expect(verifier).toContain("Cage-closure-vs-charge-period-INSERT race");
    expect(verifier).toContain("Cage-closure-vs-movement-INSERT race");
  });

  it("checks the final cage row when the deferred closure trigger fires", () => {
    const body = functionBody("require_explicit_cage_closure", 'CREATE CONSTRAINT TRIGGER "Cage_explicit_closure_required"');

    expect(body).toContain('SELECT status, active INTO current_status, current_active');
    expect(body).toContain('FROM "Cage"');
    expect(body).toContain("current_status = 'closed'");
    expect(body).toContain("current_status <> 'closed' OR current_active");
    expect(body).not.toContain("NEW.status = 'closed'");
    expect(migration).toContain("cannot be reopened or operationally reassigned");
  });

  it("makes closures and closed-cage billing append-only outside disposable schemas", () => {
    const closureHistory = functionBody("protect_cage_closure_history", 'CREATE TRIGGER "CageClosure_append_only"');
    const billingHistory = functionBody("protect_closed_cage_billing_history", 'CREATE TRIGGER "CageChargePeriod_closed_cage_guard"');

    for (const body of [closureHistory, billingHistory]) {
      expect(body).toContain("current_setting('mcm.allow_destructive_seed', true) = 'true'");
      expect(body).toContain("TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'");
      expect(body).not.toContain("current_database() ~*");
    }
    expect(closureHistory).toContain("Cage closures are append-only");
    expect(billingHistory).toContain("Charge periods for a closed cage are immutable");
    expect(billingHistory).toContain('"cageId" IN (OLD."cageId", NEW."cageId")');
    expect(migration).toContain("Movement history linked to a closed cage is immutable");
    const movementHistory = functionBody("protect_closed_cage_movement_history", 'CREATE TRIGGER "AnimalMovement_closed_cage_guard"');
    expect(movementHistory).toContain("affected_cage_ids");
    expect(movementHistory).toContain('WHERE cage.id = ANY(affected_cage_ids)');
    expect(movementHistory).toContain('ORDER BY cage.id');
    expect(movementHistory).toContain('FOR UPDATE');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "Animal_active_cage_assignment_guard"');
    expect(migration).toContain("Animals can only be assigned to an active operational cage in their owning lab");
  });

  it("prevents stale invoice drafts from crossing an immutable cutoff", () => {
    expect(migration).toContain("Draft or finalized invoice service extends beyond the cage billing cutoff");
    expect(migration).toContain('CREATE TRIGGER "Invoice_charge_period_finalization_guard"');
    expect(migration).toContain("Invoice line items no longer match current cage charge periods");
    expect(migration).toContain("NEW.status IN ('finalized', 'void')");
    expect(migration).toContain("reconcile the draft before recording a terminal state");
    expect(migration).toContain("Invoice subtotal does not match its immutable line-item calculation");
    expect(migration).toContain("Invoice finalization requires its actor and timestamp without void metadata");
    expect(migration).toContain("Invoice service must be complete before finalization");
    expect(migration).toContain('CREATE TRIGGER "InvoiceLineItem_finalized_guard"');
    expect(migration).toContain("Finalized or void invoice line items are immutable");
    expect(migration).toContain("Invoice line items must match their locked draft invoice and cage charge period");
    expect(migration).toContain('FOR UPDATE OF invoice');
    expect(migration).toContain('CREATE TRIGGER "Invoice_terminal_delete_guard"');
    expect(migration).toContain("Finalized or void invoices are append-only and cannot be deleted");
    expect(migration).toContain("A void invoice is immutable");
    expect(migration).toContain("Voiding requires an actor, timestamp, reason, and unchanged financial history");
    expect(migration).toContain("Existing finalized or void invoices must have internally consistent immutable billing history");
    expect(migration).toContain('invoice."finalizedAt" IS NOT NULL');
    expect(migration).toContain('invoice."periodEnd" > invoice."finalizedAt"');
    expect(verifier).toContain("premature finalized invoice");
    expect(migration).toContain('(invoice."finalizedAt" IS NULL) <> (invoice."finalizedById" IS NULL)');
    expect(migration).toContain("OLD.status = 'draft' AND (NEW.\"finalizedAt\" IS NOT NULL OR NEW.\"finalizedById\" IS NOT NULL)");
    const invoiceLineHistory = functionBody("validate_invoice_line_write", 'CREATE TRIGGER "InvoiceLineItem_finalized_guard"');
    expect(invoiceLineHistory).toContain("current_setting('mcm.allow_destructive_seed', true) = 'true'");
    expect(invoiceLineHistory).toContain("TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'");
  });
});
