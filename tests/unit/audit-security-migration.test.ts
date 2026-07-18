import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "prisma/migrations/0027_audit_security_separation/migration.sql"),
  "utf8",
);
const backfillMigration = fs.readFileSync(
  path.resolve(process.cwd(), "prisma/migrations/0028_audit_security_backfill/migration.sql"),
  "utf8",
);
const concurrentIndexMigrations = [29, 30, 31, 32].map((number) => fs.readFileSync(
  path.resolve(
    process.cwd(),
    "prisma/migrations",
    fs.readdirSync(path.resolve(process.cwd(), "prisma/migrations")).find((entry) => entry.startsWith(`00${number}_`))!,
    "migration.sql",
  ),
  "utf8",
));
const seedDatabase = fs.readFileSync(path.resolve(process.cwd(), "prisma/seed-database.ts"), "utf8");
const emptySeed = fs.readFileSync(path.resolve(process.cwd(), "prisma/seed-empty.ts"), "utf8");
const indexHealthScript = fs.readFileSync(path.resolve(process.cwd(), "scripts/check-audit-index-health.ts"), "utf8");
const recoveryGuide = fs.readFileSync(path.resolve(process.cwd(), "docs/DATABASE_RECOVERY.md"), "utf8");

describe("audit and security separation migration", () => {
  it("keeps the additive ledger DDL short and atomic", () => {
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toContain('CREATE TABLE "SecurityEvent"');
    expect(migration).toContain('ADD COLUMN "actorRole" TEXT');
    expect(migration).toContain('ADD COLUMN "labId" TEXT');
    expect(migration).toContain('ADD COLUMN "requestId" TEXT');
    expect(migration).toContain("NOT VALID");
    expect(migration).not.toContain('LOCK TABLE "AuditLog" IN ACCESS EXCLUSIVE MODE');
    expect(migration).not.toMatch(/UPDATE\s+"AuditLog"/i);
    expect(migration).not.toContain('DROP TABLE "AuditLog"');
  });

  it("runs legacy backfill and indexes outside the DDL transaction", () => {
    expect(backfillMigration.trimStart().startsWith("BEGIN;")).toBe(false);
    expect(backfillMigration).toContain("ELSE 'legacy_unsnapshotted'");
    expect(backfillMigration).toContain("'legacy_audit_backfill'");
    expect(backfillMigration).toContain("WHERE audit.\"entityType\" IN ('user_invitation', 'user_role', 'user_access')");
    expect(backfillMigration).toContain("VALIDATE CONSTRAINT");
    expect(backfillMigration).not.toContain("CREATE INDEX CONCURRENTLY");
    expect(concurrentIndexMigrations).toHaveLength(4);
    for (const indexMigration of concurrentIndexMigrations) {
      expect(indexMigration.trim()).toMatch(/^CREATE INDEX CONCURRENTLY .+;$/);
      expect(indexMigration).not.toContain("IF NOT EXISTS");
      expect(indexMigration).not.toContain("BEGIN;");
    }
  });

  it("detects and documents recovery from an interrupted concurrent index build", () => {
    expect(indexHealthScript).toContain("index_state.indisvalid AS valid");
    expect(indexHealthScript).toContain("index_state.indisready AS ready");
    expect(indexHealthScript).toContain("pg_catalog.pg_get_indexdef");
    expect(indexHealthScript).toContain('migration_name AS "migrationName"');
    expect(indexHealthScript).toContain("expectedChecksum");
    expect(indexHealthScript).toContain("eligible_resolve_applied_after_operator_verification");
    expect(indexHealthScript).toContain("Audit index health check failed");
    expect(recoveryGuide).toContain('DROP INDEX CONCURRENTLY "<exact-invalid-index-name>"');
    expect(recoveryGuide).toContain("prisma migrate resolve --rolled-back");
    expect(recoveryGuide).toContain("prisma migrate resolve --applied");
    expect(recoveryGuide).toContain("full normalized `pg_get_indexdef`");
    expect(recoveryGuide).toContain("Never mark the migration applied");
  });

  it("stamps immutable actor, request, and lab context on domain audits", () => {
    expect(migration).toContain('CREATE FUNCTION "stamp_operational_audit_context"');
    expect(migration).toContain('CREATE TRIGGER "AuditLog_context_stamp"');
    expect(migration).not.toContain('NEW."newValue"->>\'receiptId\'');
    expect(migration).not.toContain('NEW."previousValue"->>\'receiptId\'');
    expect(migration).toContain("current_setting('mcm.audit_receipt_id', true)");
    expect(migration).toContain('receipt."transactionId" = txid_current()');
    expect(migration).toContain('NEW."transactionId" := txid_current()');
    expect(migration).toContain('CREATE TRIGGER "CommandReceipt_audit_identity_guard"');
    expect(migration).toContain('NEW."transactionId" IS DISTINCT FROM OLD."transactionId"');
    expect(migration).toContain("receipt.status = 'processing'");
    expect(migration).toContain('receipt."requestHash" IS NOT DISTINCT FROM context_request_hash');
    expect(migration).toContain('NEW."commandReceiptId" := receipt_row.id');
    expect(migration).toContain('NEW."requestId" := receipt_row."requestId"');
    expect(migration).toContain('NEW."commandAggregateType" := receipt_row."aggregateType"');
    expect(migration).toContain('receipt."actorId" IS NOT DISTINCT FROM NEW."actorId"');
    expect(migration).toContain("Audit request context conflicts with its command receipt");
    expect(migration).toContain("Audit lab context conflicts with its command receipt");
    expect(migration).toContain("Unreceipted audit command, lab, and request context is not authoritative");
    expect(migration).toContain('FOREIGN KEY ("commandReceiptId") REFERENCES "CommandReceipt"(id)');
    expect(migration).not.toContain("candidate_lab_id");
    expect(migration).not.toContain("NEW.\"newValue\"->>'labId'");
    expect(migration).toContain('NEW."actorRole" := "canonical_audit_actor_role"');
  });

  it("labels caller-supplied security context as correlation rather than provenance", () => {
    expect(migration).toContain('"scopeLabId" TEXT');
    expect(migration).toContain('"correlationId" TEXT');
    expect(migration).not.toContain('CONSTRAINT "SecurityEvent_requestId_check"');
    expect(backfillMigration).toContain('"scopeLabId", "correlationId"');
  });

  it("makes both ledgers append-only, including truncate", () => {
    expect(migration).toContain('CREATE TRIGGER "AuditLog_append_only_guard"');
    expect(migration).toContain('CREATE TRIGGER "AuditLog_truncate_guard"');
    expect(migration).toContain('CREATE TRIGGER "SecurityEvent_append_only_guard"');
    expect(migration).toContain('CREATE TRIGGER "SecurityEvent_truncate_guard"');
    expect(migration).toContain("Operational audit history is append-only");
    expect(migration).toContain("Security event history is append-only");
    expect(migration).toContain("TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'");
  });

  it("preserves legacy-unsnapshotted provenance only for a matching identity audit", () => {
    expect(migration).toContain("NEW.source = 'legacy_audit_backfill'");
    expect(migration).toContain("NEW.id = 'security-legacy-' || SUBSTRING");
    expect(migration).toContain("audit.\"actorId\" IS NOT DISTINCT FROM NEW.\"actorId\"");
    expect(migration).toContain("audit.\"timestamp\" IS NOT DISTINCT FROM NEW.\"occurredAt\"");
    expect(migration).toContain("ELSE 'legacy_unsnapshotted' END");
    const operationalFunction = migration.slice(
      migration.indexOf('CREATE FUNCTION "stamp_operational_audit_context"'),
      migration.indexOf('CREATE FUNCTION "stamp_security_event_actor"'),
    );
    expect(operationalFunction).not.toContain("NEW.source");
    expect(operationalFunction).not.toContain('NEW."dedupeKey"');
  });

  it("keeps destructive cleanup explicitly disposable and empty bootstrap aware", () => {
    expect(seedDatabase).toContain("prisma.securityEvent.deleteMany()");
    expect(seedDatabase.indexOf("prisma.securityEvent.deleteMany()"))
      .toBeLessThan(seedDatabase.indexOf("prisma.user.deleteMany()"));
    expect(emptySeed).toContain("securityEvents: await tx.securityEvent.count()");
  });
});
