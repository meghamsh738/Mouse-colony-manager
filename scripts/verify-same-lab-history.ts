import { spawn } from "node:child_process";

import { PrismaClient } from "@prisma/client";

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
    const child = spawn(command, args, {
      env,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += String(chunk); });
    child.stderr?.on("data", (chunk) => { output += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? 1, output }));
    if (input !== undefined) child.stdin?.end(input);
  });
}

async function executeSql(url: string, env: NodeJS.ProcessEnv, sqlOrFile: { sql: string } | { file: string }) {
  const args = ["prisma", "db", "execute", "--url", url];
  if ("file" in sqlOrFile) args.push("--file", sqlOrFile.file);
  else args.push("--stdin");

  const result = await run("npx", args, env, "sql" in sqlOrFile ? sqlOrFile.sql : undefined);
  if (result.code !== 0) throw new Error(`${args.join(" ")} failed:\n${result.output}`);
}

async function main() {
  const baseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required.");
  assertRetainedVerificationTarget(baseUrl);

  const schema = `mcm_verify_same_lab_history_${Date.now()}_${process.pid}`;
  const baseSchema = new URL(baseUrl).searchParams.get("schema") ?? "public";
  const administrativeUrl = databaseUrlForSchema(baseUrl, baseSchema);
  await executeSql(administrativeUrl, process.env, { sql: `CREATE SCHEMA "${schema}";` });

  const targetUrl = databaseUrlForSchema(baseUrl, schema);
  const env = { ...process.env, DATABASE_URL: targetUrl, DIRECT_DATABASE_URL: targetUrl };

  for (const migration of PRE_INTEGRITY_MIGRATIONS) {
    await executeSql(targetUrl, env, { file: `prisma/migrations/${migration}/migration.sql` });
  }

  await executeSql(targetUrl, env, { sql: `
    INSERT INTO "User" (id, name, email, "passwordHash", role, active)
    VALUES ('history-user', 'History Verifier', 'history-verifier@example.test', 'not-a-login-hash', 'facility_admin'::"UserRole", TRUE);

    INSERT INTO "Lab" (id, name, code, active, "createdAt", "updatedAt") VALUES
      ('history-lab-a', 'History Lab A', 'HIST-A', TRUE, NOW(), NOW()),
      ('history-lab-b', 'History Lab B', 'HIST-B', TRUE, NOW(), NOW());

    INSERT INTO "Strain" (id, name) VALUES ('history-strain', 'History strain');

    INSERT INTO "Project" (id, "labId", "projectCode", title, "ownerId")
    VALUES ('history-project-a', 'history-lab-a', 'HIST-PROJECT-A', 'Historical project', 'history-user');

    INSERT INTO "Experiment" (id, "labId", "experimentCode", "projectId", title, "ownerId", status)
    VALUES ('history-experiment-a', 'history-lab-a', 'HIST-EXP-A', 'history-project-a', 'Historical experiment', 'history-user', 'completed'::"ExperimentStatus");

    INSERT INTO "AnimalIntakeBatch" (id, "labId", vendor, "orderReference", "arrivalDate", disposition, "createdById")
    VALUES ('history-intake-a', 'history-lab-a', 'Historical vendor', 'HIST-ORDER', NOW(), 'holding'::"AnimalIntakeDisposition", 'history-user');

    INSERT INTO "Animal" (id, "animalId", "labId", "owningLabId", sex, dob, "strainId", status, "originType", "intakeBatchId") VALUES
      ('history-animal-completed', 'HIST-001', 'HIST-LAB-001', 'history-lab-b', 'female'::"Sex", NOW(), 'history-strain', 'experiment_completed'::"AnimalStatus", 'historical', NULL),
      ('history-animal-cancelled', 'HIST-002', 'HIST-LAB-002', 'history-lab-b', 'male'::"Sex", NOW(), 'history-strain', 'colony_holding'::"AnimalStatus", 'historical', NULL),
      ('history-animal-allocation', 'HIST-003', 'HIST-LAB-003', 'history-lab-b', 'female'::"Sex", NOW(), 'history-strain', 'colony_holding'::"AnimalStatus", 'historical', NULL),
      ('history-animal-retired', 'HIST-004', 'HIST-LAB-004', 'history-lab-b', 'female'::"Sex", NOW(), 'history-strain', 'archived'::"AnimalStatus", 'historical', NULL),
      ('history-animal-failed', 'HIST-005', 'HIST-LAB-005', 'history-lab-b', 'male'::"Sex", NOW(), 'history-strain', 'archived'::"AnimalStatus", 'historical', NULL),
      ('history-animal-intake', 'HIST-006', 'HIST-LAB-006', 'history-lab-b', 'unknown'::"Sex", NOW(), 'history-strain', 'colony_holding'::"AnimalStatus", 'historical', 'history-intake-a');

    INSERT INTO "ExperimentAssignment" (id, "animalId", "experimentId", status, "startDate", "endDate") VALUES
      ('history-assignment-completed', 'history-animal-completed', 'history-experiment-a', 'completed'::"AssignmentStatus", NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day'),
      ('history-assignment-cancelled', 'history-animal-cancelled', 'history-experiment-a', 'cancelled'::"AssignmentStatus", NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day');

    INSERT INTO "AnimalProjectAllocation" (id, "animalId", "projectId", "startedAt", "endedAt")
    VALUES ('history-allocation-ended', 'history-animal-allocation', 'history-project-a', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day');

    INSERT INTO "BreedingSetup" (id, "labId", "startDate", "endDate", status, "targetGenotype") VALUES
      ('history-breeding-retired', 'history-lab-a', NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 day', 'retired'::"BreedingStatus", 'historical'),
      ('history-breeding-failed', 'history-lab-a', NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 day', 'failed'::"BreedingStatus", 'historical');

    INSERT INTO "BreedingAdult" (id, "breedingSetupId", "animalId", role) VALUES
      ('history-adult-retired', 'history-breeding-retired', 'history-animal-retired', 'dam'::"BreedingAdultRole"),
      ('history-adult-failed', 'history-breeding-failed', 'history-animal-failed', 'sire'::"BreedingAdultRole");
  ` });

  await executeSql(targetUrl, env, { file: "prisma/migrations/0009_same_lab_integrity/migration.sql" });

  const verification = new PrismaClient({ datasources: { db: { url: targetUrl } } });
  try {
    const [evidence] = await verification.$queryRawUnsafe<Array<{
      completed_cancelled_assignments: number;
      ended_allocations: number;
      retired_failed_breeding_adults: number;
      cross_lab_intake_provenance: number;
    }>>(`
      SELECT
        (SELECT COUNT(*)::int FROM "ExperimentAssignment" assignment
          JOIN "Experiment" experiment ON experiment.id = assignment."experimentId"
          JOIN "Animal" animal ON animal.id = assignment."animalId"
          WHERE assignment.id LIKE 'history-assignment-%'
            AND assignment.status IN ('completed', 'cancelled')
            AND experiment."labId" IS DISTINCT FROM animal."owningLabId") AS completed_cancelled_assignments,
        (SELECT COUNT(*)::int FROM "AnimalProjectAllocation" allocation
          JOIN "Project" project ON project.id = allocation."projectId"
          JOIN "Animal" animal ON animal.id = allocation."animalId"
          WHERE allocation.id = 'history-allocation-ended'
            AND allocation."endedAt" IS NOT NULL
            AND project."labId" IS DISTINCT FROM animal."owningLabId") AS ended_allocations,
        (SELECT COUNT(*)::int FROM "BreedingAdult" adult
          JOIN "BreedingSetup" setup ON setup.id = adult."breedingSetupId"
          JOIN "Animal" animal ON animal.id = adult."animalId"
          WHERE adult.id LIKE 'history-adult-%'
            AND setup.status IN ('retired', 'failed')
            AND setup."labId" IS DISTINCT FROM animal."owningLabId") AS retired_failed_breeding_adults,
        (SELECT COUNT(*)::int FROM "Animal" animal
          JOIN "AnimalIntakeBatch" batch ON batch.id = animal."intakeBatchId"
          WHERE animal.id = 'history-animal-intake'
            AND batch."labId" IS DISTINCT FROM animal."owningLabId") AS cross_lab_intake_provenance
    `);

    const expected = {
      completed_cancelled_assignments: 2,
      ended_allocations: 1,
      retired_failed_breeding_adults: 2,
      cross_lab_intake_provenance: 1,
    };
    if (!evidence || Object.entries(expected).some(([key, count]) => evidence[key as keyof typeof evidence] !== count)) {
      throw new Error(`Migration applied but retained-history evidence was unexpected: ${JSON.stringify(evidence)}`);
    }

    console.log(`Migration 0009 retained allowed cross-lab history in schema ${schema}.`);
    console.log(`Evidence: ${JSON.stringify(evidence)}`);
    console.log("The verification schema is intentionally retained; this command never deletes database objects.");
  } finally {
    await verification.$disconnect();
  }
}

if (process.argv[1]?.endsWith("verify-same-lab-history.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
