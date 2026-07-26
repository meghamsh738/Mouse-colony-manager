# Database Backup And Recovery Gate

This procedure is mandatory before any populated Mouse Colony Manager migration. It is not needed for disposable empty-instance databases.

## Preconditions

- Freeze application writes and drain background workers.
- Record application commit, Prisma version, PostgreSQL version, migration checksums, row counts, and active migration run.
- Use direct PostgreSQL credentials with the minimum backup/restore permissions.
- Never run the rehearsal against the live database.

## Backup

Use matching PostgreSQL client tools for the server major version:

```bash
pg_dump --format=custom --no-owner --no-acl --file=mcm-pre-migration.dump "$DIRECT_DATABASE_URL"
pg_dump --schema-only --no-owner --no-acl --file=mcm-pre-migration-schema.sql "$DIRECT_DATABASE_URL"
```

Generate SHA-256 checksums for both files and store them with the migration run report. Backups must be encrypted and access controlled outside the application repository.

## Restore Rehearsal

Restore into an empty, isolated PostgreSQL database:

```bash
createdb mcm_restore_rehearsal
pg_restore --exit-on-error --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" mcm-pre-migration.dump
```

Then run:

1. Schema fingerprint and migration-history capture.
2. Pre-migration row counts and ownership exception report.
3. Application read-only smoke checks.
4. The complete expand/backfill/verify/constrain/cutover migration rehearsal.
5. Post-migration row-count reconciliation, isolation tests, and application smoke checks.
6. A deliberately interrupted rehearsal followed by documented roll-forward recovery.

## Acceptance

- Backup and schema checksums match their recorded values.
- Restore completes without ignored errors.
- Pre-migration row counts match the source snapshot.
- No operational write is made to the source database during rehearsal.
- Restore duration, migration duration, lock waits, and recovery duration are recorded in `IMPLEMENTATION_TRACKER.md`.
- The populated rollout remains blocked until this procedure has passed with production-shaped data.

## Adopting The 0005 Baseline On A Populated Restore

Populated databases historically maintained with `prisma db push` must not execute the fail-closed `0005_schema_reconciliation` SQL. Rehearse on a restored copy first:

```bash
npm run db:adopt-populated-baseline
```

The command builds the 0005 schema in a retained verification schema and requires a zero schema diff against the restored target. Dry-run mode does not resolve migration metadata. If and only if the diff is empty and the backup has been verified, adopt the baseline and deploy the identity migrations with explicit evidence:

```bash
POPULATED_BASELINE_CONFIRM=ZERO_DIFF_BACKUP_VERIFIED \
POPULATED_BACKUP_ID=<backup-or-restore-evidence-id> \
npm run db:adopt-populated-baseline -- --apply
```

Any non-zero diff blocks adoption and requires the Milestone 9 expand/backfill reconciliation. The verification schema is retained for audit; the script never drops database objects.

Postgres.app 2.9.5 supplies matching PostgreSQL 16.14 `pg_dump` and `pg_restore` tools on the current development machine. Set `PG_BIN_DIR` to its PostgreSQL 16 `bin` directory when those tools are not already on `PATH`. Never substitute an application-level JSON export for a database backup.

## Synthetic Backup/Restore Harness

Milestone 9 begins with a synthetic-only proof of the backup mechanics. It does not satisfy the production-shaped-data gate by itself. The harness:

- accepts only two distinct loopback databases and a shared schema whose names begin with `mcm_test_`;
- refuses production mode and any data class other than `synthetic`;
- requires an empty restore database whose application schema does not yet exist and never drops or recreates a database;
- requires the source database to enforce `default_transaction_read_only=on`;
- inventories user and database-wide objects, rejects large objects and unsupported global objects, and archives only the exact application schema plus the allowlisted `pgcrypto` extension;
- validates PostgreSQL cluster identity and matching server/client major versions;
- performs restore in one transaction and derives the schema-only artifact from the completed custom archive;
- writes mode-restricted backup artifacts under a canonical approved runtime root outside the source worktree;
- captures custom and schema-only dump checksums, migration checksums, tool/server/application versions, exact table row counts, and backup/restore durations;
- records the source write-freeze state, verifies source counts remain stable, and requires exact restored table-count parity.

Create the source and empty restore databases explicitly, bind both Prisma URLs to the source, migrate the disposable source, set an ephemeral `MCM_REHEARSAL_ADMIN_PASSWORD`, and run `npm run db:seed:rehearsal`. This rehearsal fixture is additive-only: in one transaction it rejects other database clients, locks every application table, proves all non-migration fixture tables are empty, verifies the migration-managed identity-sequence baseline, and inserts a minimal synthetic lab/facility identity fixture. It never deletes, overwrites, or clears attachment files.

```bash
export PG_BIN_DIR='/Applications/Postgres.app/Contents/Versions/16/bin'
"$PG_BIN_DIR/createdb" --host=127.0.0.1 --port=51422 --username=postgres --template=template0 mcm_test_m9_source
"$PG_BIN_DIR/createdb" --host=127.0.0.1 --port=51422 --username=postgres --template=template0 mcm_test_m9_restore

export MCM_REHEARSAL_SOURCE_URL='postgresql://postgres@127.0.0.1:51422/mcm_test_m9_source?schema=mcm_test_populated&sslmode=disable'
export MCM_REHEARSAL_RESTORE_URL='postgresql://postgres@127.0.0.1:51422/mcm_test_m9_restore?schema=mcm_test_populated&sslmode=disable'
export DATABASE_URL="$MCM_REHEARSAL_SOURCE_URL"
export DIRECT_DATABASE_URL="$MCM_REHEARSAL_SOURCE_URL"
export MCM_REHEARSAL_ADMIN_PASSWORD="$(openssl rand -base64 24)"
npm run db:migrate
npm run db:seed:rehearsal
unset MCM_REHEARSAL_ADMIN_PASSWORD

"$PG_BIN_DIR/psql" 'postgresql://postgres@127.0.0.1:51422/mcm_test_m9_source?sslmode=disable' \
  -X -v ON_ERROR_STOP=1 \
  -c 'ALTER DATABASE mcm_test_m9_source SET default_transaction_read_only=on'

export MCM_REHEARSAL_RUNTIME_ROOT='/absolute/project-runtime/path'
export MCM_REHEARSAL_OUTPUT_DIR="$MCM_REHEARSAL_RUNTIME_ROOT/m9-rehearsals"
export MCM_REHEARSAL_DATA_CLASS='synthetic'
export MCM_POPULATED_REHEARSAL_CONFIRM='LOCAL_SYNTHETIC_DISPOSABLE_ONLY'
npm run db:rehearse-populated-backup
```

The runtime root and output directory must already exist and must resolve outside the source worktree without symlink traversal. After populating the disposable source and closing writers, set the source database default to read-only before the harness starts. A failed restore is rolled back atomically and leaves `manifest.failed.json`; the harness never cleans or reuses the target automatically.

The retained `manifest.json` is synthetic rehearsal evidence only. It records whether the source worktree was dirty and the exact rehearsal-script checksum. A sanitized production-shaped backup requires an approved artifact location, encryption/access-control policy, matching tool versions, and explicit authorization before it is accessed or restored.

## Interrupted Concurrent Audit Index

Migrations `0029` through `0032` each contain one `CREATE INDEX CONCURRENTLY` statement. PostgreSQL can retain an invalid same-name index when one of these statements is interrupted. The migrations intentionally do not use `IF NOT EXISTS`, because that would silently accept the invalid index on retry.

Before resolving a failed concurrent-index migration, inspect the connected schema. The checker reports the schema, table, full `pg_get_indexdef`, validity/readiness, expected and recorded migration checksum, and Prisma completion state for every allowlisted index:

```bash
npm run check:audit-index-health
```

Use exactly one of the following branches. Never choose a branch from the index name alone.

### Branch A: invalid, missing, or definition/checksum mismatch

If the index is invalid/not-ready, missing, has a different `pg_get_indexdef`, targets another schema/table, or its recorded checksum differs from the checked-in migration, do not mark the migration applied. Confirm the object is one of the four allowlisted audit indexes and drop only the mismatched or invalid index with matching PostgreSQL client credentials:

```sql
SELECT index_class.relname, index_state.indisvalid, index_state.indisready
FROM pg_catalog.pg_index index_state
JOIN pg_catalog.pg_class index_class ON index_class.oid = index_state.indexrelid
JOIN pg_catalog.pg_class table_class ON table_class.oid = index_state.indrelid
JOIN pg_catalog.pg_namespace namespace ON namespace.oid = table_class.relnamespace
WHERE namespace.nspname = current_schema()
  AND table_class.relname = 'AuditLog'
  AND (NOT index_state.indisvalid OR NOT index_state.indisready);

DROP INDEX CONCURRENTLY "<exact-invalid-index-name>";
```

Then mark only the failed migration rolled back, redeploy, and recheck:

```bash
npx prisma migrate resolve --rolled-back <0029_to_0032_failed_migration_name>
npm run db:migrate
npm run check:audit-index-health
```

Never mark the migration applied while the checker reports a missing, invalid, not-ready, wrong-schema, wrong-table, definition-mismatched, or checksum-mismatched index.

### Branch B: valid exact index with failed Prisma metadata

A crash can occur after PostgreSQL finishes `CREATE INDEX CONCURRENTLY` but before Prisma records the migration as finished. In that state the index is valid and ready, but `_prisma_migrations.finished_at` is null. Redeploying immediately fails because the exact index already exists.

Only when `check:audit-index-health` reports `eligible_resolve_applied_after_operator_verification` may an operator compare all of the following evidence: current schema and `AuditLog` table, full normalized `pg_get_indexdef`, checked-in migration SQL, expected SHA-256 checksum, recorded checksum, and an unfinished/non-rolled-back Prisma row. If every value matches, preserve the completed index and resolve that one migration as applied:

```bash
npx prisma migrate resolve --applied <0029_to_0032_failed_migration_name>
npm run check:audit-index-health
npm run db:migrate
npm run check:audit-index-health
```

If any value is missing or differs, use Branch A instead. Never resolve a valid same-name index as applied without the exact definition, schema/table, and checksum match.
