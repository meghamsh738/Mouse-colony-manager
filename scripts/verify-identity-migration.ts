import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";

import { Client } from "pg";

import { assertRetainedVerificationTarget } from "./retained-verification-guard";

const PRE_IDENTITY_MIGRATIONS = [
  "0001_init",
  "0002_sample_records",
  "0003_cryostorage_records",
  "0004_role_foundation",
  "0005_schema_reconciliation",
  "0006_identity_governance",
  "0007_identity_governance_constraints",
  "0008_explicit_lab_ownership",
  "0009_same_lab_integrity",
] as const;
const ALL_IDENTITY_MIGRATIONS = [...PRE_IDENTITY_MIGRATIONS, "0010_command_identity_foundation"] as const;

async function currentMigrations() {
  const entries = await readdir("prisma/migrations", { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^\d{4}_.+/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function databaseUrlForSchema(rawUrl: string, schema: string) {
  const url = new URL(rawUrl);
  url.searchParams.set("schema", schema);
  url.searchParams.delete("pgbouncer");
  return url.toString();
}

function pgConnectionUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  for (const parameter of [
    "schema",
    "pgbouncer",
    "statement_cache_size",
    "connection_limit",
    "connect_timeout",
    "max_idle_connection_lifetime",
    "pool_timeout",
    "socket_timeout",
  ]) url.searchParams.delete(parameter);
  return url.toString();
}

function productionLikeVerificationUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (/(^|_)(test|e2e|disposable)($|_)/i.test(databaseName)) {
    // The retained verification cluster is local and disposable, but this one
    // probe must run in a database whose name does not activate the seed bypass.
    // It still creates only a uniquely named, isolated verification schema.
    url.pathname = "/postgres";
  }
  return url.toString();
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += String(chunk); });
    child.stderr?.on("data", (chunk) => { output += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function openMigrationSchema(baseUrl: string, schema: string, migrations: readonly string[]) {
  const client = new Client({ connectionString: pgConnectionUrl(baseUrl) });
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  for (const migration of migrations) {
    const sql = await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8");
    await client.query(sql);
  }
  return client;
}

async function verifyNumericAliasBackfill(baseUrl: string) {
  const schema = `mcm_verify_identity_alias_${Date.now()}_${process.pid}`;
  const client = await openMigrationSchema(baseUrl, schema, PRE_IDENTITY_MIGRATIONS);
  try {
    await client.query(`
      INSERT INTO "User" (id, name, email, "passwordHash", role, active)
      VALUES ('alias-user', 'Alias User', 'alias-user@example.test', 'not-a-login-hash', 'facility_admin'::"UserRole", TRUE);
      INSERT INTO "Lab" (id, name, code, active, "createdAt", "updatedAt")
      VALUES ('alias-lab', 'Alias Lab', 'ALIAS', TRUE, NOW(), NOW());
      INSERT INTO "Strain" (id, name) VALUES ('alias-strain', 'Alias strain');
      INSERT INTO "Animal" (id, "animalId", "labId", "owningLabId", sex, dob, "strainId", status, "originType") VALUES
        ('alias-animal-a', '0001', 'LEGACY-A', 'alias-lab', 'female'::"Sex", NOW(), 'alias-strain', 'colony_holding'::"AnimalStatus", 'retained'),
        ('alias-animal-b', 'LEGACY-B', '0002', 'alias-lab', 'male'::"Sex", NOW(), 'alias-strain', 'colony_holding'::"AnimalStatus", 'retained');
    `);
    const identityMigration = await readFile("prisma/migrations/0010_command_identity_foundation/migration.sql", "utf8");
    await client.query(identityMigration);

    const animals = await client.query<{ id: string; facilityAnimalId: string }>(
      `SELECT id, "facilityAnimalId" FROM "Animal" ORDER BY id`,
    );
    if (animals.rows.some((animal) => ["0001", "0002"].includes(animal.facilityAnimalId))) {
      throw new Error(`Numeric aliases were reused as canonical IDs: ${JSON.stringify(animals.rows)}.`);
    }
    const aliases = await client.query<{ alias: string; entityId: string }>(`
      SELECT alias, "entityId" FROM "LegacyIdentifierAlias"
      WHERE "entityType" = 'animal' AND alias IN ('0001', '0002') ORDER BY alias
    `);
    if (aliases.rows.map((alias) => `${alias.alias}:${alias.entityId}`).join(",") !== "0001:alias-animal-a,0002:alias-animal-b") {
      throw new Error(`Numeric alias mapping changed during backfill: ${JSON.stringify(aliases.rows)}.`);
    }

    const expectCollision = async (savepoint: string, sql: string) => {
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        await client.query(sql);
        throw new Error(`Identity collision statement unexpectedly succeeded at ${savepoint}.`);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (code !== "23505") throw error;
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      }
    };

    await client.query("BEGIN");
    await client.query(`INSERT INTO "LegacyIdentifierAlias"
      (id, "entityType", "entityId", alias, "canonicalDisplayId", source)
      VALUES ('animal-alias-first', 'animal', 'historical-animal', '0999', '0003', 'verification')`);
    await expectCollision("animal_alias_first", `INSERT INTO "FacilityIdentifierAssignment"
      (id, "entityType", "sequenceValue", "displayId", "entityId")
      VALUES ('animal-assignment-conflict', 'animal', 999, '0999', 'new-animal')`);

    await client.query(`INSERT INTO "FacilityIdentifierAssignment"
      (id, "entityType", "sequenceValue", "displayId", "entityId")
      VALUES ('animal-assignment-first', 'animal', 998, '0998', 'canonical-animal')`);
    await expectCollision("animal_assignment_first", `INSERT INTO "LegacyIdentifierAlias"
      (id, "entityType", "entityId", alias, "canonicalDisplayId", source)
      VALUES ('animal-alias-conflict', 'animal', 'other-animal', '0998', '0003', 'verification')`);

    await client.query(`INSERT INTO "LegacyIdentifierAlias"
      (id, "entityType", "entityId", alias, "canonicalDisplayId", source)
      VALUES ('cage-alias-first', 'cage', 'historical-cage', '9000', '1000', 'verification')`);
    await expectCollision("cage_alias_first", `INSERT INTO "FacilityIdentifierAssignment"
      (id, "entityType", "sequenceValue", "displayId", "entityId")
      VALUES ('cage-assignment-conflict', 'cage', 9000, '9000', 'new-cage')`);

    await client.query(`INSERT INTO "FacilityIdentifierAssignment"
      (id, "entityType", "sequenceValue", "displayId", "entityId")
      VALUES ('cage-assignment-first', 'cage', 9001, '9001', 'canonical-cage')`);
    await expectCollision("cage_assignment_first", `INSERT INTO "LegacyIdentifierAlias"
      (id, "entityType", "entityId", alias, "canonicalDisplayId", source)
      VALUES ('cage-alias-conflict', 'cage', 'other-cage', '9001', '1000', 'verification')`);
    await client.query("COMMIT");

    const expectDeferredCollision = async (label: string, statements: string) => {
      await client.query("BEGIN");
      try {
        await client.query(statements);
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        throw new Error(`Deferred identity collision unexpectedly succeeded for ${label}.`);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        await client.query("ROLLBACK");
        if (code !== "23505") throw error;
      }
    };

    await client.query(`UPDATE "FacilityIdentitySequence" SET "nextValue" = 6 WHERE "entityType" = 'animal'`);
    await expectDeferredCollision("animal alias introduced after allocation", `
      INSERT INTO "Animal" (id, "facilityAnimalId", "animalId", "labId", "owningLabId", sex, dob, "strainId", status, "originType")
      VALUES ('deferred-animal', '0005', 'DEFERRED-ANIMAL', 'DEFERRED-LAB', 'alias-lab', 'female', NOW(), 'alias-strain', 'colony_holding', 'verification');
      INSERT INTO "LegacyIdentifierAlias" (id, "entityType", "entityId", alias, "canonicalDisplayId", source)
      VALUES ('deferred-animal-alias', 'animal', 'historical-animal', '0005', '0003', 'verification');
    `);

    await client.query(`
      INSERT INTO "Facility" (id, name, "cageBarcodePrefix", "maxCageOccupancy", "createdAt", "updatedAt")
      VALUES ('deferred-facility', 'Deferred Facility', 'DF', 6, NOW(), NOW());
      INSERT INTO "Room" (id, "facilityId", "roomNumber") VALUES ('deferred-room', 'deferred-facility', 'D1');
      INSERT INTO "Rack" (id, "roomId", "rackNumber") VALUES ('deferred-rack', 'deferred-room', 'R1');
      UPDATE "FacilityIdentitySequence" SET "nextValue" = 1001 WHERE "entityType" = 'cage';
    `);
    await expectDeferredCollision("cage alias introduced after allocation", `
      INSERT INTO "Cage" (id, "facilityCageId", "labId", "roomId", "rackId", "cageNumber", barcode, status)
      VALUES ('deferred-cage', '1000', 'alias-lab', 'deferred-room', 'deferred-rack', '001', 'DEFERRED-CAGE', 'active');
      INSERT INTO "LegacyIdentifierAlias" (id, "entityType", "entityId", alias, "canonicalDisplayId", source)
      VALUES ('deferred-cage-alias', 'cage', 'historical-cage', '1000', '1001', 'verification');
    `);
  } finally {
    await client.end();
  }
  return schema;
}

async function verifyBootstrapRefusesAssignments(baseUrl: string) {
  const schema = `mcm_test_empty_assignment_${Date.now()}_${process.pid}`;
  const client = await openMigrationSchema(baseUrl, schema, await currentMigrations());
  try {
    await client.query(`
      INSERT INTO "FacilityIdentifierAssignment" (id, "entityType", "sequenceValue", "displayId", "entityId")
      VALUES ('retained-assignment', 'animal', 1, '0001', 'deleted-animal')
    `);
  } finally {
    await client.end();
  }

  const targetUrl = databaseUrlForSchema(baseUrl, schema);
  const pooledUrl = new URL(targetUrl);
  pooledUrl.searchParams.set("pgbouncer", "true");
  pooledUrl.searchParams.set("statement_cache_size", "0");
  const env = {
    ...process.env,
    DATABASE_URL: pooledUrl.toString(),
    DIRECT_DATABASE_URL: targetUrl,
    EMPTY_COLONY_BOOTSTRAP: "true",
    EMPTY_ADMIN_PASSWORD: "identity-verification-only",
    EMPTY_PROFILE_INSTANCE_ID: `identity-verification-${Date.now()}`,
  };
  const result = await run("npm", ["run", "db:seed:empty"], env);
  if (result.code === 0 || !result.output.includes("identifierAssignments=1")) {
    throw new Error(`Empty bootstrap did not refuse a retained identity assignment:\n${result.output}`);
  }
  return schema;
}

async function verifyProductionLikeImmutability(baseUrl: string) {
  const databaseName = new URL(baseUrl).pathname.slice(1);
  if (/(^|_)(test|e2e|disposable)($|_)/i.test(databaseName)) {
    throw new Error("Production-like immutability verification requires a local database name without disposable markers.");
  }
  const schema = `mcm_verify_immutable_guard_${Date.now()}_${process.pid}`;
  const client = await openMigrationSchema(baseUrl, schema, ALL_IDENTITY_MIGRATIONS);
  try {
    await client.query(`
      INSERT INTO "User" (id, name, email, "passwordHash", role, active)
      VALUES ('immutable-user', 'Immutable User', 'immutable-user@example.test', 'not-a-login-hash', 'facility_admin'::"UserRole", TRUE);
      INSERT INTO "WorkflowDraft" (id, "workflowType", "actorId", payload, "updatedAt")
      VALUES ('immutable-draft', 'verification', 'immutable-user', '{}'::jsonb, NOW());
      INSERT INTO "WorkflowReviewSnapshot" (id, "draftId", "draftVersion", payload, "payloadHash", "createdById")
      VALUES ('immutable-snapshot', 'immutable-draft', 1, '{}'::jsonb, 'original', 'immutable-user');
    `);
    let rejected = false;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL mcm.allow_destructive_seed = 'true'");
      await client.query(`UPDATE "WorkflowReviewSnapshot" SET "payloadHash" = 'mutated' WHERE id = 'immutable-snapshot'`);
      await client.query("COMMIT");
    } catch (error) {
      rejected = String(error).includes("rows are append-only");
      await client.query("ROLLBACK");
    }
    if (!rejected) throw new Error("Production-like schema accepted the disposable fixture bypass.");
  } finally {
    await client.end();
  }
  return schema;
}

async function main() {
  const baseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required.");
  assertRetainedVerificationTarget(baseUrl);

  const aliasSchema = await verifyNumericAliasBackfill(baseUrl);
  const bootstrapSchema = await verifyBootstrapRefusesAssignments(baseUrl);
  const immutableSchema = await verifyProductionLikeImmutability(
    productionLikeVerificationUrl(baseUrl),
  );
  console.log(`Identity migration safety passed in retained schemas ${aliasSchema}, ${bootstrapSchema}, and ${immutableSchema}.`);
  console.log("No verification schema was deleted.");
}

if (process.argv[1]?.endsWith("verify-identity-migration.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
