import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(process.cwd(), "prisma/migrations/0038_protocol_authorization_competency/migration.sql");

describe("M13 protocol authorization and competency contract", () => {
  it("creates sealed protocol, competency, allocation, and immutable evidence records", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const table of [
      "ProtocolAuthorization", "ProtocolAuthorizationVersion", "ProtocolCountLedger",
      "ProtocolCountAllocation", "ProtocolCountAllocationHistory", "CompetencyEvidence",
      "CompetencyEvidenceVersion", "CompetencyLifecycleEvent", "ComplianceEvidenceSnapshot",
    ]) expect(sql).toContain(`CREATE TABLE "${table}"`);
    expect(sql).toContain("synthetic-fail-closed-v1");
    expect(sql).toContain('"scopeSealedAt" TIMESTAMPTZ');
    expect(sql).toContain('UNIQUE ("commandReceiptId", "evidenceKey")');
    expect(sql).toContain('CREATE TRIGGER "ComplianceEvidenceSnapshot_guard"');
    expect(sql).toContain('CREATE TRIGGER "ProtocolCountAllocationHistory_guard"');
  });

  it("pairs every ledger/allocation transition to an exact receipt-bound history row", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain('CREATE CONSTRAINT TRIGGER "ProtocolCountLedger_history_pair"');
    expect(sql).toContain('CREATE CONSTRAINT TRIGGER "ProtocolCountAllocation_history_pair"');
    expect(sql).toContain('AFTER INSERT OR UPDATE ON "ProtocolCountAllocation" DEFERRABLE INITIALLY DEFERRED');
    expect(sql).toContain('receipt_record."aggregateType" IS DISTINCT FROM NEW."commandAggregateType"');
    expect(sql).toContain('history."allocationType" = \'reserve\'');
    expect(sql).toContain('Protocol allocation transition requires matching immutable history');
    expect(sql).toContain('CREATE FUNCTION "mcm_m13_transfer_source_release_allowed"');
    expect(sql).toContain("receipt.\"commandType\" = 'lab_transfer.finalize'");
    expect(sql).toContain("actor.role = 'facility_admin'");
    expect(sql).toContain("assignment.status IN ('reserved', 'active')");
  });

  it("guards destructive bypass with disposable loopback database identity everywhere", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain('current_database() ~ \'^mcm_test_[a-z0-9_]+$\'');
    expect(sql).toContain("inet_server_addr() = '::1'::inet");
    expect(sql.match(/current_setting\('mcm\.allow_destructive_seed'/g)).toHaveLength(1);
    expect(sql.match(/"mcm_m13_destructive_seed_allowed"\(\)/g)?.length).toBeGreaterThan(10);
  });

  it("enforces maker-checker governance and active membership/identity evidence", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain('NEW."reviewedById" = NEW."createdById"');
    expect(sql).toContain('NEW."userId" = NEW."governedById"');
    expect(sql).toContain('Named protocol personnel must be an active member');
    expect(sql).toContain('Compliance snapshot actor authorization is stale');
    expect(sql).toContain('membership."userId" = NEW."actorId"');
    expect(sql).toContain('mcm_identity_assurance_snapshot_is_current');
  });

  it("maps command families to bounded named-personnel roles and exact scope", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("LIKE 'cage_intake.%'");
    expect(sql).toContain("LIKE 'procedure.%'");
    expect(sql).toContain("LIKE 'lab_transfer.%'");
    expect(sql).toContain("'intake_operator'");
    expect(sql).toContain("'procedure_operator'");
    expect(sql).toContain("'transfer_coordinator'");
    expect(sql).toContain('binding."projectId" = NEW."scopeSnapshot"->>\'projectId\'');
    expect(sql).toContain('binding."experimentId" = NEW."scopeSnapshot"->>\'experimentId\'');
    expect(sql).toContain("Protocol version canonical payload does not match its sealed scope bindings");
    expect(sql).toContain('ORDER BY binding."userId", binding."roleLabel"::text');
    expect(sql).toContain('to_jsonb(NEW)->>\'userId\'');
    expect(sql).toContain("Mismatched canonical field: ");
    expect(sql).toContain("Competency version canonical payload does not match its immutable evidence fields");
    expect(sql).toContain("payload->>'procedureCode' IS DISTINCT FROM evidence_record.\"procedureCode\"");
  });

  it("wires exact domain links and transfer destination count settlement", async () => {
    const [sql, transfer, intake, procedure, assignment] = await Promise.all([
      readFile(migrationPath, "utf8"),
      readFile(path.join(process.cwd(), "src/lib/lab-transfer-write.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src/lib/cage-intake-write.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src/lib/procedure-write.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src/lib/experiment-assignment-write.ts"), "utf8"),
    ]);
    expect(sql).toContain('CREATE TRIGGER "Experiment_compliance_link_guard"');
    expect(sql).toContain('CREATE TRIGGER "Litter_compliance_link_guard"');
    expect(sql).toContain('CREATE TRIGGER "ProcedureOccurrence_compliance_link_guard"');
    expect(sql).toContain('"destinationProtocolCountAllocationId"');
    expect(transfer).toContain('countOperation: "reserve"');
    expect(transfer).toContain("consumeProtocolReservation");
    expect(transfer).toContain("releaseDestinationTransferReservation");
    expect(transfer).toContain("destinationProtocolCountAllocationId");
    expect(transfer).toContain("withM13MutationSavepoint");
    expect(intake).toContain('commandType: "cage_intake.purchase"');
    expect(intake).toContain('evidenceKey: "consume"');
    expect(intake).toContain("const mortality = remaining - input.command.payload.pups.length");
    expect(procedure).toContain("const settlesReservation = usesAnimal && allocationRemaining > 0");
    expect(procedure).toContain('countOperation: settlesReservation ? "consume" : "none"');
    expect(assignment).toContain("allocation.evidenceSnapshotId");
  });

  it("uses savepoints so expected downstream failures roll back M13 mutations", async () => {
    const sources = await Promise.all([
      "src/lib/protocol-compliance.ts", "src/lib/lab-transfer-write.ts", "src/lib/cage-intake-write.ts",
      "src/lib/experiment-assignment-write.ts", "src/lib/procedure-write.ts",
    ].map((file) => readFile(path.join(process.cwd(), file), "utf8")));
    expect(sources[0]).toContain("ROLLBACK TO SAVEPOINT mcm_m13_compliance_write");
    for (const source of sources.slice(1, 4)) expect(source).toContain("withM13MutationSavepoint");
    expect(sources[4]).toContain("withComplianceWriteScope");
  });

  it("fails stale governance, self-review, revoked renewal, and inactive evidence closed", async () => {
    const [governance, compliance] = await Promise.all([
      readFile(path.join(process.cwd(), "src/lib/protocol-governance.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src/lib/protocol-compliance.ts"), "utf8"),
    ]);
    expect(governance).toContain('code: "stale_conflict"');
    expect(governance).toContain('code: "maker_checker_required"');
    expect(governance).toContain('existing?.status === "revoked" && input.command.renewRevoked !== true');
    expect(governance).toContain('expired: []');
    expect(governance).toContain('revoked: []');
    expect(compliance).toContain('protocol.status !== "active"');
    expect(compliance).toContain('status: "current"');
    expect(compliance).toContain('revokedAt: null');
  });

  it("ships bounded role-QA fixtures without adding animals to the empty bootstrap", async () => {
    const [fixture, roleQa, emptySeed] = await Promise.all([
      readFile(path.join(process.cwd(), "prisma/seed-protocol-qa.ts"), "utf8"),
      readFile(path.join(process.cwd(), "prisma/seed-role-qa.ts"), "utf8"),
      readFile(path.join(process.cwd(), "prisma/seed-empty.ts"), "utf8"),
    ]);
    expect(roleQa).toContain("seedProtocolQaFixture");
    expect(fixture).toContain('code: "QA-ACTIVE-6"');
    expect(fixture).toContain("approvedAnimalCount: 6");
    expect(fixture).toContain("reservedCount: 5");
    expect(fixture).toContain('code: "QA-WRONG-STRAIN"');
    expect(fixture).toContain('code: "QA-WRONG-PROCEDURE"');
    expect(fixture).toContain('code: "QA-CROSS-LAB"');
    expect(fixture).toContain('status: "expired"');
    expect(fixture).toContain('status: "suspended"');
    expect(fixture).toContain('status: "legacy_unverified"');
    expect(fixture).toContain('status: "revoked" as const');
    expect(fixture).toContain('roleLabel: "breeding_operator"');
    expect(fixture).toContain('roleLabel: "procedure_operator"');
    expect(fixture).toContain('roleLabel: "intake_operator"');
    expect(fixture).toContain('roleLabel: "transfer_coordinator"');
    expect(emptySeed).not.toContain("seedProtocolQaFixture");
  });
});
