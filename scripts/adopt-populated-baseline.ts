import { spawn } from "node:child_process";

import { PrismaClient } from "@prisma/client";

const BASELINE_MIGRATIONS = [
  "0001_init",
  "0002_sample_records",
  "0003_cryostorage_records",
  "0004_role_foundation",
  "0005_schema_reconciliation",
] as const;

export function populatedBaselineConfirmationErrors(input: {
  apply: boolean;
  confirmation?: string;
  backupId?: string;
}) {
  if (!input.apply) return [];
  const errors: string[] = [];
  if (input.confirmation !== "ZERO_DIFF_BACKUP_VERIFIED") {
    errors.push("POPULATED_BASELINE_CONFIRM must equal ZERO_DIFF_BACKUP_VERIFIED");
  }
  if (!input.backupId?.trim()) errors.push("POPULATED_BACKUP_ID is required");
  return errors;
}

function databaseUrlForSchema(rawUrl: string, schema: string) {
  const url = new URL(rawUrl);
  url.searchParams.set("schema", schema);
  url.searchParams.delete("pgbouncer");
  return url.toString();
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`${[command, ...args].join(" ")} failed with ${signal ?? `exit code ${code}`}.`));
    });
  });
}

async function main() {
  const baseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required.");

  const apply = process.argv.includes("--apply");
  const confirmationErrors = populatedBaselineConfirmationErrors({
    apply,
    confirmation: process.env.POPULATED_BASELINE_CONFIRM,
    backupId: process.env.POPULATED_BACKUP_ID,
  });
  if (confirmationErrors.length) throw new Error(`Populated baseline adoption refused: ${confirmationErrors.join("; ")}.`);

  const directUrl = databaseUrlForSchema(baseUrl, new URL(baseUrl).searchParams.get("schema") ?? "public");
  const administration = new PrismaClient({ datasources: { db: { url: directUrl } } });
  const applied = await administration.$queryRawUnsafe<Array<{ migration_name: string }>>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at`,
  );
  const appliedNames = new Set(applied.map((migration) => migration.migration_name));
  if (!appliedNames.has("0004_role_foundation") || appliedNames.has("0005_schema_reconciliation")) {
    await administration.$disconnect();
    throw new Error("Target must have completed 0004 and must not already record 0005.");
  }

  const verificationSchema = `mcm_populated_baseline_${Date.now()}_${process.pid}`;
  const safeSchema = verificationSchema.replaceAll('"', '""');
  await administration.$executeRawUnsafe(`CREATE SCHEMA "${safeSchema}"`);
  await administration.$disconnect();

  const baselineUrl = databaseUrlForSchema(baseUrl, verificationSchema);
  const baselineEnv = { ...process.env, DATABASE_URL: baselineUrl, DIRECT_DATABASE_URL: baselineUrl };
  for (const migration of BASELINE_MIGRATIONS) {
    await run("npx", ["prisma", "db", "execute", "--file", `prisma/migrations/${migration}/migration.sql`], baselineEnv);
  }

  await run("npx", [
    "prisma",
    "migrate",
    "diff",
    "--from-url",
    directUrl,
    "--to-url",
    baselineUrl,
    "--exit-code",
  ], { ...process.env, DATABASE_URL: directUrl, DIRECT_DATABASE_URL: directUrl });

  console.log(`Populated schema matches the 0005 baseline. Verification schema retained: ${verificationSchema}.`);
  if (!apply) {
    console.log("Dry run only. Re-run with --apply and the required confirmation/backup variables to resolve 0005 and deploy later migrations.");
    return;
  }

  const targetEnv = { ...process.env, DATABASE_URL: directUrl, DIRECT_DATABASE_URL: directUrl };
  await run("npx", ["prisma", "migrate", "resolve", "--applied", "0005_schema_reconciliation"], targetEnv);
  await run("npx", ["prisma", "migrate", "deploy"], targetEnv);
  console.log(`Baseline adopted and later migrations deployed. Backup evidence: ${process.env.POPULATED_BACKUP_ID}.`);
}

if (process.argv[1]?.endsWith("adopt-populated-baseline.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
