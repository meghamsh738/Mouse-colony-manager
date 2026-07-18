import { createConnection } from "node:net";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATABASE_ENV_KEYS = ["DATABASE_URL", "DIRECT_DATABASE_URL"] as const;
const DEFAULT_POSTGRES_PORT = 5432;
const DEFAULT_TIMEOUT_MS = 1500;

type DatabaseEnvKey = (typeof DATABASE_ENV_KEYS)[number];

export type DotEnvValues = Record<string, string>;

export type DatabaseTarget = {
  database: string;
  envKey: DatabaseEnvKey;
  host: string;
  port: number;
  rawUrl: string;
  redactedUrl: string;
  user: string;
};

export type DoctorIssue = {
  envKey: DatabaseEnvKey;
  message: string;
};

export type EndpointCheck = {
  ok: boolean;
  postgres: ReachabilityCheck;
  target: DatabaseTarget;
  tcp: ReachabilityCheck;
};

export type ReachabilityCheck = {
  error?: string;
  ok: boolean;
};

export type DoctorReport = {
  checks: EndpointCheck[];
  envFilePath: string;
  issues: DoctorIssue[];
  targets: DatabaseTarget[];
};

export function parseDotEnv(contents: string): DotEnvValues {
  const values: DotEnvValues = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const withoutExport = line.replace(/^export\s+/, "");
    const separatorIndex = withoutExport.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = withoutExport.slice(0, separatorIndex).trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    values[key] = parseEnvValue(withoutExport.slice(separatorIndex + 1).trim());
  }

  return values;
}

export function buildDatabaseTargets(env: NodeJS.ProcessEnv | DotEnvValues): {
  issues: DoctorIssue[];
  targets: DatabaseTarget[];
} {
  const issues: DoctorIssue[] = [];
  const targets: DatabaseTarget[] = [];

  for (const envKey of DATABASE_ENV_KEYS) {
    const rawUrl = env[envKey];

    if (!rawUrl) {
      issues.push({ envKey, message: `${envKey} is not set.` });
      continue;
    }

    try {
      const url = new URL(rawUrl);

      if (url.protocol === "prisma+postgres:") {
        const target = buildPrismaPostgresTarget(envKey, rawUrl, url);

        if (typeof target === "string") {
          issues.push({ envKey, message: target });
          continue;
        }

        targets.push(target);
        continue;
      }

      if (!["postgres:", "postgresql:"].includes(url.protocol)) {
        issues.push({ envKey, message: `${envKey} must use a postgres://, postgresql://, or prisma+postgres:// URL.` });
        continue;
      }

      if (!url.hostname) {
        issues.push({ envKey, message: `${envKey} is missing a host.` });
        continue;
      }

      targets.push(buildPostgresTarget(envKey, rawUrl, url, redactDatabaseUrl(url)));
    } catch {
      issues.push({ envKey, message: `${envKey} is not a valid URL.` });
    }
  }

  return { issues, targets };
}

export async function checkEndpoint(target: DatabaseTarget, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<EndpointCheck> {
  const tcp = await checkTcpEndpoint(target, timeoutMs);

  if (!tcp.ok) {
    return {
      ok: false,
      postgres: { error: "Skipped because TCP is unreachable.", ok: false },
      target,
      tcp,
    };
  }

  const postgres = await checkPostgresStartup(target, timeoutMs);

  return { ok: tcp.ok && postgres.ok, postgres, target, tcp };
}

export async function checkTcpEndpoint(target: DatabaseTarget, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ReachabilityCheck> {
  return new Promise((resolveCheck) => {
    const socket = createConnection({ host: target.host, port: target.port });
    let settled = false;

    const finish = (check: ReachabilityCheck) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolveCheck(check);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ ok: true }));
    socket.once("timeout", () => finish({ error: `Timed out after ${timeoutMs}ms`, ok: false }));
    socket.once("error", (error) => finish({ error: formatSocketError(error), ok: false }));
  });
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = ["Prisma dev DB doctor", `Env file: ${report.envFilePath}`];

  if (report.issues.length > 0) {
    lines.push("", "Configuration issues:");

    for (const issue of report.issues) {
      lines.push(`- ${issue.envKey}: ${issue.message}`);
    }
  }

  if (report.targets.length > 0) {
    lines.push("", "Configured database endpoints:");

    for (const target of report.targets) {
      const check = report.checks.find((candidate) => candidate.target.envKey === target.envKey);
      const tcpStatus = formatReachability(check?.tcp);
      const postgresStatus = formatReachability(check?.postgres);

      lines.push(
        `- ${target.envKey}:`,
        `  url: ${target.redactedUrl}`,
        `  host: ${target.host}`,
        `  port: ${target.port}`,
        `  database: ${target.database}`,
        `  tcp: ${tcpStatus}`,
        `  postgres: ${postgresStatus}`,
      );
    }
  }

  if (!isReportHealthy(report)) {
    lines.push(
      "",
      "Recovery:",
      "1. Start the local Prisma Postgres endpoint: npx prisma dev -d -n colony-maintenance",
      "2. In another shell, apply schema and seed data: npm run db:prepare:local",
      "3. Re-run this check: npm run db:doctor",
    );
  }

  return lines.join("\n");
}

export function isReportHealthy(report: DoctorReport) {
  return report.issues.length === 0 && report.checks.length === report.targets.length && report.checks.every((check) => check.ok);
}

export async function runDbDoctor(cwd = process.cwd(), runtimeEnv: NodeJS.ProcessEnv = process.env) {
  const envFilePath = resolve(cwd, ".env");
  const fileEnv = await readDotEnv(envFilePath);
  const mergedEnv = { ...fileEnv, ...runtimeEnv };
  const { issues, targets } = buildDatabaseTargets(mergedEnv);
  const checks = await Promise.all(targets.map((target) => checkEndpoint(target)));
  const report: DoctorReport = { checks, envFilePath, issues, targets };
  const output = formatDoctorReport(report);

  return { ok: isReportHealthy(report), output, report };
}

function parseEnvValue(rawValue: string) {
  if (!rawValue) {
    return "";
  }

  const quote = rawValue[0];

  if ((quote === '"' || quote === "'") && rawValue.endsWith(quote)) {
    const unquoted = rawValue.slice(1, -1);

    return quote === '"' ? unquoted.replaceAll("\\n", "\n").replaceAll("\\r", "\r").replaceAll("\\t", "\t") : unquoted;
  }

  return rawValue.replace(/\s+#.*$/, "");
}

async function readDotEnv(envFilePath: string) {
  try {
    return parseDotEnv(await readFile(envFilePath, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

function redactDatabaseUrl(url: URL) {
  const redacted = new URL(url.toString());

  if (redacted.username) {
    redacted.username = "USER";
  }

  if (redacted.password) {
    redacted.password = "PASSWORD";
  }

  return redacted.toString();
}

function buildPostgresTarget(envKey: DatabaseEnvKey, rawUrl: string, url: URL, redactedUrl: string): DatabaseTarget {
  return {
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "(database not specified)",
    envKey,
    host: url.hostname,
    port: Number(url.port || DEFAULT_POSTGRES_PORT),
    rawUrl,
    redactedUrl,
    user: decodeURIComponent(url.username) || "postgres",
  };
}

function buildPrismaPostgresTarget(envKey: DatabaseEnvKey, rawUrl: string, url: URL): DatabaseTarget | string {
  const apiKey = url.searchParams.get("api_key");

  if (!apiKey) {
    return `${envKey} is missing the prisma+postgres api_key parameter.`;
  }

  let payload: unknown;

  try {
    payload = JSON.parse(Buffer.from(apiKey, "base64url").toString("utf8"));
  } catch {
    return `${envKey} has an invalid prisma+postgres api_key parameter.`;
  }

  if (!payload || typeof payload !== "object" || !("databaseUrl" in payload) || typeof payload.databaseUrl !== "string") {
    return `${envKey} has a prisma+postgres api_key without a databaseUrl.`;
  }

  try {
    const targetUrl = new URL(payload.databaseUrl);

    if (!["postgres:", "postgresql:"].includes(targetUrl.protocol)) {
      return `${envKey} has a prisma+postgres api_key with an unsupported databaseUrl protocol.`;
    }

    const redactedUrl = new URL(rawUrl);
    redactedUrl.searchParams.set("api_key", "REDACTED");

    return buildPostgresTarget(envKey, rawUrl, targetUrl, redactedUrl.toString());
  } catch {
    return `${envKey} has a prisma+postgres api_key with an invalid databaseUrl.`;
  }
}

function formatReachability(check: ReachabilityCheck | undefined) {
  if (!check) {
    return "not checked";
  }

  return check.ok ? "reachable" : `unreachable${check.error ? ` (${check.error})` : ""}`;
}

function formatSocketError(error: Error & { code?: string }) {
  return error.code ? `${error.code}: ${error.message}` : error.message;
}

function checkPostgresStartup(target: DatabaseTarget, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ReachabilityCheck> {
  return new Promise((resolveCheck) => {
    const socket = createConnection({ host: target.host, port: target.port });
    let settled = false;

    const finish = (check: ReachabilityCheck) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolveCheck(check);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.write(buildPostgresStartupPacket(target));
    });
    socket.once("data", (data) => {
      const messageType = data.subarray(0, 1).toString("utf8");

      if (messageType === "R" || messageType === "S" || messageType === "K" || messageType === "Z") {
        finish({ ok: true });
        return;
      }

      if (messageType === "E") {
        finish({ error: parsePostgresError(data), ok: false });
        return;
      }

      finish({ error: `Unexpected PostgreSQL startup response "${messageType || "empty"}"`, ok: false });
    });
    socket.once("timeout", () => finish({ error: `Timed out after ${timeoutMs}ms`, ok: false }));
    socket.once("error", (error) => finish({ error: formatSocketError(error), ok: false }));
  });
}

function buildPostgresStartupPacket(target: DatabaseTarget) {
  const parameters = ["user", target.user, "database", target.database];
  const parameterBytes = Buffer.from(`${parameters.join("\0")}\0\0`, "utf8");
  const packet = Buffer.alloc(8 + parameterBytes.length);

  packet.writeInt32BE(packet.length, 0);
  packet.writeInt32BE(196608, 4);
  parameterBytes.copy(packet, 8);

  return packet;
}

function parsePostgresError(data: Buffer) {
  const message = data
    .subarray(5)
    .toString("utf8")
    .split("\0")
    .find((field) => field.startsWith("M"));

  return message ? message.slice(1) : "PostgreSQL returned an error during startup.";
}

function isDirectRun() {
  const currentPath = fileURLToPath(import.meta.url);
  const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";

  return currentPath === invokedPath;
}

if (isDirectRun()) {
  runDbDoctor()
    .then(({ ok, output }) => {
      console.log(output);
      process.exitCode = ok ? 0 : 1;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
