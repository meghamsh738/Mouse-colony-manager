import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "prisma/migrations/0016_sop_governance/migration.sql"),
  "utf8",
);

function functionBody(name: string, nextMarker: string) {
  const start = migration.indexOf(`CREATE FUNCTION "${name}"`);
  const end = migration.indexOf(nextMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("SOP governance migration", () => {
  it("is atomic and creates scope-aware code identities", () => {
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toContain('CREATE TYPE "SopScope" AS ENUM (\'facility\', \'lab\')');
    expect(migration).toContain('CREATE TYPE "SopApprovalDecision" AS ENUM (\'approved\', \'rejected\')');
    expect(migration).toContain('CONSTRAINT "SopDocument_scope_lab_check"');
    expect(migration).toContain("(scope = 'facility' AND \"labId\" IS NULL)");
    expect(migration).toContain("(scope = 'lab' AND \"labId\" IS NOT NULL)");
    expect(migration).toContain('CREATE UNIQUE INDEX "SopDocument_facility_code_key"');
    expect(migration).toContain("WHERE scope = 'facility'");
    expect(migration).toContain('CREATE UNIQUE INDEX "SopDocument_lab_code_key"');
    expect(migration).toContain("WHERE scope = 'lab'");
  });

  it("uses trigger-table schema guards without trusting session schema state", () => {
    const ledger = functionBody("prevent_sop_ledger_mutation", 'CREATE TRIGGER "SopVersion_append_only"');
    const assignment = functionBody("validate_sop_assignment_write", 'CREATE TRIGGER "SopAssignment_write_guard"');
    const currentVersion = functionBody(
      "protect_sop_document_identity_and_current_version",
      'CREATE TRIGGER "SopDocument_identity_current_version_guard"',
    );
    const acknowledgement = functionBody(
      "validate_sop_acknowledgement_insert",
      'CREATE TRIGGER "SopAcknowledgement_binding_guard"',
    );

    for (const body of [ledger, assignment]) {
      expect(body).toContain("current_setting('mcm.allow_destructive_seed', true) = 'true'");
      expect(body).toContain("TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'");
    }
    for (const body of [currentVersion, assignment, acknowledgement]) {
      expect(body).toContain("TG_TABLE_SCHEMA");
      expect(body).toContain("format(");
    }
    expect(migration).not.toContain("current_schema()");
  });

  it("makes version, approval, and acknowledgement ledgers immutable including truncate", () => {
    for (const table of ["SopVersion", "SopVersionApproval", "SopAcknowledgement"]) {
      expect(migration).toContain(`CREATE TRIGGER "${table}_append_only"`);
      expect(migration).toContain(`CREATE TRIGGER "${table}_truncate_guard"`);
    }
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON \"SopVersion\"");
    expect(migration).toContain("BEFORE TRUNCATE ON \"SopVersion\"");
    expect(migration).toContain("TG_OP = 'TRUNCATE'");
    expect(migration).toContain("immutable SOP governance ledger");
  });

  it("binds a document current version to its approved immutable decision", () => {
    const body = functionBody(
      "protect_sop_document_identity_and_current_version",
      'CREATE TRIGGER "SopDocument_identity_current_version_guard"',
    );
    expect(migration).toContain('FOREIGN KEY ("currentVersionId", id) REFERENCES "SopVersion"(id, "sopId")');
    expect(migration).toContain('CREATE UNIQUE INDEX "SopVersionApproval_sopVersionId_key"');
    expect(body).toContain('approval."sopVersionId" = version.id');
    expect(body).toContain('approval."sopId" = version."sopId"');
    expect(body).toContain("approval.decision = ''approved''");
    expect(body).toContain("version.\"sopId\" = $2");
  });

  it("binds assignments and acknowledgements to the approved exact snapshot", () => {
    const assignment = functionBody("validate_sop_assignment_write", 'CREATE TRIGGER "SopAssignment_write_guard"');
    const acknowledgement = functionBody(
      "validate_sop_acknowledgement_insert",
      'CREATE TRIGGER "SopAcknowledgement_binding_guard"',
    );

    expect(migration).toContain('FOREIGN KEY ("sopVersionId", "sopId") REFERENCES "SopVersion"(id, "sopId")');
    expect(migration).toContain('CREATE UNIQUE INDEX "SopAssignment_one_active_per_lab_sop_key"');
    expect(migration).toContain('WHERE "revokedAt" IS NULL');
    expect(assignment).toContain("approval.decision = ''approved''");
    expect(assignment).toContain("document.scope = ''facility'' OR document.\"labId\" = $3");
    expect(assignment).toContain("may only be revoked once");
    expect(assignment).toContain('NEW."sopVersionId" IS DISTINCT FROM OLD."sopVersionId"');
    expect(migration).toContain('CREATE TRIGGER "SopAssignment_truncate_guard"');

    expect(migration).toContain('FOREIGN KEY ("assignmentId", "sopId", "sopVersionId", "labId")');
    expect(migration).toContain('CREATE UNIQUE INDEX "SopAcknowledgement_assignmentId_userId_key"');
    expect(acknowledgement).toContain('assignment."revokedAt" IS NULL');
    expect(acknowledgement).toContain('version."contentHash" = $6');
    expect(acknowledgement).toContain("acknowledgement_user.active");
    expect(acknowledgement).toContain("membership.active");
  });

  it("derives hashes in PostgreSQL and constrains governance DML", () => {
    expect(migration).toContain('CREATE FUNCTION "sop_content_hash"');
    expect(migration).toContain("public.digest(convert_to(title || E'\\n' || category || E'\\n' || content_markdown");
    expect(migration).toContain('CONSTRAINT "SopVersion_content_hash_matches_check"');
    expect(migration).toContain('CREATE FUNCTION "sop_command_context_valid"');
    expect(migration).toContain("receipt.status = 'processing'");
    expect(migration).toContain('receipt."actorAuthzVersion" = actor."authzVersion"');
    expect(migration).toContain('receipt."databasePrincipal" = SESSION_USER');
    expect(migration).toContain('CREATE TRIGGER "CommandReceipt_principal_stamp"');
    expect(migration).toContain('CREATE TRIGGER "CommandReceipt_sop_identity_guard"');
    expect(migration).toContain("SET search_path FROM CURRENT");
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(6);
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON");
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
  });

  it("prevents controlled-version regression and historical assignment", () => {
    const document = functionBody(
      "protect_sop_document_identity_and_current_version",
      'CREATE TRIGGER "SopDocument_identity_current_version_guard"',
    );
    const assignment = functionBody("validate_sop_assignment_write", 'CREATE TRIGGER "SopAssignment_write_guard"');
    expect(document).toContain("new_current_number <= old_current_number");
    expect(document).toContain("rollback requires a new version");
    expect(document).toContain("Drafting or assigning an SOP cannot alter controlled document metadata");
    expect(assignment).toContain('document."currentVersionId" = $2');
    expect(assignment).toContain("current approved exact version");
  });
});
