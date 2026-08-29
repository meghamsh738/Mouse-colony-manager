type DestructiveSeedTarget = {
  allowed: boolean;
  nodeEnv?: string;
  rawUrl: string;
};

const disposableName = /(?:^|[-_])(test|e2e|disposable)(?:[-_]|$)/i;
const emptyBootstrapName = /(?:^|[-_])(empty|test|e2e|disposable)(?:[-_]|$)/i;

export function destructiveSeedTargetErrors({ allowed, nodeEnv, rawUrl }: DestructiveSeedTarget) {
  const errors: string[] = [];

  if (!allowed) errors.push("ALLOW_DESTRUCTIVE_SEED must be true");
  if (nodeEnv === "production") errors.push("NODE_ENV must not be production");

  try {
    const url = new URL(rawUrl);
    const localHost = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
    if (!localHost) errors.push("database must use a loopback host");

    const schemaName = url.searchParams.get("schema") ?? "";
    if (!disposableName.test(schemaName)) {
      errors.push("schema must contain a test, e2e, or disposable marker");
    }
  } catch {
    errors.push("a valid database URL is required");
  }

  return errors;
}

export function assertDestructiveSeedAllowed() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const directUrl = process.env.DIRECT_DATABASE_URL;
  const errors = destructiveSeedTargetErrors({
    allowed: process.env.ALLOW_DESTRUCTIVE_SEED === "true",
    nodeEnv: process.env.NODE_ENV,
    rawUrl: databaseUrl,
  });
  if (directUrl) {
    errors.push(...destructiveSeedTargetErrors({ allowed: true, nodeEnv: process.env.NODE_ENV, rawUrl: directUrl }));
    if (!sameDatabaseTarget(databaseUrl, directUrl)) errors.push("DATABASE_URL and DIRECT_DATABASE_URL must target the same database and schema");
  }

  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length > 0) {
    throw new Error(`Destructive seed refused: ${uniqueErrors.join("; ")}.`);
  }
}

export function emptyBootstrapTargetErrors(input: { allowed: boolean; nodeEnv?: string; rawUrl: string }) {
  const errors: string[] = [];

  if (!input.allowed) errors.push("EMPTY_COLONY_BOOTSTRAP must be true");
  if (input.nodeEnv === "production") errors.push("NODE_ENV must not be production");

  try {
    const url = new URL(input.rawUrl);
    const localHost = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
    if (!localHost) errors.push("database must use a loopback host");

    const databaseName = url.pathname.replace(/^\//, "");
    const schemaName = url.searchParams.get("schema") ?? "";
    if (!emptyBootstrapName.test(databaseName) && !emptyBootstrapName.test(schemaName)) {
      errors.push("database name or schema must contain an empty, test, e2e, or disposable marker");
    }
  } catch {
    errors.push("a valid database URL is required");
  }

  return errors;
}

export function assertEmptyBootstrapAllowed() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const directUrl = process.env.DIRECT_DATABASE_URL;
  const errors = emptyBootstrapTargetErrors({
    allowed: process.env.EMPTY_COLONY_BOOTSTRAP === "true",
    nodeEnv: process.env.NODE_ENV,
    rawUrl: databaseUrl,
  });
  if (directUrl) {
    errors.push(...emptyBootstrapTargetErrors({ allowed: true, nodeEnv: process.env.NODE_ENV, rawUrl: directUrl }));
    if (!sameDatabaseTarget(databaseUrl, directUrl)) errors.push("DATABASE_URL and DIRECT_DATABASE_URL must target the same database and schema");
  }

  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length > 0) {
    throw new Error(`Empty bootstrap refused: ${uniqueErrors.join("; ")}.`);
  }
}

export function roleQaSeedTargetErrors(rawUrl: string) {
  const errors: string[] = [];
  try {
    const url = new URL(rawUrl);
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
      errors.push("database must use a loopback host");
    }
    const databaseName = url.pathname.replace(/^\//, "");
    const schemaName = url.searchParams.get("schema") ?? "";
    if (![databaseName, schemaName].some((target) => /^mcm_test_[a-z0-9_-]+$/i.test(target))) {
      errors.push("database name or schema must start with mcm_test_");
    }
  } catch {
    errors.push("a valid database URL is required");
  }
  return errors;
}

export function assertRoleQaSeedAllowed() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const directUrl = process.env.DIRECT_DATABASE_URL;
  const errors = roleQaSeedTargetErrors(databaseUrl);
  if (process.env.NODE_ENV === "production") errors.push("NODE_ENV must not be production");
  if (directUrl) {
    errors.push(...roleQaSeedTargetErrors(directUrl));
    if (!sameDatabaseTarget(databaseUrl, directUrl)) errors.push("DATABASE_URL and DIRECT_DATABASE_URL must target the same database and schema");
  }
  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length > 0) throw new Error(`Role QA seed refused: ${uniqueErrors.join("; ")}.`);
}

export function sameDatabaseTarget(leftRawUrl: string, rightRawUrl: string) {
  try {
    const left = new URL(leftRawUrl);
    const right = new URL(rightRawUrl);
    return (
      left.protocol === right.protocol &&
      left.hostname === right.hostname &&
      (left.port || "5432") === (right.port || "5432") &&
      left.pathname === right.pathname &&
      (left.searchParams.get("schema") ?? "public") === (right.searchParams.get("schema") ?? "public")
    );
  } catch {
    return false;
  }
}
