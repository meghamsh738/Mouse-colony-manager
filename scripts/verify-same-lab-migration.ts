import { spawn } from "node:child_process";

import { assertRetainedVerificationTarget } from "./retained-verification-guard";

const PRE_INTEGRITY_MIGRATIONS = [
  "0001_init",
  "0002_sample_records",
  "0003_cryostorage_records",
  "0004_role_foundation",
  "0005_schema_reconciliation",
  "0006_identity_governance",
  "0007_identity_governance_constraints",
  "0008_explicit_lab_ownership",
] as const;

function databaseUrlForSchema(rawUrl: string, schema: string) {
  const url = new URL(rawUrl);
  url.searchParams.set("schema", schema);
  url.searchParams.delete("pgbouncer");
  return url.toString();
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, input?: string) {
  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += String(chunk); });
    child.stderr?.on("data", (chunk) => { output += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? 1, output }));
    if (input !== undefined) child.stdin?.end(input);
  });
}

async function main() {
  const baseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required.");
  assertRetainedVerificationTarget(baseUrl);

  const schema = `mcm_test_same_lab_mismatch_${Date.now()}_${process.pid}`;
  const baseDirectUrl = databaseUrlForSchema(baseUrl, new URL(baseUrl).searchParams.get("schema") ?? "public");
  const createSchema = await run(
    "npx",
    ["prisma", "db", "execute", "--url", baseDirectUrl, "--stdin"],
    process.env,
    `CREATE SCHEMA "${schema}";`,
  );
  if (createSchema.code !== 0) throw new Error(`Could not create retained mismatch schema:\n${createSchema.output}`);

  const targetUrl = databaseUrlForSchema(baseUrl, schema);
  const env = { ...process.env, DATABASE_URL: targetUrl, DIRECT_DATABASE_URL: targetUrl };
  for (const migration of PRE_INTEGRITY_MIGRATIONS) {
    const result = await run("npx", ["prisma", "db", "execute", "--url", targetUrl, "--file", `prisma/migrations/${migration}/migration.sql`], env);
    if (result.code !== 0) throw new Error(`${migration} fixture setup failed:\n${result.output}`);
  }

  const fixture = await run("npx", ["prisma", "db", "execute", "--url", targetUrl, "--stdin"], env, `
    INSERT INTO "User" (id, name, email, "passwordHash", role, active)
    VALUES ('integrity-user', 'Integrity User', 'integrity@example.test', 'not-a-login-hash', 'facility_admin'::"UserRole", TRUE);
    INSERT INTO "Lab" (id, name, code, active, "createdAt", "updatedAt")
    VALUES
      ('integrity-lab-a', 'Integrity Lab A', 'INT-A', TRUE, NOW(), NOW()),
      ('integrity-lab-b', 'Integrity Lab B', 'INT-B', TRUE, NOW(), NOW());
    INSERT INTO "Project" (id, "labId", "projectCode", title, "ownerId")
    VALUES ('integrity-project-b', 'integrity-lab-b', 'INT-PROJECT-B', 'Lab B project', 'integrity-user');
    INSERT INTO "Experiment" (id, "labId", "experimentCode", "projectId", title, "ownerId", status)
    VALUES ('integrity-experiment-a', 'integrity-lab-a', 'INT-EXP-A', 'integrity-project-b', 'Mismatched experiment', 'integrity-user', 'planned'::"ExperimentStatus");
  `);
  if (fixture.code !== 0) throw new Error(`Could not create mismatch fixture:\n${fixture.output}`);

  const rejected = await run("npx", ["prisma", "db", "execute", "--url", targetUrl, "--file", "prisma/migrations/0009_same_lab_integrity/migration.sql"], env);
  if (rejected.code === 0 || !rejected.output.includes("Experiment.project contains a lab mismatch")) {
    throw new Error(`Migration 0009 did not fail closed for a mismatched Experiment.project relation:\n${rejected.output}`);
  }

  console.log(`Migration 0009 rejected a retained cross-lab mismatch in schema ${schema}.`);
  console.log("The mismatch schema is intentionally retained for inspection; no database objects were deleted.");
}

if (process.argv[1]?.endsWith("verify-same-lab-migration.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
