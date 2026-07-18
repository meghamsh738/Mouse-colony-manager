import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertRetainedVerificationTarget } from "./retained-verification-guard";

export function databaseUrlForSchema(rawUrl: string, schema: string, pooled: boolean) {
  const url = new URL(rawUrl);
  url.searchParams.set("schema", schema);

  if (pooled) {
    url.searchParams.set("pgbouncer", "true");
  } else {
    url.searchParams.delete("pgbouncer");
  }

  return url.toString();
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${[command, ...args].join(" ")} failed with ${signal ?? `exit code ${code}`}.`));
    });
  });
}

async function expectExactCheckViolation(
  db: PrismaClient,
  statement: string,
  expectedMessage: string,
) {
  const escapedMessage = expectedMessage.replaceAll("'", "''");
  await db.$executeRawUnsafe(`
    DO $verification$
    DECLARE
      observed_message text;
    BEGIN
      BEGIN
        ${statement};
        SET CONSTRAINTS ALL IMMEDIATE;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Expected check violation was not raised';
      EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS observed_message = MESSAGE_TEXT;
        IF observed_message IS DISTINCT FROM '${escapedMessage}' THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'Unexpected check violation message: ' || COALESCE(observed_message, '<null>');
        END IF;
      END;
    END $verification$;
  `);
}

async function expectExactDatabaseError(
  db: PrismaClient,
  statement: string,
  expectedState: string,
  expectedMessage: string,
) {
  const escapedMessage = expectedMessage.replaceAll("'", "''");
  await db.$executeRawUnsafe(`
    DO $verification$
    DECLARE
      observed_message text;
      observed_state text;
    BEGIN
      BEGIN
        ${statement};
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Expected database rejection was not raised';
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS observed_message = MESSAGE_TEXT, observed_state = RETURNED_SQLSTATE;
        IF observed_state IS DISTINCT FROM '${expectedState}' OR observed_message IS DISTINCT FROM '${escapedMessage}' THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'Unexpected database rejection: ' || COALESCE(observed_state, '<null>') || ' ' || COALESCE(observed_message, '<null>');
        END IF;
      END;
    END $verification$;
  `);
}

async function main() {
  const baseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!baseUrl) {
    throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required for migration verification.");
  }
  assertRetainedVerificationTarget(baseUrl);

  const schema = `mcm_test_empty_verify_${Date.now()}_${process.pid}`;
  const directUrl = databaseUrlForSchema(baseUrl, schema, false);
  const pooledUrl = databaseUrlForSchema(baseUrl, schema, true);
  const verificationEnv = {
    ...process.env,
    DATABASE_URL: pooledUrl,
    DIRECT_DATABASE_URL: directUrl,
    EMPTY_COLONY_BOOTSTRAP: "true",
    EMPTY_ADMIN_PASSWORD: "migration-verification-only",
    EMPTY_PROFILE_INSTANCE_ID: `migration-verification-${Date.now()}`,
  };
  await run("npx", ["prisma", "migrate", "deploy"], verificationEnv);
  await run("npx", [
    "prisma",
    "migrate",
    "diff",
    "--from-url",
    directUrl,
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--exit-code",
  ], verificationEnv);
  await run("npm", ["run", "db:seed:empty"], verificationEnv);

  const verification = new PrismaClient({ datasources: { db: { url: pooledUrl } } });

  try {
    const counts = await Promise.all([
      verification.animal.count(),
      verification.cage.count(),
      verification.breedingSetup.count(),
      verification.experiment.count(),
      verification.sampleRecord.count(),
      verification.cryostorageRecord.count(),
      verification.invoice.count(),
    ]);

    if (counts.some((count) => count !== 0)) {
      throw new Error(`Empty migration verification created operational data: ${counts.join(",")}.`);
    }
    const facility = await verification.facility.findFirst({ select: { id: true } });
    if (!facility) throw new Error("Empty bootstrap did not create a facility configuration row.");
    await verification.$executeRawUnsafe(
      'ALTER TABLE "Facility" DROP CONSTRAINT "Facility_maxCageOccupancy_range"',
    );
    await verification.$executeRawUnsafe(
      'ALTER TABLE "Cage" DROP CONSTRAINT "Cage_capacityOverride_range"',
    );
    await verification.$transaction(async (tx) => {
      await tx.facility.update({ where: { id: facility.id }, data: { maxCageOccupancy: 7 } });
      await tx.facility.create({
        data: {
          id: "capacity-upgrade-low-facility",
          name: "Low capacity upgrade fixture",
          cageBarcodePrefix: "LOW",
          maxCageOccupancy: -4,
        },
      });
      const sequence = await tx.facilityIdentitySequence.update({
        where: { entityType: "cage" },
        data: { nextValue: { increment: 2 } },
        select: { nextValue: true, width: true },
      });
      const sequenceValue = sequence.nextValue - 2;
      const displayId = String(sequenceValue).padStart(sequence.width, "0");
      await tx.cage.create({
        data: {
          id: "capacity-upgrade-cage",
          facilityCageId: displayId,
          labId: "lab-default",
          roomId: "room-default",
          rackId: "rack-default",
          cageNumber: "UPGRADE",
          barcode: "MC-CAPACITY-UPGRADE",
          capacityOverride: 100,
          status: "active",
        },
      });
      await tx.cage.create({
        data: {
          id: "capacity-upgrade-low-cage",
          facilityCageId: String(sequenceValue + 1).padStart(sequence.width, "0"),
          labId: "lab-default",
          roomId: "room-default",
          rackId: "rack-default",
          cageNumber: "UPGRADE-LOW",
          barcode: "MC-CAPACITY-UPGRADE-LOW",
          capacityOverride: -2,
          status: "active",
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const capacityMigration = await readFile(
      "prisma/migrations/0011_cage_capacity_hard_limit/migration.sql",
      "utf8",
    );
    const capacityStatements = capacityMigration
      .split(/;\s*(?:\n|$)/)
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of capacityStatements) await verification.$executeRawUnsafe(statement);
    const [normalizedFacility, normalizedLowFacility, normalizedCage, normalizedLowCage, normalizationAudits] = await Promise.all([
      verification.facility.findUniqueOrThrow({ where: { id: facility.id }, select: { maxCageOccupancy: true } }),
      verification.facility.findUniqueOrThrow({ where: { id: "capacity-upgrade-low-facility" }, select: { maxCageOccupancy: true } }),
      verification.cage.findUniqueOrThrow({ where: { id: "capacity-upgrade-cage" }, select: { capacityOverride: true } }),
      verification.cage.findUniqueOrThrow({ where: { id: "capacity-upgrade-low-cage" }, select: { capacityOverride: true } }),
      verification.auditLog.findMany({
        where: { action: "capacity_hard_limit_normalization" },
        select: { entityId: true, previousValue: true, newValue: true },
      }),
    ]);
    const auditByEntity = new Map(normalizationAudits.map((audit) => [audit.entityId, audit]));
    if (
      normalizedFacility.maxCageOccupancy !== 6
      || normalizedLowFacility.maxCageOccupancy !== 1
      || normalizedCage.capacityOverride !== 6
      || normalizedLowCage.capacityOverride !== null
      || normalizationAudits.length !== 4
      || JSON.stringify(auditByEntity.get(facility.id)?.previousValue) !== JSON.stringify({ maxCageOccupancy: 7 })
      || JSON.stringify(auditByEntity.get(facility.id)?.newValue) !== JSON.stringify({ maxCageOccupancy: 6 })
      || JSON.stringify(auditByEntity.get("capacity-upgrade-low-facility")?.newValue) !== JSON.stringify({ maxCageOccupancy: 1 })
      || JSON.stringify(auditByEntity.get("capacity-upgrade-cage")?.previousValue) !== JSON.stringify({ capacityOverride: 100 })
      || JSON.stringify(auditByEntity.get("capacity-upgrade-low-cage")?.newValue) !== JSON.stringify({ capacityOverride: null })
    ) {
      throw new Error("Retained out-of-range capacity values were not normalized and audited before validation.");
    }
    const constraints = await verification.$queryRaw<Array<{ conname: string; contype: string; convalidated: boolean }>>`
      SELECT conname, contype::text, convalidated
      FROM pg_constraint
      WHERE conname IN ('Facility_maxCageOccupancy_range', 'Cage_capacityOverride_range')
        AND connamespace = current_schema()::regnamespace
    `;
    if (constraints.length !== 2 || constraints.some((constraint) => constraint.contype !== "c" || !constraint.convalidated)) {
      throw new Error("Validated cage capacity check constraints are missing from the migrated database.");
    }
    let rejectedAboveHardLimit = false;
    try {
      await verification.facility.update({ where: { id: facility.id }, data: { maxCageOccupancy: 7 } });
    } catch {
      rejectedAboveHardLimit = true;
    }
    if (!rejectedAboveHardLimit) {
      throw new Error("The database accepted a facility cage capacity above six.");
    }
    let rejectedBelowHardLimit = false;
    try {
      await verification.facility.update({ where: { id: facility.id }, data: { maxCageOccupancy: 0 } });
    } catch {
      rejectedBelowHardLimit = true;
    }
    if (!rejectedBelowHardLimit) throw new Error("The database accepted a facility cage capacity below one.");
    let rejectedCageOverride = false;
    try {
      await verification.cage.update({ where: { id: "capacity-upgrade-cage" }, data: { capacityOverride: 100 } });
    } catch {
      rejectedCageOverride = true;
    }
    if (!rejectedCageOverride) throw new Error("The database accepted a cage override above six.");
    let rejectedLowCageOverride = false;
    try {
      await verification.cage.update({ where: { id: "capacity-upgrade-cage" }, data: { capacityOverride: 0 } });
    } catch {
      rejectedLowCageOverride = true;
    }
    if (!rejectedLowCageOverride) throw new Error("The database accepted a cage override below one.");

    await verification.$disconnect();
    await verification.$connect();

    await verification.quarantineCase.create({
      data: {
        id: "retained-seed-guard-case",
        labId: "lab-default",
        cageId: "capacity-upgrade-cage",
        status: "under_observation",
        admittedAt: new Date("2026-07-12T00:00:00.000Z"),
        minimumReleaseAt: new Date("2026-07-13T00:00:00.000Z"),
        admissionReason: "Retained seed-guard verification.",
        admittedById: "user-admin",
      },
    });
    await verification.quarantineObservation.create({
      data: {
        id: "retained-seed-guard-observation",
        caseId: "retained-seed-guard-case",
        labId: "lab-default",
        observedAt: new Date("2026-07-12T00:00:00.000Z"),
        observedById: "user-admin",
        result: "clear",
        severity: "info",
        note: "Retained observation must remain append-only.",
      },
    });
    await expectExactCheckViolation(
      verification,
      `DELETE FROM "QuarantineObservation" WHERE id = 'retained-seed-guard-observation'`,
      "Quarantine observations are append-only.",
    );
    if (await verification.quarantineObservation.count({ where: { id: "retained-seed-guard-observation" } }) !== 1) {
      throw new Error("The destructive-seed flag deleted quarantine history from a retained schema.");
    }

    await verification.project.create({
      data: {
        id: "trigger-dispatch-project",
        labId: "lab-default",
        projectCode: "TRIGGER-DISPATCH",
        title: "Trigger dispatch verification",
        ownerId: "user-admin",
      },
    });
    await verification.experiment.create({
      data: {
        id: "trigger-dispatch-experiment",
        labId: "lab-default",
        experimentCode: "TRIGGER-DISPATCH-EXP",
        projectId: "trigger-dispatch-project",
        title: "Trigger dispatch experiment",
        ownerId: "user-admin",
        status: "planned",
      },
    });
    const triggerAnimalSequence = await verification.facilityIdentitySequence.update({
      where: { entityType: "animal" },
      data: { nextValue: { increment: 3 } },
      select: { nextValue: true, width: true },
    });
    const firstTriggerAnimalId = triggerAnimalSequence.nextValue - 3;
    await verification.animal.createMany({
      data: ["assignment", "allocation", "breeding"].map((relationship, index) => ({
        id: `trigger-dispatch-${relationship}-animal`,
        facilityAnimalId: String(firstTriggerAnimalId + index).padStart(triggerAnimalSequence.width, "0"),
        animalId: `TRIGGER-DISPATCH-${relationship.toUpperCase()}-ANIMAL`,
        labId: `TRIGGER-DISPATCH-${relationship.toUpperCase()}-LAB-ID`,
        owningLabId: "lab-default",
        sex: "female" as const,
        dob: new Date("2026-01-01T00:00:00.000Z"),
        strainId: "strain-c57bl6j",
        status: relationship === "breeding" ? "breeding" as const : "colony_holding" as const,
        originType: "verification",
      })),
    });
    await verification.experimentAssignment.create({
      data: {
        id: "trigger-dispatch-assignment",
        animalId: "trigger-dispatch-assignment-animal",
        experimentId: "trigger-dispatch-experiment",
        status: "planned",
        startDate: new Date("2026-07-12T00:00:00.000Z"),
      },
    });
    await verification.animalProjectAllocation.create({
      data: {
        id: "trigger-dispatch-allocation",
        animalId: "trigger-dispatch-allocation-animal",
        projectId: "trigger-dispatch-project",
        startedAt: new Date("2026-07-12T00:00:00.000Z"),
      },
    });
    await verification.breedingSetup.create({
      data: {
        id: "trigger-dispatch-breeding",
        labId: "lab-default",
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        status: "active",
        targetGenotype: "verification",
        adults: {
          create: {
            id: "trigger-dispatch-adult",
            animalId: "trigger-dispatch-breeding-animal",
            role: "dam",
          },
        },
      },
    });

    for (const relationship of ["assignment", "allocation", "breeding"] as const) {
      await verification.animal.update({
        where: { id: `trigger-dispatch-${relationship}-animal` },
        data: { owningLabId: "lab-default" },
      });
    }
    await verification.experiment.update({
      where: { id: "trigger-dispatch-experiment" },
      data: { labId: "lab-default" },
    });
    await verification.project.update({
      where: { id: "trigger-dispatch-project" },
      data: { labId: "lab-default" },
    });
    await verification.breedingSetup.update({
      where: { id: "trigger-dispatch-breeding" },
      data: { status: "paused" },
    });

    await expectExactDatabaseError(
      verification,
      `UPDATE "Animal" SET "owningLabId" = 'lab-2' WHERE id = 'trigger-dispatch-assignment-animal'`,
      "42501",
      "Ownership changes require a current accepted lab-transfer finalization",
    );
    await expectExactDatabaseError(
      verification,
      `UPDATE "Animal" SET "owningLabId" = 'lab-2' WHERE id = 'trigger-dispatch-allocation-animal'`,
      "42501",
      "Ownership changes require a current accepted lab-transfer finalization",
    );
    await expectExactDatabaseError(
      verification,
      `UPDATE "Animal" SET "owningLabId" = 'lab-2' WHERE id = 'trigger-dispatch-breeding-animal'`,
      "42501",
      "Ownership changes require a current accepted lab-transfer finalization",
    );
    await expectExactCheckViolation(
      verification,
      `UPDATE "Experiment" SET "labId" = 'lab-2' WHERE id = 'trigger-dispatch-experiment'`,
      "Experiment lab change would leave an open ExperimentAssignment in another lab",
    );
    await expectExactCheckViolation(
      verification,
      `UPDATE "Project" SET "labId" = 'lab-2' WHERE id = 'trigger-dispatch-project'`,
      "Project lab change would leave an open AnimalProjectAllocation in another lab",
    );
    await expectExactCheckViolation(
      verification,
      `UPDATE "BreedingSetup" SET "labId" = 'lab-2' WHERE id = 'trigger-dispatch-breeding'`,
      "BreedingSetup lab/status change would leave a current BreedingAdult relation in another lab",
    );
  } finally {
    await verification.$disconnect();
  }

  console.log(`Fresh migration replay, schema parity, and empty bootstrap verification passed in schema ${schema}.`);
  console.log("The verification schema is intentionally retained; this command never deletes database objects.");
}

if (process.argv[1]?.endsWith("verify-migration-chain.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
