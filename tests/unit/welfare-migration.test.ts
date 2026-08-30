import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("prisma/migrations/0039_veterinary_welfare_cases/migration.sql", "utf8");
const writes = readFileSync("src/lib/welfare-write.ts", "utf8");
const reads = readFileSync("src/lib/welfare-read.ts", "utf8");

describe("M14 veterinary welfare contract", () => {
  it("wraps the entire additive migration in one replayable transaction", () => {
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("enforces one lab-owned subject, a visible policy marker, and one active case", () => {
    expect(migration).toContain('"WelfareCase_subject_exactly_one_check"');
    expect(migration).toContain("welfare animal subject does not belong to case lab");
    expect(migration).toContain("synthetic-fail-closed-v1");
    expect(migration).toContain('"WelfareCase_active_animal_key"');
    expect(migration).toContain('"WelfareCase_active_cage_key"');
  });

  it("binds every clinical write to an idempotent receipt and immutable evidence", () => {
    expect(migration).toContain("welfare write receipt, actor, command, aggregate, or lab mismatch");
    expect(migration).toContain('receipt."transactionId" = txid_current()');
    expect(migration).toContain('receipt."aggregateType" = \'welfare_case\'');
    expect(migration).toContain("mcm_identity_assurance_snapshot_is_current");
    expect(migration).toContain("welfare event evidence is stale or mismatched");
    expect(migration).toContain("welfare triage actor is mismatched");
    expect(migration).toContain("welfare treatment approval actor is mismatched");
    expect(migration).toContain("welfare escalation resolution actor is mismatched");
    expect(migration).toContain("administration requires an approved or active treatment order");
    expect(migration).toContain("welfare treatment writes require a current designated veterinarian receipt");
    expect(migration).toContain("welfare case closure requires a current designated veterinarian receipt");
    expect(migration).toContain("terminal welfare cases require settled escalations and treatment orders");
    expect(migration).toContain('CREATE TRIGGER "WelfareObservation_immutable"');
    expect(migration).toContain('CREATE TRIGGER "WelfareAdministration_immutable"');
    expect(migration).toContain('CREATE TRIGGER "WelfareCaseEvent_immutable"');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "WelfareCase_event_pair"');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "WelfareTreatmentOrder_event_pair"');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "WelfareEscalation_event_pair"');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "WelfareObservation_event_pair"');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "WelfareAdministration_event_pair"');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "WelfareCaseEvent_clinical_row_pair"');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "WelfareCaseEvent_domain_mutation_pair"');
    expect(migration).toContain("welfare observation requires one exact same-receipt lifecycle event");
    expect(migration).toContain("welfare administration requires one exact same-receipt lifecycle event");
    expect(migration).toContain("welfare lifecycle event requires one exact same-receipt clinical row");
    expect(migration).toContain("welfare lifecycle event requires one exact same-receipt domain mutation");
    expect(migration).toContain("welfare lifecycle event requires the exact same-receipt case mutation");
    expect(migration).toContain('mcm_welfare_expected_command(event."eventType", event.detail)');
    expect(migration).toContain("mcm_welfare_event_transition_valid");
    expect(migration).not.toContain("WHEN 'treatment_started'");
    expect(migration).toContain("one exact receipt-event-audit record");
    expect(migration).toContain('audit."requestId" = receipt."requestId"');
    expect(migration).toContain('audit."commandType" = receipt."commandType"');
    expect(writes.match(/executeIdempotentCommand\(/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("preserves revocable duty history without a mutable composite foreign key", () => {
    expect(migration).toContain('FOREIGN KEY ("dutyAssignmentId") REFERENCES "FacilityDutyAssignment"(id)');
    expect(migration).not.toContain('FOREIGN KEY ("dutyAssignmentId", "dutyAssignmentVersion")');
    expect(migration).toContain('duty.version = NEW."dutyAssignmentVersion"');
  });

  it("seals clinical evidence, restricts cancellation, and rejects truncate", () => {
    expect(migration).toContain("welfare triage evidence is immutable");
    expect(migration).toContain("welfare treatment approval evidence is immutable");
    expect(migration).toContain("welfare escalation acknowledgement evidence is immutable");
    expect(migration).toContain("only a pristine open untriaged welfare case can be cancelled");
    expect(migration.match(/_truncate_guard/g)?.length).toBe(6);
  });

  it("does not allow base roles to substitute for a clinical duty", () => {
    expect(writes).toContain('["designated_veterinarian", "welfare_officer"]');
    expect(writes).toContain('["designated_veterinarian"]');
    expect(writes).toContain("isElevatedIdentityContextCurrent");
    expect(writes).not.toContain('canonicalRole === "facility_admin"');
    expect(writes).not.toContain('canonicalRole === "cmu_staff"');
  });

  it("keeps private observations, medication, dose, and closure reasons out of the officer projection", () => {
    const officerBranch = reads.slice(reads.indexOf("if (!isVeterinarian)"), reads.indexOf("const [cases, [animalOptions, cageOptions]]", reads.indexOf("if (!isVeterinarian)") + 50));
    expect(officerBranch).not.toContain("privateClinicalSummary");
    expect(officerBranch).not.toContain("privateNote");
    expect(officerBranch).not.toContain("medication");
    expect(officerBranch).not.toContain("dose");
    expect(officerBranch).not.toContain("closureReason");
  });

  it("requires critical escalation settlement and veterinarian-only closure", () => {
    expect(writes).toContain("Acknowledge and resolve every escalation before closing the case.");
    expect(writes).toContain('requiredCapability: "welfare:close"');
    expect(writes).toContain('allowedDuties: ["designated_veterinarian"]');
  });
});
