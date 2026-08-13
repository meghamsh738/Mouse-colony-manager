import path from "node:path";

export const M10_TARGETS = Object.freeze({ animals: 9_999, cages: 2_000, syntheticUsers: 50 });
export const M10_SCHEMA_MARKER = "mcm_test_m10_load";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isM10LoopbackServerAddress(value: string | null) {
  if (!value) return true;
  return loopbackHosts.has(value.split("/", 1)[0]);
}

export type M10GuardInput = {
  allowDestructiveSeed?: string;
  databaseUrl?: string;
  directDatabaseUrl?: string;
  loadSeed?: string;
  nodeEnv?: string;
};

function parseTarget(rawUrl: string, label: string, errors: string[]) {
  try {
    const url = new URL(rawUrl);
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const schema = url.searchParams.get("schema") ?? "public";

    if (!loopbackHosts.has(url.hostname)) errors.push(`${label} must use a loopback host`);
    if (!database.includes(M10_SCHEMA_MARKER) && !schema.includes(M10_SCHEMA_MARKER)) {
      errors.push(`${label} database or schema must contain ${M10_SCHEMA_MARKER}`);
    }
    return { database, host: url.hostname, port: url.port || "5432", protocol: url.protocol, schema };
  } catch {
    errors.push(`${label} must be a valid database URL`);
    return undefined;
  }
}

export function m10SeedGuardErrors(input: M10GuardInput) {
  const errors: string[] = [];
  if (input.nodeEnv === "production") errors.push("NODE_ENV must not be production");
  if (input.loadSeed !== "true") errors.push("M10_LOAD_SEED must be true");
  if (input.allowDestructiveSeed !== "true") errors.push("ALLOW_DESTRUCTIVE_SEED must be true");
  if (!input.databaseUrl) errors.push("DATABASE_URL is required");
  if (!input.directDatabaseUrl) errors.push("DIRECT_DATABASE_URL is required");

  const database = input.databaseUrl ? parseTarget(input.databaseUrl, "DATABASE_URL", errors) : undefined;
  const direct = input.directDatabaseUrl ? parseTarget(input.directDatabaseUrl, "DIRECT_DATABASE_URL", errors) : undefined;
  if (database && direct && (
    database.protocol !== direct.protocol || database.host !== direct.host || database.port !== direct.port ||
    database.database !== direct.database || database.schema !== direct.schema
  )) {
    errors.push("DATABASE_URL and DIRECT_DATABASE_URL must target the same database and schema");
  }
  return [...new Set(errors)];
}

export function assertM10SeedAllowed(env: NodeJS.ProcessEnv = process.env) {
  const errors = m10SeedGuardErrors({
    allowDestructiveSeed: env.ALLOW_DESTRUCTIVE_SEED,
    databaseUrl: env.DATABASE_URL,
    directDatabaseUrl: env.DIRECT_DATABASE_URL,
    loadSeed: env.M10_LOAD_SEED,
    nodeEnv: env.NODE_ENV,
  });
  if (errors.length > 0) throw new Error(`M10 load seed refused: ${errors.join("; ")}.`);
}

export function m10RunGuardErrors(input: Pick<M10GuardInput, "databaseUrl" | "directDatabaseUrl"> & {
  baseUrl?: string;
  artifactDirectory?: string;
  worktreePath: string;
}) {
  const errors: string[] = [];
  if (!input.databaseUrl) errors.push("DATABASE_URL is required");
  if (!input.directDatabaseUrl) errors.push("DIRECT_DATABASE_URL is required");
  const database = input.databaseUrl ? parseTarget(input.databaseUrl, "DATABASE_URL", errors) : undefined;
  const direct = input.directDatabaseUrl ? parseTarget(input.directDatabaseUrl, "DIRECT_DATABASE_URL", errors) : undefined;
  if (database && direct && (
    database.protocol !== direct.protocol || database.host !== direct.host || database.port !== direct.port ||
    database.database !== direct.database || database.schema !== direct.schema
  )) errors.push("DATABASE_URL and DIRECT_DATABASE_URL must target the same database and schema");
  try {
    const url = new URL(input.baseUrl ?? "");
    if (url.protocol !== "http:" || !loopbackHosts.has(url.hostname)) errors.push("M10_LOAD_BASE_URL must be loopback HTTP");
  } catch {
    errors.push("M10_LOAD_BASE_URL must be a valid URL");
  }
  errors.push(...m10ArtifactDirectoryErrors({ configuredPath: input.artifactDirectory, worktreePath: input.worktreePath }));
  return [...new Set(errors)];
}

export function expectedLiveTarget(rawUrl: string) {
  const url = new URL(rawUrl);
  return {
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    schema: url.searchParams.get("schema") ?? "public",
  };
}

export function m10ArtifactDirectoryErrors(input: { configuredPath?: string; worktreePath: string }) {
  if (!input.configuredPath) return ["M10_LOAD_ARTIFACT_DIR is required"];
  const artifactPath = path.resolve(input.configuredPath);
  const worktreePath = path.resolve(input.worktreePath);
  const marker = `${path.sep}.runtime-data${path.sep}m10-load`;
  const errors: string[] = [];
  if (!path.isAbsolute(input.configuredPath)) errors.push("artifact directory must be an absolute path");
  if (!(artifactPath.includes(`${marker}${path.sep}`) || artifactPath.endsWith(marker))) {
    errors.push("artifact directory must be under .runtime-data/m10-load");
  }
  if (artifactPath === worktreePath || artifactPath.startsWith(`${worktreePath}${path.sep}`)) {
    errors.push("artifact directory must be outside the worktree");
  }
  return errors;
}

export function percentile(values: readonly number[], percentileValue: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)];
}

export function categorizeLoadError(input: { error?: unknown; status?: number }) {
  if (input.status === 401 || input.status === 403) return "auth";
  if (input.status && input.status >= 500) return "http_5xx";
  const message = input.error instanceof Error ? `${input.error.name} ${input.error.message}`.toLowerCase() : "";
  if (message.includes("abort") || message.includes("timeout")) return "timeout";
  if (/(econn|socket|connect|fetch failed)/.test(message)) return "connection";
  return input.status && input.status >= 400 ? "http_4xx" : "other";
}

export function categorizePrismaPoolError(error: unknown) {
  const candidate = error as { code?: string; message?: string } | undefined;
  const textValue = `${candidate?.code ?? ""} ${candidate?.message ?? ""}`.toLowerCase();
  if (textValue.includes("p2024") || textValue.includes("pool timeout")) return "pool_timeout";
  if (textValue.includes("too many connections") || textValue.includes("connection limit")) return "connection_limit";
  if (/(p1001|p1002|p1017|connection|socket)/.test(textValue)) return "connection";
  return "other";
}
