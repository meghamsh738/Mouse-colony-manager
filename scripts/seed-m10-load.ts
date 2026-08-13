import { pathToFileURL } from "node:url";

import { Prisma, type PrismaClient } from "@prisma/client";

import { seedDatabase } from "../prisma/seed-database";
import { seedColonyData } from "../prisma/seed-data";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";
import { SEEDED_DEV_PASSWORD } from "../src/lib/seed-metadata";
import { assertM10SeedAllowed, expectedLiveTarget, isM10LoopbackServerAddress, M10_TARGETS } from "./m10-load-common";

type Counts = { animals: number; animalAssignments: number; cages: number; cageAssignments: number; users: number };
type SequenceState = { entityType: string; nextValue: number; minimumValue: number; maximumValue: number; width: number };

export function freshM10TargetErrors(populatedTables: readonly string[], sequences: readonly SequenceState[]) {
  const errors: string[] = [];
  if (populatedTables.length > 0) errors.push(`application tables already contain rows: ${[...populatedTables].sort().join(", ")}`);
  const expected = new Map([
    ["animal", { nextValue: 1, minimumValue: 1, maximumValue: 9_999, width: 4 }],
    ["cage", { nextValue: 1_000, minimumValue: 1_000, maximumValue: 9_999, width: 4 }],
  ]);
  if (sequences.length !== expected.size) errors.push("identity sequence baseline must contain exactly animal and cage rows");
  for (const sequence of sequences) {
    const baseline = expected.get(sequence.entityType);
    if (!baseline || Object.entries(baseline).some(([key, value]) => sequence[key as keyof typeof baseline] !== value)) {
      errors.push(`identity sequence ${sequence.entityType} is not pristine`);
    }
    expected.delete(sequence.entityType);
  }
  if (expected.size > 0) errors.push(`identity sequence baseline is missing: ${[...expected.keys()].join(", ")}`);
  return errors;
}

export async function readM10Counts(client: PrismaClient): Promise<Counts> {
  const [animals, animalAssignments, cages, cageAssignments, users] = await Promise.all([
    client.animal.count(),
    client.facilityIdentifierAssignment.count({ where: { entityType: "animal" } }),
    client.cage.count(),
    client.facilityIdentifierAssignment.count({ where: { entityType: "cage" } }),
    client.user.count(),
  ]);
  return { animals, animalAssignments, cages, cageAssignments, users };
}

export function assertExactCounts(actual: Counts, expected: Counts, stage: string) {
  for (const key of Object.keys(expected) as (keyof Counts)[]) {
    if (actual[key] !== expected[key]) throw new Error(`${stage} ${key} count was ${actual[key]}, expected ${expected[key]}`);
  }
}

export function m10SyntheticMembershipRole(index: number) {
  return index < 10 ? "manager" as const : "viewer" as const;
}

async function assertLiveTarget(client: PrismaClient) {
  const expected = expectedLiveTarget(process.env.DIRECT_DATABASE_URL!);
  const rows = await client.$queryRaw<Array<{ database: string; schema: string; serverAddress: string | null }>>(Prisma.sql`
    SELECT current_database() AS database, current_schema() AS schema, inet_server_addr()::text AS "serverAddress"
  `);
  const live = rows[0];
  if (!live || live.database !== expected.database || live.schema !== expected.schema) {
    throw new Error("Connected database/schema does not match the guarded DIRECT_DATABASE_URL target");
  }
  if (!isM10LoopbackServerAddress(live.serverAddress)) {
    throw new Error("Connected PostgreSQL server is not loopback");
  }
}

async function assertFreshMigratedTarget(client: PrismaClient) {
  const tables = await client.$queryRaw<Array<{ tableName: string }>>(Prisma.sql`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('_prisma_migrations', 'FacilityIdentitySequence')
    ORDER BY table_name
  `);
  const populatedTables: string[] = [];
  for (const { tableName } of tables) {
    const quoted = `"${tableName.replaceAll('"', '""')}"`;
    const rows = await client.$queryRawUnsafe<Array<{ present: number }>>(`SELECT 1 AS present FROM ${quoted} LIMIT 1`);
    if (rows.length > 0) populatedTables.push(tableName);
  }
  const sequences = await client.facilityIdentitySequence.findMany({
    select: { entityType: true, nextValue: true, minimumValue: true, maximumValue: true, width: true },
    orderBy: { entityType: "asc" },
  });
  const errors = freshM10TargetErrors(populatedTables, sequences);
  if (errors.length > 0) throw new Error(`M10 load seed requires a fresh migrated target: ${errors.join("; ")}. Create a new dedicated database/schema; preserved load databases are never overwritten.`);
}

function batches<T>(items: T[], size = 400) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

export async function seedM10Load() {
  assertM10SeedAllowed();
  await assertLiveTarget(prisma);
  await assertFreshMigratedTarget(prisma);
  await seedDatabase();

  const baseExpected: Counts = {
    animals: seedColonyData.animals.length,
    animalAssignments: seedColonyData.animals.length,
    cages: seedColonyData.cages.length,
    cageAssignments: seedColonyData.cages.length,
    users: seedColonyData.users.length,
  };
  assertExactCounts(await readM10Counts(prisma), baseExpected, "base seed");

  const extraCages = Array.from({ length: M10_TARGETS.cages - baseExpected.cages }, (_, offset) => {
    const sequence = 1_000 + baseExpected.cages + offset;
    return {
      id: `m10-load-cage-${sequence}`,
      facilityCageId: String(sequence).padStart(4, "0"),
      labId: "lab-microglia",
      roomId: "room-a101",
      rackId: "rack-a101-1",
      cageNumber: `M10-${sequence}`,
      barcode: `M10-CAGE-${sequence}`,
      status: "active" as const,
      notes: null,
      welfareFlags: [],
      lastUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
  });
  const passwordHash = hashPassword(SEEDED_DEV_PASSWORD);
  const users = Array.from({ length: M10_TARGETS.syntheticUsers }, (_, offset) => ({
    id: `m10-load-user-${String(offset + 1).padStart(2, "0")}`,
    name: `M10 Load User ${String(offset + 1).padStart(2, "0")}`,
    email: `m10-load-user-${String(offset + 1).padStart(2, "0")}@example.test`,
    passwordHash,
    role: "lab_user" as const,
    active: true,
  }));
  const extraAnimals = Array.from({ length: M10_TARGETS.animals - baseExpected.animals }, (_, offset) => {
    const sequence = baseExpected.animals + offset + 1;
    const cage = extraCages[offset % extraCages.length];
    return {
      id: `m10-load-animal-${String(sequence).padStart(4, "0")}`,
      facilityAnimalId: String(sequence).padStart(4, "0"),
      animalId: `M10-A-${String(sequence).padStart(4, "0")}`,
      labId: `M10-L-${String(sequence).padStart(4, "0")}`,
      owningLabId: "lab-microglia",
      sex: sequence % 2 === 0 ? "female" as const : "male" as const,
      dob: new Date("2025-01-01T00:00:00.000Z"),
      strainId: "strain-wt",
      currentCageId: cage.id,
      status: "colony_holding" as const,
      originType: "M10 synthetic load fixture",
      outcomeStatus: "alive" as const,
      notes: null,
    };
  });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.facilityIdentitySequence.update({ where: { entityType: "animal" }, data: { nextValue: M10_TARGETS.animals + 1 } });
      await tx.facilityIdentitySequence.update({ where: { entityType: "cage" }, data: { nextValue: 1_000 + M10_TARGETS.cages } });
      for (const batch of batches(extraCages)) await tx.cage.createMany({ data: batch });
      await tx.user.createMany({ data: users });
      await tx.labMembership.createMany({ data: users.map((user, index) => ({
        id: `m10-load-membership-${user.id.slice(-2)}`,
        labId: "lab-microglia",
        userId: user.id,
        role: m10SyntheticMembershipRole(index),
        active: true,
      })) });
      for (const batch of batches(extraAnimals)) await tx.animal.createMany({ data: batch });
    }, { timeout: 180_000 });
  } catch (error) {
    throw new Error("M10 additive seed failed and was rolled back. The base fixture remains for diagnosis; use a newly migrated dedicated schema for the next attempt.", { cause: error });
  }

  const afterExpected: Counts = {
    animals: M10_TARGETS.animals,
    animalAssignments: M10_TARGETS.animals,
    cages: M10_TARGETS.cages,
    cageAssignments: M10_TARGETS.cages,
    users: baseExpected.users + M10_TARGETS.syntheticUsers,
  };
  assertExactCounts(await readM10Counts(prisma), afterExpected, "M10 load seed");
  const occupancy = await prisma.$queryRaw<Array<{ maximum: bigint }>>(Prisma.sql`
    SELECT COALESCE(MAX(occupancy), 0)::bigint AS maximum
    FROM (SELECT COUNT(*) AS occupancy FROM "Animal" WHERE "currentCageId" IS NOT NULL GROUP BY "currentCageId") counts
  `);
  const maxOccupancy = Number(occupancy[0]?.maximum ?? 0);
  const facility = await prisma.facility.findUniqueOrThrow({ where: { id: "facility-tcd" }, select: { maxCageOccupancy: true } });
  if (maxOccupancy > facility.maxCageOccupancy) throw new Error(`Maximum cage occupancy ${maxOccupancy} exceeds ${facility.maxCageOccupancy}`);
  await prisma.$executeRawUnsafe("ANALYZE");
  console.log(JSON.stringify({ ok: true, counts: afterExpected, maxCageOccupancy: maxOccupancy, analyzed: true }));
}

const direct = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (direct) seedM10Load().catch((error) => { console.error(error instanceof Error ? error.message : "M10 load seed failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
