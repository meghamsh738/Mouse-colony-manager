import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("prisma/migrations/0040_controlled_corrections/migration.sql", "utf8");
const writes = readFileSync("src/lib/correction-write.ts", "utf8");

describe("M15 controlled correction contract", () => {
  it("wraps the additive migration atomically", () => {
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("seals source-preserving supersession, reconciliation, lifecycle, and audit parity", () => {
    expect(migration).toContain("correction evidence is immutable");
    expect(migration).toContain("correction evidence cannot be truncated");
    expect(migration).toContain("exact same-receipt lifecycle, audit, supersession, and reconciliation parity");
    expect(migration).toContain("correction lifecycle event requires its exact same-receipt request mutation");
    expect(migration).toContain("correction application evidence requires an exact same-receipt pending-to-applied transition");
    expect(migration).toContain('"CorrectionLifecycleEvent_reverse_pair_guard"');
    expect(migration).toContain('"CorrectionSupersession_reverse_pair_guard"');
    expect(migration).toContain('"CorrectionReconciliation_reverse_pair_guard"');
    expect(migration).toContain('audit."actorId" = expected_actor');
    expect(migration).toContain('receipt."transactionId" = txid_current()');
    expect(migration).toContain('receipt."aggregateType" = \'correction_request\'');
    expect(migration).toContain("mcm_identity_assurance_snapshot_is_current");
    expect(migration).toContain('"physicalMutationRequired" = false');
    expect(migration).toContain('request."proposedCorrection" ? target_field');
    expect(migration).toContain('"SampleRecord_corrected_field_guard"');
    expect(migration).toContain('"Litter_corrected_field_guard"');
    expect(migration).toContain('"LabTransferRequest_corrected_field_guard"');
    expect(migration).toContain('"AnimalMovement_correction_source_immutable"');
    expect(writes).toContain("canonicalJsonHash(latest.originalSnapshot)");
    expect(writes).not.toContain("tx.animal.update");
    expect(writes).not.toContain("tx.litter.update");
    expect(writes).not.toContain("tx.sampleRecord.update");
  });

  it("requires independent current Data Steward evidence and keeps blocked requests unapplied", () => {
    expect(migration).toContain("NEW.\"decidedById\" = OLD.\"requestedById\"");
    expect(migration).toContain("data_steward");
    expect(migration).toContain('NEW."deciderAuthzVersion" IS DISTINCT FROM (SELECT "actorAuthzVersion"');
    expect(writes).toContain("Blocked structural or physical corrections cannot be approved or applied.");
    expect(writes).toContain("sourceRecordMutated: false");
  });
});
