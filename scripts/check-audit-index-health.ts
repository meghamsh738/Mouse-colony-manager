import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const configuredDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!configuredDatabaseUrl) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required.");
const databaseUrl: string = configuredDatabaseUrl;
const schema = new URL(databaseUrl).searchParams.get("schema") ?? "public";
const db = new PrismaClient({ datasourceUrl: databaseUrl });

const expected = [
  { migrationName: "0029_audit_timestamp_index", indexName: "AuditLog_timestamp_idx" },
  { migrationName: "0030_audit_lab_timestamp_index", indexName: "AuditLog_labId_timestamp_idx" },
  { migrationName: "0031_audit_entity_timestamp_index", indexName: "AuditLog_entityType_entityId_timestamp_idx" },
  { migrationName: "0032_audit_request_index", indexName: "AuditLog_requestId_idx" },
] as const;

function migrationEvidence(entry: (typeof expected)[number]) {
  const sql = fs.readFileSync(
    path.resolve(process.cwd(), "prisma/migrations", entry.migrationName, "migration.sql"),
    "utf8",
  );
  return {
    ...entry,
    expectedDefinition: sql.trim(),
    expectedChecksum: createHash("sha256").update(sql).digest("hex"),
  };
}

function canonicalIndexDefinition(definition: string) {
  return definition
    .trim()
    .replace(/;$/, "")
    .replace(/\bCONCURRENTLY\b/gi, "")
    .replace(/\bUSING\s+btree\b/gi, "")
    .replaceAll('"', "")
    .replace(new RegExp(`\\b${schema.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`, "gi"), "")
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s*\)\s*/g, ")")
    .trim()
    .toLowerCase();
}

async function main() {
  const expectedEvidence = expected.map(migrationEvidence);
  const rows = await db.$queryRaw<Array<{
    indexName: string;
    schemaName: string;
    tableName: string;
    valid: boolean;
    ready: boolean;
    definition: string;
  }>>`
    SELECT
      index_class.relname AS "indexName",
      namespace.nspname AS "schemaName",
      table_class.relname AS "tableName",
      index_state.indisvalid AS valid,
      index_state.indisready AS ready,
      pg_catalog.pg_get_indexdef(index_state.indexrelid) AS definition
    FROM pg_catalog.pg_index index_state
    JOIN pg_catalog.pg_class index_class ON index_class.oid = index_state.indexrelid
    JOIN pg_catalog.pg_class table_class ON table_class.oid = index_state.indrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = table_class.relnamespace
    WHERE namespace.nspname = current_schema()
      AND table_class.relname = 'AuditLog'
      AND index_class.relname = ANY(${expected.map((entry) => entry.indexName)})
    ORDER BY index_class.relname
  `;
  const migrations = await db.$queryRaw<Array<{
    migrationName: string;
    checksum: string;
    finishedAt: Date | null;
    rolledBackAt: Date | null;
  }>>`
    SELECT
      migration_name AS "migrationName",
      checksum,
      finished_at AS "finishedAt",
      rolled_back_at AS "rolledBackAt"
    FROM _prisma_migrations
    WHERE migration_name = ANY(${expected.map((entry) => entry.migrationName)})
  `;
  const byName = new Map(rows.map((row) => [row.indexName, row]));
  const migrationByName = new Map(migrations.map((migration) => [migration.migrationName, migration]));
  const checks = expectedEvidence.map((entry) => {
    const row = byName.get(entry.indexName);
    const migration = migrationByName.get(entry.migrationName);
    const definitionMatches = Boolean(row)
      && canonicalIndexDefinition(row!.definition) === canonicalIndexDefinition(entry.expectedDefinition);
    const checksumMatches = migration?.checksum === entry.expectedChecksum;
    const migrationApplied = Boolean(migration?.finishedAt && !migration.rolledBackAt);
    const exactValidIndexWithFailedMigration = Boolean(
      row?.valid && row.ready && definitionMatches && checksumMatches
      && migration && !migration.finishedAt && !migration.rolledBackAt,
    );
    return {
      ...entry,
      schemaName: row?.schemaName ?? null,
      tableName: row?.tableName ?? null,
      valid: row?.valid ?? false,
      ready: row?.ready ?? false,
      definition: row?.definition ?? null,
      definitionMatches,
      expectedChecksum: entry.expectedChecksum,
      recordedChecksum: migration?.checksum ?? null,
      checksumMatches,
      finishedAt: migration?.finishedAt ?? null,
      rolledBackAt: migration?.rolledBackAt ?? null,
      migrationApplied,
      recoveryState: exactValidIndexWithFailedMigration
        ? "eligible_resolve_applied_after_operator_verification"
        : migrationApplied && row?.valid && row.ready && definitionMatches && checksumMatches
          ? "healthy"
          : "drop_or_rebuild_then_resolve_rolled_back",
    };
  });
  const unhealthy = checks.filter((check) => check.recoveryState !== "healthy");
  console.log(JSON.stringify({ schema, checks, unhealthy }, null, 2));
  if (unhealthy.length) {
    throw new Error("Audit index health check failed. Follow the matching interrupted-index branch in docs/DATABASE_RECOVERY.md; never resolve from name alone.");
  }
}

main().finally(async () => db.$disconnect());
