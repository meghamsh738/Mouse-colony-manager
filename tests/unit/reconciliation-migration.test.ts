import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "prisma/migrations/0041_safe_operational_reconciliation/migration.sql"), "utf8");

describe("M16 operational reconciliation migration", () => {
  it("creates guarded state and append-only evidence families", () => {
    for (const table of [
      "ShipmentManifest", "ShipmentReceiptObservation", "ShipmentHealthEvidence", "ShipmentHealthDecision", "ShipmentReconciliationSummary",
      "CensusSession", "CensusObservation", "CensusDiscrepancy", "CageCapacityException",
      "TransferCustodyEvent", "TransferCustodyExpectedItem", "TransferCustodyItemEvidence", "TransferCustodyReconciliation", "OperationalReconciliationEvent",
    ]) expect(sql).toContain(`CREATE TABLE "${table}"`);
    expect(sql).toContain("M16 operational evidence is append-only");
    expect(sql).toContain("M16 transfer custody evidence is append-only");
    expect(sql).toContain("cannot be truncated");
  });

  it("wraps every 0041 statement in one explicit transaction", () => {
    const executable = sql.replace(/^--.*$/gm, "").trim();
    expect(executable.startsWith("BEGIN;")).toBe(true);
    expect(executable.endsWith("COMMIT;")).toBe(true);
    expect((executable.match(/\bBEGIN;/g) ?? [])).toHaveLength(1);
    expect((executable.match(/\bCOMMIT;/g) ?? [])).toHaveLength(1);
  });

  it("binds evidence, lifecycle events, audits, and successful receipts in both directions", () => {
    expect(sql).toContain("M16 evidence requires the exact same-receipt command context");
    expect(sql).toContain("M16 custody event requires exact same-receipt transfer aggregate parity");
    expect(sql).toContain("M16 event requires exact succeeded same-transaction receipt parity");
    expect(sql).toContain("Successful M16 command requires exactly one same-receipt lifecycle event");
    expect(sql).toContain("M16 state/evidence requires exact deferred event, audit, and receipt pairing");
    expect(sql).toContain("Successful M16 command requires its exact guarded state/evidence effect");
    expect(sql).toContain("a.\"actorId\" = receipt.\"actorId\"");
    expect(sql).toContain("mcm_m16_validate_cross_association");
    expect(sql).toContain("session, observation, and lab must be the exact same evidence");
    expect(sql).toContain("summary session, manifest, and lab must be the exact same receipt");
    expect(sql).toContain("Capacity exception cage must belong to the exact lab");
    expect(sql).toContain("reconciliation event, request, and destination lab must be the exact same transfer");
    expect(sql).toContain("Successful shipment confirmation requires exact manifest, receipt summary, intake batch, quarantine case, and lab lineage");
    expect(sql).toContain("Custody expected item must freeze the exact active transfer item, animal, and identifier");
    expect(sql).toContain("Custody receipt item must match the exact frozen dispatched transfer item");
    expect(sql).toContain('NEW."expectedItemCount" <> active_transfer_count');
    expect(sql).toContain("expected_count <> active_transfer_count");
    expect(sql).toContain('WHERE "requestId" = NEW."requestId" AND active = TRUE');
    expect(sql).toContain('"animalId" TEXT NOT NULL REFERENCES "Animal"');
    expect(sql).toContain("Census in-room outcome requires a cage in the exact session room");
    expect(sql).toContain("Census wrong-location outcome requires an authorized cage outside the session room");
  });

  it("keeps custody packets privacy allowlisted and veterinary release duty-bound", () => {
    expect(sql).toContain("'healthStatus','quarantineStatus','treatmentStatus','licenceStatus','safetyStatus'");
    expect(sql).toContain("designated_veterinarian");
    expect(sql).toContain("Fresh current identity assurance is required for quarantine release");
    expect(sql).toContain("Health evidence recorder cannot independently certify compatibility");
    expect(sql).toContain("M16 quarantine release evidence is sealed after first assignment");
    expect(sql).toContain("mcm_m16_clinical_event_evidence_parity");
    expect(sql).toContain('d."assessedByAuthzVersion" = NEW."actorAuthzVersion"');
    expect(sql).toContain("Health decision event must exactly match immutable clinical decision evidence");
    expect(sql).toContain("Quarantine release event must exactly match immutable clinical release evidence");
    expect(sql).not.toContain("DROP TABLE \"Animal\"");
  });
});
