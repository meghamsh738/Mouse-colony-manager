type RetainedVerificationTarget = {
  nodeEnv?: string;
  rawUrl: string;
};

export type RetainedVerificationIdentity = {
  host: "loopback";
  port: string;
  database: string;
  schema: string;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function parseRetainedVerificationIdentity(rawUrl: string): RetainedVerificationIdentity {
  const url = new URL(rawUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("database URL must use PostgreSQL");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("database must use a loopback host");
  }
  const schema = url.searchParams.get("schema") ?? "";
  if (!schema.startsWith("mcm_test_")) {
    throw new Error("schema must use the disposable mcm_test_* namespace");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error("database name is required");

  return {
    host: "loopback",
    port: url.port || "5432",
    database,
    schema,
  };
}

export function assertSameRetainedVerificationTarget(databaseUrl: string, directDatabaseUrl?: string) {
  const databaseTarget = parseRetainedVerificationIdentity(databaseUrl);
  if (!directDatabaseUrl) {
    throw new Error("Retained migration verification refused: DIRECT_DATABASE_URL is required and must match DATABASE_URL.");
  }
  const directTarget = parseRetainedVerificationIdentity(directDatabaseUrl);
  if (
    databaseTarget.host !== directTarget.host
    || databaseTarget.port !== directTarget.port
    || databaseTarget.database !== directTarget.database
    || databaseTarget.schema !== directTarget.schema
  ) {
    throw new Error("Retained migration verification refused: DATABASE_URL and DIRECT_DATABASE_URL target different databases or schemas.");
  }
  return databaseTarget;
}

export function retainedVerificationTargetErrors({ nodeEnv, rawUrl }: RetainedVerificationTarget) {
  const errors: string[] = [];
  if (nodeEnv === "production") errors.push("NODE_ENV must not be production");

  try {
    parseRetainedVerificationIdentity(rawUrl);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "a valid database URL is required");
  }

  return errors;
}

export function assertRetainedVerificationTarget(rawUrl: string) {
  const errors = retainedVerificationTargetErrors({ nodeEnv: process.env.NODE_ENV, rawUrl });
  if (errors.length) {
    throw new Error(`Retained migration verification refused: ${errors.join("; ")}.`);
  }
}
