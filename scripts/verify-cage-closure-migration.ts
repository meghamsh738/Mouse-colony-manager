import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { Client, type DatabaseError } from "pg";

import { assertRetainedVerificationTarget } from "./retained-verification-guard";

const MIGRATION_NAME = "0014_cage_closure_billing_cutoff";
const REJECTION_CODE = "23514";
let schemaSequence = 0;

type Context = {
  baseline: SchemaObjectCounts;
  client: Client;
  schema: string;
};

type SchemaObjectCounts = {
  constraints: string;
  functions: string;
  indexes: string;
  tables: string;
  triggers: string;
};

type ObservedOperation = {
  promise: Promise<unknown>;
  settlement: Promise<void>;
  settled: boolean;
  settledWith: unknown;
};

function directUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  url.searchParams.delete("schema");
  url.searchParams.delete("pgbouncer");
  return url.toString();
}

function retainedSchemaName(label: string) {
  schemaSequence += 1;
  return `mcm_verify_closure_${label}_${Date.now()}_${process.pid}_${schemaSequence}`;
}

function errorSummary(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const code = "code" in error ? String((error as DatabaseError).code) : "unknown";
  return `${code}: ${error.message}`;
}

async function expectRejected(
  client: Client,
  label: string,
  operation: () => Promise<unknown>,
  expectedMessage?: string,
) {
  await client.query("BEGIN");
  let rejection: unknown;
  try {
    await operation();
  } catch (error) {
    rejection = error;
  }
  await client.query("ROLLBACK");

  if (!rejection) throw new Error(`${label} unexpectedly succeeded.`);
  const databaseError = rejection as DatabaseError;
  if (databaseError.code !== REJECTION_CODE) {
    throw new Error(`${label} failed for the wrong reason (${errorSummary(rejection)}).`);
  }
  if (expectedMessage && !databaseError.message.includes(expectedMessage)) {
    throw new Error(`${label} did not report ${JSON.stringify(expectedMessage)} (${errorSummary(rejection)}).`);
  }
}

async function schemaObjectCounts(client: Client) {
  const result = await client.query<SchemaObjectCounts>(`
    SELECT
      (SELECT COUNT(*)::text FROM pg_constraint WHERE connamespace = current_schema()::regnamespace) AS constraints,
      (SELECT COUNT(*)::text FROM pg_proc WHERE pronamespace = current_schema()::regnamespace) AS functions,
      (
        SELECT COUNT(*)::text
        FROM pg_class object_row
        WHERE object_row.relnamespace = current_schema()::regnamespace AND object_row.relkind IN ('i', 'I')
      ) AS indexes,
      (
        SELECT COUNT(*)::text
        FROM pg_class object_row
        WHERE object_row.relnamespace = current_schema()::regnamespace AND object_row.relkind IN ('r', 'p')
      ) AS tables,
      (
        SELECT COUNT(*)::text
        FROM pg_trigger trigger_row
        JOIN pg_class table_row ON table_row.oid = trigger_row.tgrelid
        WHERE table_row.relnamespace = current_schema()::regnamespace AND NOT trigger_row.tgisinternal
      ) AS triggers
  `);
  const counts = result.rows[0];
  if (!counts) throw new Error("Could not inspect retained-schema object counts.");
  return counts;
}

async function applyMigrationExpectingRejection(
  context: Context,
  migrationSql: string,
  label: string,
  expectedMessage?: string,
) {
  let rejection: unknown;
  try {
    await context.client.query(migrationSql);
  } catch (error) {
    rejection = error;
  }
  if (!rejection) throw new Error(`${label} unexpectedly installed migration ${MIGRATION_NAME}.`);
  await context.client.query("ROLLBACK");

  const databaseError = rejection as DatabaseError;
  if (databaseError.code !== REJECTION_CODE) {
    throw new Error(`${label} failed for the wrong reason (${errorSummary(rejection)}).`);
  }
  if (expectedMessage && !databaseError.message.includes(expectedMessage)) {
    throw new Error(`${label} did not report ${JSON.stringify(expectedMessage)} (${errorSummary(rejection)}).`);
  }
}

async function assertNoMigrationResidue(context: Context, label: string) {
  const actualCounts = await schemaObjectCounts(context.client);
  const result = await context.client.query<{
    closure_table: string | null;
    closure_function_count: string;
    closure_index_count: string;
    closure_trigger_count: string;
    installed_constraint_count: string;
  }>(`
    SELECT
      to_regclass('"CageClosure"')::text AS closure_table,
      (
        SELECT COUNT(*)::text
        FROM pg_proc
        WHERE pronamespace = current_schema()::regnamespace
          AND proname IN (
            'validate_cage_closure_insert',
            'protect_cage_closure_history',
            'protect_closed_cage_billing_history',
            'protect_closed_cage_movement_history',
            'protect_closed_cage_reopening',
            'require_explicit_cage_closure',
            'validate_animal_active_cage_assignment',
            'validate_open_charge_period_current_lab',
            'validate_invoice_finalization_against_charge_periods',
            'validate_invoice_line_write',
            'protect_terminal_invoice_delete',
            'protect_finalized_invoice_state'
          )
      ) AS closure_function_count,
      (
        SELECT COUNT(*)::text FROM pg_indexes
        WHERE schemaname = current_schema()
          AND (indexname LIKE 'CageClosure_%' OR indexname = 'CageChargePeriod_one_open_per_cage_key')
      ) AS closure_index_count,
      (
        SELECT COUNT(*)::text
        FROM pg_trigger trigger_row
        JOIN pg_class table_row ON table_row.oid = trigger_row.tgrelid
        JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
        WHERE namespace_row.nspname = current_schema()
          AND NOT trigger_row.tgisinternal
          AND trigger_row.tgname IN (
            'CageClosure_insert_guard',
            'CageClosure_append_only',
            'CageChargePeriod_closed_cage_guard',
            'AnimalMovement_closed_cage_guard',
            'Cage_closed_state_guard',
            'Cage_explicit_closure_required',
            'Animal_active_cage_assignment_guard',
            'CageChargePeriod_current_lab_guard',
            'Cage_current_charge_lab_guard',
            'Invoice_charge_period_finalization_guard',
            'InvoiceLineItem_finalized_guard',
            'Invoice_terminal_delete_guard',
            'Invoice_finalized_state_guard'
          )
      ) AS closure_trigger_count,
      (
        SELECT COUNT(*)::text
        FROM pg_constraint
        WHERE connamespace = current_schema()::regnamespace
          AND conname IN (
            'CageChargePeriod_date_order_check',
            'InvoiceLineItem_chargePeriodId_cageId_categoryId_fkey'
          )
      ) AS installed_constraint_count
  `);
  const state = result.rows[0];
  if (
    !state
    || JSON.stringify(actualCounts) !== JSON.stringify(context.baseline)
    || state.closure_table !== null
    || state.closure_function_count !== "0"
    || state.closure_index_count !== "0"
    || state.closure_trigger_count !== "0"
    || state.installed_constraint_count !== "0"
  ) {
    throw new Error(
      `${label} left partial migration state in ${context.schema}: ${JSON.stringify({ actualCounts, baseline: context.baseline, state })}.`,
    );
  }
}

async function createPreMigrationSchema(
  baseUrl: string,
  migrationRoot: string,
  label: string,
): Promise<Context> {
  const schema = retainedSchemaName(label);
  const client = new Client({ connectionString: directUrl(baseUrl) });
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);

  const migrationDirectories = (await readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name < MIGRATION_NAME)
    .map((entry) => entry.name)
    .sort();
  for (const directory of migrationDirectories) {
    const sql = await readFile(path.join(migrationRoot, directory, "migration.sql"), "utf8");
    await client.query(sql);
  }
  const baseline = await schemaObjectCounts(client);
  return { baseline, client, schema };
}

async function insertFoundation(client: Client) {
  await client.query(`
    INSERT INTO "User" (id, name, email, "passwordHash", role, active)
    VALUES ('closure-user', 'Closure verifier', 'closure-verifier@example.test', 'not-a-login-hash', 'admin', TRUE);

    INSERT INTO "Lab" (id, name, code, active, "createdAt", "updatedAt") VALUES
      ('closure-lab-a', 'Closure lab A', 'CLA', TRUE, NOW(), NOW()),
      ('closure-lab-b', 'Closure lab B', 'CLB', TRUE, NOW(), NOW());

    INSERT INTO "Facility" (id, name, "cageBarcodePrefix", "createdAt", "updatedAt")
    VALUES ('closure-facility', 'Closure facility', 'CV', NOW(), NOW());
    INSERT INTO "Room" (id, "facilityId", "roomNumber")
    VALUES ('closure-room', 'closure-facility', 'R1');
    INSERT INTO "Rack" (id, "roomId", "rackNumber")
    VALUES ('closure-rack', 'closure-room', 'A');

    INSERT INTO "CageChargeCategory" (
      id, name, code, "dailyRateCents", "currencyCode", active, "createdAt", "updatedAt"
    ) VALUES
      ('closure-category-a', 'Standard housing', 'STD-A', 125, 'USD', TRUE, NOW(), NOW()),
      ('closure-category-b', 'Alternate housing', 'STD-B', 250, 'USD', TRUE, NOW(), NOW());
  `);
}

async function reserveFacilityIdentifier(
  client: Client,
  entityType: "animal" | "cage",
  displayId: string,
) {
  await client.query(
    `UPDATE "FacilityIdentitySequence"
     SET "nextValue" = GREATEST("nextValue", $2::integer + 1), "updatedAt" = CURRENT_TIMESTAMP
     WHERE "entityType" = $1::"FacilityIdentifierType"`,
    [entityType, Number(displayId)],
  );
}

async function insertCage(
  client: Client,
  options: { id: string; facilityId: string; labId?: string; status?: "active" | "closed"; active?: boolean },
) {
  await reserveFacilityIdentifier(client, "cage", options.facilityId);
  await client.query(
    `INSERT INTO "Cage" (
      id, "facilityCageId", "labId", "roomId", "rackId", "cageNumber", barcode, status, active, "lastUpdatedAt"
    ) VALUES ($1, $2, $3, 'closure-room', 'closure-rack', $2, $4, $5, $6, '2026-01-10T00:00:00Z')`,
    [
      options.id,
      options.facilityId,
      options.labId ?? "closure-lab-a",
      `CV-${options.facilityId}`,
      options.status ?? "active",
      options.active ?? true,
    ],
  );
}

async function verifyEarlyFailure(baseUrl: string, migrationRoot: string, migrationSql: string) {
  const context = await createPreMigrationSchema(baseUrl, migrationRoot, "early_failure");
  try {
    await insertFoundation(context.client);
    await insertCage(context.client, {
      id: "inconsistent-cage",
      facilityId: "1000",
      status: "closed",
      active: true,
    });
    await applyMigrationExpectingRejection(
      context,
      migrationSql,
      "closed-active legacy fixture",
      "Closed cages still marked active",
    );
    await assertNoMigrationResidue(context, "Early migration failure");
  } finally {
    await context.client.end();
  }
  return context.schema;
}

async function verifyLateRollback(baseUrl: string, migrationRoot: string, migrationSql: string) {
  const context = await createPreMigrationSchema(baseUrl, migrationRoot, "late_rollback");
  try {
    await insertFoundation(context.client);
    await insertCage(context.client, {
      id: "late-cage",
      facilityId: "1001",
      status: "closed",
      active: false,
    });
    await context.client.query(`
      INSERT INTO "CageChargePeriod" (
        id, "cageId", "labId", "categoryId", "dailyRateCents", "currencyCode", "startedAt", "endedAt"
      ) VALUES ('late-period', 'late-cage', 'closure-lab-a', 'closure-category-a', 125, 'USD',
        '2026-01-01T00:00:00Z', NULL);
      INSERT INTO "Invoice" (
        id, "invoiceNumber", "labId", status, "periodStart", "periodEnd", "currencyCode", "subtotalCents", "updatedAt"
      ) VALUES ('late-invoice', 'LATE-001', 'closure-lab-a', 'draft',
        '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', 'USD', 125, NOW());
      INSERT INTO "InvoiceLineItem" (
        id, "invoiceId", "cageId", "chargePeriodId", "categoryId", description,
        "serviceStart", "serviceEnd", "dayCount", "dailyRateCents", "amountCents"
      ) VALUES ('late-line', 'late-invoice', 'late-cage', 'late-period', 'closure-category-b', 'Mismatched category',
        '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 1, 125, 125);
    `);
    await applyMigrationExpectingRejection(
      context,
      migrationSql,
      "late invoice-line mismatch fixture",
      "Invoice lines that disagree with their cage charge period",
    );
    await assertNoMigrationResidue(context, "Late migration failure");
    const period = await context.client.query<{ endedAt: Date | null }>(
      `SELECT "endedAt" FROM "CageChargePeriod" WHERE id = 'late-period'`,
    );
    if (period.rows[0]?.endedAt !== null) {
      throw new Error(`Late migration failure did not roll back charge-period normalization in ${context.schema}.`);
    }
  } finally {
    await context.client.end();
  }
  return context.schema;
}

async function verifyMultipleOpenFailure(baseUrl: string, migrationRoot: string, migrationSql: string) {
  const context = await createPreMigrationSchema(baseUrl, migrationRoot, "multiple_open");
  try {
    await insertFoundation(context.client);
    await insertCage(context.client, { id: "multi-open-cage", facilityId: "1002" });
    await context.client.query(`
      INSERT INTO "CageChargePeriod" (
        id, "cageId", "labId", "categoryId", "dailyRateCents", "currencyCode", "startedAt", "endedAt"
      ) VALUES
        ('multi-period-a', 'multi-open-cage', 'closure-lab-a', 'closure-category-a', 125, 'USD', '2026-01-01', NULL),
        ('multi-period-b', 'multi-open-cage', 'closure-lab-a', 'closure-category-a', 125, 'USD', '2026-01-02', NULL);
    `);
    await applyMigrationExpectingRejection(
      context,
      migrationSql,
      "multiple-open-period legacy fixture",
      "multiple open charge periods",
    );
    await assertNoMigrationResidue(context, "Multiple-open-period migration failure");
    const openCount = await context.client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count FROM "CageChargePeriod"
      WHERE "cageId" = 'multi-open-cage' AND "endedAt" IS NULL
    `);
    if (openCount.rows[0]?.count !== "2") {
      throw new Error(`Multiple-open-period failure changed its legacy fixture in ${context.schema}.`);
    }
  } finally {
    await context.client.end();
  }
  return context.schema;
}

async function verifyClosureCutoffMismatch(
  baseUrl: string,
  migrationRoot: string,
  migrationSql: string,
  variant: "last_updated" | "overlap",
) {
  const context = await createPreMigrationSchema(baseUrl, migrationRoot, `cutoff_${variant}`);
  const expectedPeriods = variant === "last_updated"
    ? [
        { endedAt: "2026-01-09T00:00:00.000", id: "cutoff-final-period" },
      ]
    : [
        { endedAt: "2026-01-15T00:00:00.000", id: "cutoff-earlier-period" },
        { endedAt: "2026-01-12T00:00:00.000", id: "cutoff-final-period" },
      ];
  try {
    await insertFoundation(context.client);
    await insertCage(context.client, {
      id: "cutoff-mismatch-cage",
      facilityId: variant === "last_updated" ? "1003" : "1004",
      status: "closed",
      active: false,
    });
    if (variant === "last_updated") {
      await context.client.query(`
        INSERT INTO "CageChargePeriod" (
          id, "cageId", "labId", "categoryId", "dailyRateCents", "currencyCode", "startedAt", "endedAt"
        ) VALUES ('cutoff-final-period', 'cutoff-mismatch-cage', 'closure-lab-a', 'closure-category-a',
          125, 'USD', '2026-01-08', '2026-01-09')
      `);
    } else {
      await context.client.query(`
        INSERT INTO "CageChargePeriod" (
          id, "cageId", "labId", "categoryId", "dailyRateCents", "currencyCode", "startedAt", "endedAt"
        ) VALUES
          ('cutoff-earlier-period', 'cutoff-mismatch-cage', 'closure-lab-a', 'closure-category-a',
            125, 'USD', '2026-01-01', '2026-01-15'),
          ('cutoff-final-period', 'cutoff-mismatch-cage', 'closure-lab-a', 'closure-category-a',
            125, 'USD', '2026-01-08', '2026-01-12')
      `);
    }

    await applyMigrationExpectingRejection(
      context,
      migrationSql,
      `${variant} legacy closure-cutoff fixture`,
      variant === "overlap"
        ? "overlapping charge periods"
        : "final charge period must end exactly at its derived closure cutoff",
    );
    await assertNoMigrationResidue(context, `${variant} closure-cutoff migration failure`);

    const periods = await context.client.query<{ endedAt: string | null; id: string }>(`
      SELECT id, to_char("endedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "endedAt"
      FROM "CageChargePeriod"
      WHERE "cageId" = 'cutoff-mismatch-cage'
      ORDER BY id
    `);
    const actualPeriods = periods.rows.map(({ endedAt, id }) => ({ endedAt, id }));
    if (JSON.stringify(actualPeriods) !== JSON.stringify(expectedPeriods)) {
      throw new Error(
        `${variant} closure-cutoff failure changed its legacy periods in ${context.schema}: ${JSON.stringify(actualPeriods)}.`,
      );
    }
    const cage = await context.client.query<{ unchanged: boolean }>(`
      SELECT "lastUpdatedAt" = TIMESTAMP '2026-01-10T00:00:00' AS unchanged
      FROM "Cage" WHERE id = 'cutoff-mismatch-cage'
    `);
    if (cage.rows[0]?.unchanged !== true) {
      throw new Error(`${variant} closure-cutoff failure changed the legacy cage cutoff in ${context.schema}.`);
    }
  } finally {
    await context.client.end();
  }
  return context.schema;
}

async function verifyMalformedTerminalFailure(
  baseUrl: string,
  migrationRoot: string,
  migrationSql: string,
  status: "finalized" | "void",
) {
  const context = await createPreMigrationSchema(baseUrl, migrationRoot, `malformed_${status}`);
  try {
    await insertFoundation(context.client);
    await context.client.query(
      `INSERT INTO "Invoice" (
        id, "invoiceNumber", "labId", status, "periodStart", "periodEnd", "currencyCode", "subtotalCents",
        "finalizedAt", "finalizedById", "voidedAt", "voidedById", "voidReason", "updatedAt"
      ) VALUES ($1, $2, 'closure-lab-a', $3, '2026-01-01', '2026-02-01', 'USD', 0,
        $4, NULL, $5, $6, $7, NOW())`,
      [
        `malformed-${status}`,
        `BAD-${status.toUpperCase()}`,
        status,
        status === "void" ? new Date("2026-01-31T00:00:00Z") : null,
        status === "void" ? new Date("2026-02-01T00:00:00Z") : null,
        status === "void" ? "closure-user" : null,
        status === "void" ? "Malformed finalized metadata" : null,
      ],
    );
    await applyMigrationExpectingRejection(context, migrationSql, `malformed preexisting ${status} invoice`);
    await assertNoMigrationResidue(context, `Malformed-${status} migration failure`);
  } finally {
    await context.client.end();
  }
  return context.schema;
}

async function verifyPrematureFinalizationFailure(
  baseUrl: string,
  migrationRoot: string,
  migrationSql: string,
) {
  const context = await createPreMigrationSchema(baseUrl, migrationRoot, "premature_finalization");
  try {
    await insertFoundation(context.client);
    await context.client.query(`
      INSERT INTO "Invoice" (
        id, "invoiceNumber", "labId", status, "periodStart", "periodEnd", "currencyCode", "subtotalCents",
        "finalizedAt", "finalizedById", "updatedAt"
      ) VALUES ('premature-finalization', 'BAD-PREMATURE', 'closure-lab-a', 'finalized',
        '2026-01-01', '2026-02-01', 'USD', 0, '2026-01-15', 'closure-user', NOW())
    `);
    await applyMigrationExpectingRejection(context, migrationSql, "premature finalized invoice");
    await assertNoMigrationResidue(context, "Premature-finalization migration failure");
  } finally {
    await context.client.end();
  }
  return context.schema;
}

async function insertSuccessfulFixture(client: Client) {
  await insertFoundation(client);
  await insertCage(client, {
    id: "closed-cage",
    facilityId: "1010",
    status: "closed",
    active: false,
  });
  await insertCage(client, { id: "open-cage", facilityId: "1011" });
  await client.query(`
    INSERT INTO "Strain" (id, name) VALUES ('closure-strain', 'Verifier strain');
    INSERT INTO "CageChargePeriod" (
      id, "cageId", "labId", "categoryId", "dailyRateCents", "currencyCode", "startedAt", "endedAt"
    ) VALUES
      ('closed-period', 'closed-cage', 'closure-lab-a', 'closure-category-a', 125, 'USD', '2026-01-01', '2026-01-10'),
      ('open-period', 'open-cage', 'closure-lab-a', 'closure-category-a', 125, 'USD', '2026-01-01', NULL);
    INSERT INTO "Invoice" (
      id, "invoiceNumber", "labId", status, "periodStart", "periodEnd", "currencyCode", "subtotalCents", "updatedAt"
    ) VALUES
      ('terminal-invoice', 'INV-001', 'closure-lab-a', 'draft', '2026-01-01', '2026-01-10', 'USD', 1125, NOW()),
      ('draft-invoice', 'INV-002', 'closure-lab-a', 'draft', '2026-01-01', '2026-01-10', 'USD', 0, NOW()),
      ('race-insert-invoice', 'INV-003', 'closure-lab-a', 'draft', '2026-01-01', '2026-01-10', 'USD', 125, NOW()),
      ('race-update-invoice', 'INV-004', 'closure-lab-a', 'draft', '2026-01-01', '2026-01-10', 'USD', 125, NOW()),
      ('race-reparent-target-invoice', 'INV-005', 'closure-lab-a', 'draft', '2026-01-01', '2026-01-10', 'USD', 0, NOW()),
      ('race-reparent-source-invoice', 'INV-006', 'closure-lab-a', 'draft', '2026-01-01', '2026-01-10', 'USD', 125, NOW()),
      ('race-delete-invoice', 'INV-007', 'closure-lab-a', 'draft', '2026-01-01', '2026-01-10', 'USD', 125, NOW());
    INSERT INTO "Invoice" (
      id, "invoiceNumber", "labId", status, "periodStart", "periodEnd", "currencyCode", "subtotalCents", "updatedAt"
    ) VALUES ('period-mutation-invoice', 'INV-008', 'closure-lab-a', 'draft',
      '2026-01-01', '2026-01-10', 'USD', 250, NOW());
    INSERT INTO "InvoiceLineItem" (
      id, "invoiceId", "cageId", "chargePeriodId", "categoryId", description,
      "serviceStart", "serviceEnd", "dayCount", "dailyRateCents", "amountCents"
    ) VALUES
      ('terminal-line', 'terminal-invoice', 'closed-cage', 'closed-period', 'closure-category-a', 'Nine days',
        '2026-01-01', '2026-01-10', 9, 125, 1125),
      ('race-insert-line', 'race-insert-invoice', 'open-cage', 'open-period', 'closure-category-a', 'One day',
        '2026-01-01', '2026-01-02', 1, 125, 125),
      ('race-update-line', 'race-update-invoice', 'open-cage', 'open-period', 'closure-category-a', 'One day',
        '2026-01-01', '2026-01-02', 1, 125, 125),
      ('race-reparent-line', 'race-reparent-source-invoice', 'open-cage', 'open-period', 'closure-category-a', 'One day',
        '2026-01-01', '2026-01-02', 1, 125, 125),
      ('race-delete-line', 'race-delete-invoice', 'open-cage', 'open-period', 'closure-category-a', 'One day',
        '2026-01-01', '2026-01-02', 1, 125, 125),
      ('period-mutation-line', 'period-mutation-invoice', 'open-cage', 'open-period', 'closure-category-a', 'Two days',
        '2026-01-01', '2026-01-03', 2, 125, 250);
  `);
}

async function verifyInstalledGuards(context: Context) {
  const client = context.client;
  const installed = await client.query<{ closure_table: string | null; closure_count: string }>(`
    SELECT to_regclass('"CageClosure"')::text AS closure_table,
      (SELECT COUNT(*)::text FROM "CageClosure" WHERE "cageId" = 'closed-cage') AS closure_count
  `);
  if (installed.rows[0]?.closure_table === null || installed.rows[0]?.closure_count !== "1") {
    throw new Error(`Migration ${MIGRATION_NAME} did not install and backfill successfully in ${context.schema}.`);
  }

  await client.query(`
    UPDATE "Invoice"
    SET status = 'finalized', "finalizedAt" = '2026-01-11', "finalizedById" = 'closure-user', "updatedAt" = NOW()
    WHERE id = 'terminal-invoice';
  `);

  await expectRejected(client, "terminal invoice DELETE", () =>
    client.query(`DELETE FROM "Invoice" WHERE id = 'terminal-invoice'`));
  await expectRejected(client, "finalized line DELETE", () =>
    client.query(`DELETE FROM "InvoiceLineItem" WHERE id = 'terminal-line'`));
  await expectRejected(client, "finalized line financial UPDATE", () =>
    client.query(`UPDATE "InvoiceLineItem" SET "amountCents" = 0 WHERE id = 'terminal-line'`));
  await expectRejected(client, "finalized line reparent UPDATE", () =>
    client.query(`UPDATE "InvoiceLineItem" SET "invoiceId" = 'draft-invoice' WHERE id = 'terminal-line'`));
  await expectRejected(client, "line INSERT into finalized invoice", () => client.query(`
    INSERT INTO "InvoiceLineItem" (
      id, "invoiceId", "cageId", "chargePeriodId", "categoryId", description,
      "serviceStart", "serviceEnd", "dayCount", "dailyRateCents", "amountCents"
    ) VALUES ('late-terminal-line', 'terminal-invoice', 'closed-cage', 'closed-period', 'closure-category-a',
      'Late line', '2026-01-01', '2026-01-02', 1, 125, 125)
  `));
  await client.query(`
    UPDATE "Invoice"
    SET status = 'finalized', "finalizedAt" = '2026-01-11', "finalizedById" = 'closure-user', "updatedAt" = NOW()
    WHERE id = 'period-mutation-invoice'
  `);
  await expectRejected(client, "terminal-invoice charge-period shortening", () => client.query(`
    UPDATE "CageChargePeriod" SET "endedAt" = '2026-01-02' WHERE id = 'open-period'
  `));
  const retainedOpenPeriod = await client.query<{ endedAt: Date | null }>(
    `SELECT "endedAt" FROM "CageChargePeriod" WHERE id = 'open-period'`,
  );
  if (retainedOpenPeriod.rows[0]?.endedAt !== null) {
    throw new Error("Rejected terminal-invoice charge-period shortening changed the protected period.");
  }
  await expectRejected(client, "malformed draft-to-void transition", async () => {
    await client.query(`UPDATE "Invoice" SET "subtotalCents" = 1 WHERE id = 'draft-invoice'`);
    await client.query(`
      UPDATE "Invoice"
      SET status = 'void', "voidedAt" = '2026-01-11', "voidedById" = 'closure-user',
        "voidReason" = 'Malformed draft verifier.', "updatedAt" = NOW()
      WHERE id = 'draft-invoice'
    `);
  });

  await reserveFacilityIdentifier(client, "animal", "0001");
  await client.query(`
    INSERT INTO "Animal" (
      id, "animalId", "facilityAnimalId", "labId", "owningLabId", sex, dob, "strainId",
      "currentCageId", status, "originType", "outcomeStatus"
    ) VALUES ('closure-animal', 'verifier-animal', '0001', 'closure-lab-a', 'closure-lab-a', 'unknown',
      '2025-12-01', 'closure-strain', NULL, 'colony_holding', 'internal', 'alive');
  `);
  await expectRejected(client, "Animal.currentCageId assignment into a closed inactive cage", async () => {
    await client.query(`UPDATE "Animal" SET "currentCageId" = 'closed-cage' WHERE id = 'closure-animal'`);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  });

  await expectRejected(client, "stale draft line beyond closure cutoff", () => client.query(`
    INSERT INTO "InvoiceLineItem" (
      id, "invoiceId", "cageId", "chargePeriodId", "categoryId", description,
      "serviceStart", "serviceEnd", "dayCount", "dailyRateCents", "amountCents"
    ) VALUES ('stale-draft-line', 'draft-invoice', 'closed-cage', 'closed-period', 'closure-category-a',
      'Stale draft', '2026-01-09', '2026-01-11', 2, 125, 250)
  `));

  await insertCage(client, { id: "wrong-lab-cage", facilityId: "1012" });
  await expectRejected(client, "open charge-period lab mismatch", async () => {
    await client.query(`
      INSERT INTO "CageChargePeriod" (
        id, "cageId", "labId", "categoryId", "dailyRateCents", "currencyCode", "startedAt", "endedAt"
      ) VALUES ('wrong-lab-period', 'wrong-lab-cage', 'closure-lab-b', 'closure-category-a', 125, 'USD', '2026-01-01', NULL)
    `);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  });

  await insertCage(client, { id: "overlap-runtime-cage", facilityId: "1013" });
  await client.query(`
    INSERT INTO "CageChargePeriod" (
      id, "cageId", "labId", "categoryId", "dailyRateCents", "currencyCode", "startedAt", "endedAt"
    ) VALUES ('overlap-runtime-period-a', 'overlap-runtime-cage', 'closure-lab-a', 'closure-category-a',
      125, 'USD', '2026-01-01', '2026-01-10')
  `);
  await expectRejected(client, "overlapping cage charge periods", () => client.query(`
    INSERT INTO "CageChargePeriod" (
      id, "cageId", "labId", "categoryId", "dailyRateCents", "currencyCode", "startedAt", "endedAt"
    ) VALUES ('overlap-runtime-period-b', 'overlap-runtime-cage', 'closure-lab-a', 'closure-category-a',
      125, 'USD', '2026-01-05', '2026-01-15')
  `));
}

function observeOperation(promise: Promise<unknown>): ObservedOperation {
  const observed: ObservedOperation = {
    promise,
    settlement: Promise.resolve(),
    settled: false,
    settledWith: undefined,
  };
  observed.settlement = promise.then(
    (value) => {
      observed.settled = true;
      observed.settledWith = value;
    },
    (error: unknown) => {
      observed.settled = true;
      observed.settledWith = error;
    },
  );
  return observed;
}

async function waitUntilBlocked(
  observer: Client,
  writerPid: number,
  blockerPid: number,
  operation: ObservedOperation,
  label: string,
) {
  const deadline = Date.now() + 15_000;
  let lastObservedState: { blocking_pids: number[]; wait_event_type: string | null } | undefined;
  while (Date.now() < deadline) {
    if (operation.settled) {
      throw new Error(`${label} settled before reaching the expected lock wait (${errorSummary(operation.settledWith)}).`);
    }
    const state = await observer.query<{ blocking_pids: number[]; wait_event_type: string | null }>(`
      SELECT activity.wait_event_type, COALESCE((
        WITH RECURSIVE blockers(pid) AS (
          SELECT UNNEST(pg_blocking_pids(activity.pid))
          UNION
          SELECT UNNEST(pg_blocking_pids(blockers.pid)) FROM blockers
        )
        SELECT ARRAY_AGG(pid) FROM blockers
      ), ARRAY[]::integer[]) AS blocking_pids
      FROM pg_stat_activity activity
      WHERE activity.pid = $1
    `, [writerPid]);
    const writerState = state.rows[0];
    lastObservedState = writerState;
    if (writerState?.wait_event_type === "Lock" && writerState.blocking_pids.includes(blockerPid)) return;
    if (operation.settled) {
      throw new Error(`${label} settled before reaching the expected lock wait (${errorSummary(operation.settledWith)}).`);
    }
    const outcome = await Promise.race([
      operation.settlement.then(() => "settled" as const),
      new Promise<"poll">((resolve) => setTimeout(() => resolve("poll"), 25)),
    ]);
    if (outcome === "settled") {
      throw new Error(`${label} settled before reaching the expected lock wait (${errorSummary(operation.settledWith)}).`);
    }
  }
  throw new Error(
    `${label} did not reach the expected lock wait within 15 seconds (${JSON.stringify({
      blockerPid,
      lastObservedState,
      writerPid,
    })}).`,
  );
}

async function verifyFinalizationRace(baseUrl: string, context: Context) {
  const writer = new Client({ connectionString: directUrl(baseUrl) });
  await writer.connect();
  await writer.query(`SET search_path TO "${context.schema}"`);
  const writerPidResult = await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const blockerPidResult = await context.client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const writerPid = writerPidResult.rows[0]?.pid;
  const blockerPid = blockerPidResult.rows[0]?.pid;
  if (writerPid === undefined || blockerPid === undefined) {
    throw new Error("Could not identify finalization-race backend PIDs.");
  }

  let activeOperation: ObservedOperation | undefined;
  try {
    const cases = [
      {
        invoiceId: "race-insert-invoice",
        label: "Finalization-vs-line-INSERT race",
        write: () => writer.query(`
          INSERT INTO "InvoiceLineItem" (
            id, "invoiceId", "cageId", "chargePeriodId", "categoryId", description,
            "serviceStart", "serviceEnd", "dayCount", "dailyRateCents", "amountCents"
          ) VALUES ('racing-insert-line', 'race-insert-invoice', 'open-cage', 'open-period', 'closure-category-a',
            'Racing insert', '2026-01-02', '2026-01-03', 1, 125, 125)
        `),
      },
      {
        invoiceId: "race-update-invoice",
        label: "Finalization-vs-line-UPDATE race",
        write: () => writer.query(`
          UPDATE "InvoiceLineItem" SET description = 'Racing update' WHERE id = 'race-update-line'
        `),
      },
      {
        invoiceId: "race-reparent-target-invoice",
        label: "Finalization-vs-line-reparent race",
        write: () => writer.query(`
          UPDATE "InvoiceLineItem" SET "invoiceId" = 'race-reparent-target-invoice'
          WHERE id = 'race-reparent-line'
        `),
      },
      {
        invoiceId: "race-delete-invoice",
        label: "Finalization-vs-line-DELETE race",
        write: () => writer.query(`DELETE FROM "InvoiceLineItem" WHERE id = 'race-delete-line'`),
      },
    ];

    for (const raceCase of cases) {
      await context.client.query("BEGIN");
      await context.client.query(`
        UPDATE "Invoice"
        SET status = 'finalized', "finalizedAt" = '2026-01-11', "finalizedById" = 'closure-user', "updatedAt" = NOW()
        WHERE id = $1
      `, [raceCase.invoiceId]);

      await writer.query("BEGIN");
      activeOperation = observeOperation(raceCase.write());
      await waitUntilBlocked(context.client, writerPid, blockerPid, activeOperation, raceCase.label);
      await context.client.query("COMMIT");

      await activeOperation.settlement;
      const rejection = activeOperation.settledWith;
      if (!(rejection instanceof Error) || (rejection as DatabaseError).code !== REJECTION_CODE) {
        throw new Error(`${raceCase.label} was not rejected (${errorSummary(rejection)}).`);
      }
      await writer.query("ROLLBACK");
      activeOperation = undefined;

      const finalized = await context.client.query<{ status: string }>(
        `SELECT status FROM "Invoice" WHERE id = $1`,
        [raceCase.invoiceId],
      );
      if (finalized.rows[0]?.status !== "finalized") {
        throw new Error(`${raceCase.label} did not commit invoice finalization.`);
      }
    }
  } catch (error) {
    await context.client.query("ROLLBACK").catch(() => undefined);
    if (activeOperation) await activeOperation.settlement;
    await writer.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await writer.end();
  }
}

async function verifyClosureChargePeriodRace(baseUrl: string, context: Context) {
  const writer = new Client({ connectionString: directUrl(baseUrl) });
  const movementWriter = new Client({ connectionString: directUrl(baseUrl) });
  await Promise.all([writer.connect(), movementWriter.connect()]);
  await writer.query(`SET search_path TO "${context.schema}"`);
  await movementWriter.query(`SET search_path TO "${context.schema}"`);
  const writerPidResult = await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const movementWriterPidResult = await movementWriter.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const blockerPidResult = await context.client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const writerPid = writerPidResult.rows[0]?.pid;
  const movementWriterPid = movementWriterPidResult.rows[0]?.pid;
  const blockerPid = blockerPidResult.rows[0]?.pid;
  if (writerPid === undefined || movementWriterPid === undefined || blockerPid === undefined) {
    throw new Error("Could not identify closure-race backend PIDs.");
  }

  const reviewPayload = {
    command: {
      cageId: "closure-race-cage",
      labId: "closure-lab-a",
      closedAt: "2026-01-10",
      reason: "Concurrent charge-period closure verification.",
      expectedChargePeriodId: "closure-race-final-period",
      expectedChargeCategoryId: "closure-category-a",
      expectedChargePeriodStartedAt: "2026-01-01T00:00:00.000Z",
      expectedDailyRateCents: 125,
      expectedCurrencyCode: "USD",
      assignments: [],
    },
    expectedVersion: 1,
  };
  let activeOperation: ObservedOperation | undefined;
  let activeMovementOperation: ObservedOperation | undefined;

  try {
    await insertCage(context.client, { id: "closure-race-cage", facilityId: "1014" });
    await context.client.query(`
      INSERT INTO "CageChargePeriod" (
        id, "cageId", "labId", "categoryId", "dailyRateCents", "currencyCode", "startedAt", "endedAt"
      ) VALUES ('closure-race-final-period', 'closure-race-cage', 'closure-lab-a', 'closure-category-a',
        125, 'USD', '2026-01-01', NULL)
    `);
    await context.client.query(`
      INSERT INTO "WorkflowDraft" (
        id, "workflowType", "actorId", "labId", status, version, payload, "updatedAt", "submittedAt"
      ) VALUES ('closure-race-draft', 'cage.closure', 'closure-user', 'closure-lab-a',
        'submitted', 1, $1::jsonb, NOW(), NOW())
    `, [JSON.stringify(reviewPayload)]);
    await context.client.query(`
      INSERT INTO "WorkflowReviewSnapshot" (
        id, "draftId", "draftVersion", payload, "payloadHash", "createdById"
      ) VALUES ('closure-race-snapshot', 'closure-race-draft', 1, $1::jsonb, 'closure-race-hash', 'closure-user')
    `, [JSON.stringify(reviewPayload)]);
    await context.client.query(`
      INSERT INTO "CommandReceipt" (
        id, "actorId", "labId", "workflowDraftId", "commandType", "idempotencyKey", "requestHash",
        "requestId", status, "aggregateType", "aggregateId", "expectedVersion"
      ) VALUES ('closure-race-receipt', 'closure-user', 'closure-lab-a', 'closure-race-draft', 'cage.close',
        'closure-race-idempotency', 'closure-race-request-hash', 'closure-race-request', 'processing',
        'cage', 'closure-race-cage', 1)
    `);

    await context.client.query("BEGIN");
    await context.client.query(`
      UPDATE "Cage"
      SET status = 'closed', active = false, version = version + 1
      WHERE id = 'closure-race-cage'
    `);
    await context.client.query(`
      UPDATE "CageChargePeriod"
      SET "endedAt" = '2026-01-10'
      WHERE id = 'closure-race-final-period'
    `);

    await writer.query("BEGIN");
    activeOperation = observeOperation(writer.query(`
      INSERT INTO "CageChargePeriod" (
        id, "cageId", "labId", "categoryId", "dailyRateCents", "currencyCode", "startedAt", "endedAt"
      ) VALUES ('closure-race-late-period', 'closure-race-cage', 'closure-lab-a', 'closure-category-a',
        125, 'USD', '2026-01-10', NULL)
    `));
    await waitUntilBlocked(
      context.client,
      writerPid,
      blockerPid,
      activeOperation,
      "Cage-closure-vs-charge-period-INSERT race",
    );
    await movementWriter.query("BEGIN");
    activeMovementOperation = observeOperation(movementWriter.query(`
      INSERT INTO "AnimalMovement" (
        id, "animalId", "fromCageId", "toCageId", "movedById", "movedAt", reason
      ) VALUES ('closure-race-late-movement', 'closure-animal', 'closure-race-cage', 'open-cage',
        'closure-user', '2026-01-10', 'Concurrent movement history verification.')
    `));
    await waitUntilBlocked(
      context.client,
      movementWriterPid,
      blockerPid,
      activeMovementOperation,
      "Cage-closure-vs-movement-INSERT race",
    );

    await context.client.query(`
      INSERT INTO "CageClosure" (
        id, "cageId", "labId", "chargePeriodId", "reviewSnapshotId", "closedAt", "billingCutoffAt",
        reason, "closedById"
      ) VALUES ('closure-race-record', 'closure-race-cage', 'closure-lab-a', 'closure-race-final-period',
        'closure-race-snapshot', '2026-01-10', '2026-01-10',
        'Concurrent charge-period closure verification.', 'closure-user')
    `);
    await context.client.query("COMMIT");

    await Promise.all([activeOperation.settlement, activeMovementOperation.settlement]);
    const raceRejections = [
      ["period", activeOperation.settledWith],
      ["movement", activeMovementOperation.settledWith],
    ] as const;
    for (const [label, rejection] of raceRejections) {
      if (!(rejection instanceof Error) || (rejection as DatabaseError).code !== REJECTION_CODE) {
        throw new Error(`Closure-vs-${label} race was not rejected (${errorSummary(rejection)}).`);
      }
    }
    await Promise.all([writer.query("ROLLBACK"), movementWriter.query("ROLLBACK")]);
    activeOperation = undefined;
    activeMovementOperation = undefined;

    const persisted = await context.client.query<{
      closure_count: string;
      late_movement_count: string;
      late_period_count: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM "CageClosure" WHERE "cageId" = 'closure-race-cage') AS closure_count,
        (SELECT COUNT(*)::text FROM "CageChargePeriod" WHERE id = 'closure-race-late-period') AS late_period_count,
        (SELECT COUNT(*)::text FROM "AnimalMovement" WHERE id = 'closure-race-late-movement') AS late_movement_count
    `);
    if (
      persisted.rows[0]?.closure_count !== "1"
      || persisted.rows[0]?.late_period_count !== "0"
      || persisted.rows[0]?.late_movement_count !== "0"
    ) {
      throw new Error("Closure-vs-period race did not preserve the permanent cutoff.");
    }
  } catch (error) {
    await context.client.query("ROLLBACK").catch(() => undefined);
    if (activeOperation) await activeOperation.settlement;
    if (activeMovementOperation) await activeMovementOperation.settlement;
    await Promise.all([
      writer.query("ROLLBACK").catch(() => undefined),
      movementWriter.query("ROLLBACK").catch(() => undefined),
    ]);
    throw error;
  } finally {
    await Promise.all([writer.end(), movementWriter.end()]);
  }
}

async function verifySuccessfulInstallation(baseUrl: string, migrationRoot: string, migrationSql: string) {
  const context = await createPreMigrationSchema(baseUrl, migrationRoot, "installed_guards");
  try {
    await insertSuccessfulFixture(context.client);
    await context.client.query(migrationSql);
    await verifyInstalledGuards(context);
    await verifyFinalizationRace(baseUrl, context);
    await verifyClosureChargePeriodRace(baseUrl, context);
  } finally {
    await context.client.end();
  }
  return context.schema;
}

async function main() {
  const baseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required for cage-closure migration verification.");
  assertRetainedVerificationTarget(baseUrl);

  const migrationRoot = path.resolve(process.cwd(), "prisma/migrations");
  const migrationSql = await readFile(path.join(migrationRoot, MIGRATION_NAME, "migration.sql"), "utf8");
  const retainedSchemas: string[] = [];

  retainedSchemas.push(await verifyEarlyFailure(baseUrl, migrationRoot, migrationSql));
  retainedSchemas.push(await verifyLateRollback(baseUrl, migrationRoot, migrationSql));
  retainedSchemas.push(await verifyMultipleOpenFailure(baseUrl, migrationRoot, migrationSql));
  retainedSchemas.push(await verifyClosureCutoffMismatch(baseUrl, migrationRoot, migrationSql, "last_updated"));
  retainedSchemas.push(await verifyClosureCutoffMismatch(baseUrl, migrationRoot, migrationSql, "overlap"));
  retainedSchemas.push(await verifyMalformedTerminalFailure(baseUrl, migrationRoot, migrationSql, "finalized"));
  retainedSchemas.push(await verifyMalformedTerminalFailure(baseUrl, migrationRoot, migrationSql, "void"));
  retainedSchemas.push(await verifyPrematureFinalizationFailure(baseUrl, migrationRoot, migrationSql));
  retainedSchemas.push(await verifySuccessfulInstallation(baseUrl, migrationRoot, migrationSql));

  console.info(`Cage-closure migration installation, rollback, raw-SQL guards, and race verified.`);
  console.info(`Retained schemas (no objects deleted): ${retainedSchemas.join(", ")}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
