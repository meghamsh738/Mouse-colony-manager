import { PrismaClient } from "@prisma/client";

type DisposableTargetCheck = {
  allowed: boolean;
  nodeEnv?: string;
  rawUrl: string;
  populatedTables: string[];
};

export function disposableTargetErrors({
  allowed,
  nodeEnv,
  rawUrl,
  populatedTables,
}: DisposableTargetCheck) {
  const errors: string[] = [];

  if (!allowed) {
    errors.push("ALLOW_DISPOSABLE_DB_PUSH must be true");
  }

  let localHost = false;

  try {
    const url = new URL(rawUrl);
    localHost = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  } catch {
    errors.push("a valid database URL is required");
  }

  if (!localHost) {
    errors.push("database must use a loopback host");
  }

  if (nodeEnv === "production") {
    errors.push("NODE_ENV must not be production");
  }

  if (populatedTables.length > 0) {
    errors.push(`database contains retained rows in: ${populatedTables.join(", ")}`);
  }

  return errors;
}

async function findPopulatedApplicationTables(prisma: PrismaClient) {
  const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = current_schema()
       AND tablename <> '_prisma_migrations'
     ORDER BY tablename`,
  );
  const populated: string[] = [];

  for (const { tablename } of tables) {
    const safeTable = tablename.replaceAll('"', '""');
    const rows = await prisma.$queryRawUnsafe<Array<{ present: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM "${safeTable}" LIMIT 1) AS present`,
    );

    if (rows[0]?.present) {
      populated.push(tablename);
    }
  }

  return populated;
}

async function main() {
  const rawUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  const prisma = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  try {
    const populatedTables = await findPopulatedApplicationTables(prisma);
    const errors = disposableTargetErrors({
      allowed: process.env.ALLOW_DISPOSABLE_DB_PUSH === "true",
      nodeEnv: process.env.NODE_ENV,
      rawUrl,
      populatedTables,
    });

    if (errors.length > 0) {
      throw new Error(`Prisma db push refused: ${errors.join("; ")}.`);
    }

    console.log("Empty disposable local database confirmed.");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("assert-disposable-db.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
