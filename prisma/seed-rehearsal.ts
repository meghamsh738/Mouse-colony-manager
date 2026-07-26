import { pathToFileURL } from "node:url";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertSameRetainedVerificationTarget } from "../scripts/retained-verification-guard";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

async function applicationTables(client: Prisma.TransactionClient) {
  return client.$queryRawUnsafe<Array<{ schemaname: string; tablename: string }>>(
    `SELECT schemaname, tablename
     FROM pg_catalog.pg_tables
     WHERE schemaname = current_schema()
     ORDER BY tablename`,
  );
}

async function assertNoOtherDatabaseClients(client: Prisma.TransactionClient) {
  const rows = await client.$queryRawUnsafe<Array<{ sessionCount: number }>>(
    `SELECT COUNT(*)::int AS "sessionCount"
     FROM pg_catalog.pg_stat_activity
     WHERE datname = current_database()
       AND pid <> pg_backend_pid()
       AND backend_type = 'client backend'`,
  );
  if (rows[0]?.sessionCount !== 0) {
    throw new Error("Additive rehearsal seed refused because another client is connected to the database.");
  }
}

async function lockApplicationTables(
  client: Prisma.TransactionClient,
  tables: Array<{ schemaname: string; tablename: string }>,
) {
  if (tables.length === 0) {
    throw new Error("Additive rehearsal seed refused because the application schema has no tables.");
  }
  const targets = tables.map(({ schemaname, tablename }) => {
    const safeSchema = schemaname.replaceAll('"', '""');
    const safeTable = tablename.replaceAll('"', '""');
    return `"${safeSchema}"."${safeTable}"`;
  });
  await client.$executeRawUnsafe(
    `LOCK TABLE ${targets.join(", ")} IN ACCESS EXCLUSIVE MODE`,
  );
}

async function populatedApplicationTables(
  client: Prisma.TransactionClient,
  tables: Array<{ schemaname: string; tablename: string }>,
) {
  const candidates = tables.filter(
    ({ tablename }) =>
      tablename !== "_prisma_migrations" &&
      tablename !== "FacilityIdentitySequence",
  );
  const populated: string[] = [];
  for (const { schemaname, tablename } of candidates) {
    const safeSchema = schemaname.replaceAll('"', '""');
    const safeTable = tablename.replaceAll('"', '""');
    const rows = await client.$queryRawUnsafe<Array<{ present: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM "${safeSchema}"."${safeTable}" LIMIT 1) AS present`,
    );
    if (rows[0]?.present) populated.push(tablename);
  }
  return populated;
}

async function assertMigrationIdentityBaseline(client: Prisma.TransactionClient) {
  const rows = await client.$queryRawUnsafe<Array<{
    entityType: string;
    maximumValue: number;
    minimumValue: number;
    nextValue: number;
    width: number;
  }>>(
    `SELECT
       "entityType",
       "nextValue",
       "minimumValue",
       "maximumValue",
       width
     FROM "FacilityIdentitySequence"
     ORDER BY "entityType"`,
  );
  const expected = [
    { entityType: "animal", nextValue: 1, minimumValue: 1, maximumValue: 9999, width: 4 },
    { entityType: "cage", nextValue: 1000, minimumValue: 1000, maximumValue: 9999, width: 4 },
  ];
  if (JSON.stringify(rows) !== JSON.stringify(expected)) {
    throw new Error("Additive rehearsal seed refused because facility identity sequences are not at the exact migration baseline.");
  }
}

export async function createSyntheticRehearsalFixture(
  client: PrismaClient,
  passwordHash: string,
) {
  await client.$transaction(
    async (tx) => {
      await assertNoOtherDatabaseClients(tx);
      const tables = await applicationTables(tx);
      await lockApplicationTables(tx, tables);
      const populated = await populatedApplicationTables(tx, tables);
      if (populated.length > 0) {
        throw new Error(
          `Additive rehearsal seed refused because application rows already exist in: ${populated.join(", ")}.`,
        );
      }
      await assertMigrationIdentityBaseline(tx);

      await tx.user.create({
        data: {
          id: "m9-user-facility-admin",
          name: "M9 Facility Admin",
          email: "m9-admin@colony.local",
          passwordHash,
          role: "facility_admin",
        },
      });
      await tx.lab.create({
        data: {
          id: "m9-lab",
          name: "M9 Synthetic Lab",
          code: "M9-SYN",
          billingContact: "m9-admin@colony.local",
        },
      });
      await tx.labMembership.create({
        data: {
          id: "m9-membership-owner",
          labId: "m9-lab",
          userId: "m9-user-facility-admin",
          role: "owner",
        },
      });
      await tx.facility.create({
        data: {
          id: "m9-facility",
          name: "M9 Synthetic Facility",
          cageBarcodePrefix: "M9",
        },
      });
      await tx.room.create({
        data: {
          id: "m9-room",
          facilityId: "m9-facility",
          roomNumber: "M9-R1",
        },
      });
      await tx.rack.create({
        data: {
          id: "m9-rack",
          roomId: "m9-room",
          rackNumber: "M9-A",
        },
      });
      await tx.strain.create({
        data: {
          id: "m9-strain",
          name: "M9 Synthetic Strain",
          background: "Synthetic",
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const directDatabaseUrl = process.env.DIRECT_DATABASE_URL;
  const target = assertSameRetainedVerificationTarget(databaseUrl, directDatabaseUrl);
  if (!target.database.startsWith("mcm_test_")) {
    throw new Error("Additive rehearsal seed refused: database must use the mcm_test_* namespace.");
  }

  const password = process.env.MCM_REHEARSAL_ADMIN_PASSWORD ?? "";
  if (password.length < 12) {
    throw new Error("MCM_REHEARSAL_ADMIN_PASSWORD must contain at least 12 characters.");
  }

  const passwordHash = await hashPassword(password);
  await createSyntheticRehearsalFixture(prisma, passwordHash);

  console.log("Additive synthetic rehearsal fixture created without deleting or overwriting data.");
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectExecution) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      await prisma.$disconnect();
      process.exitCode = 1;
    });
}
