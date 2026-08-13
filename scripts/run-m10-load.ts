import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { Prisma, PrismaClient } from "@prisma/client";

import { SEEDED_DEV_PASSWORD } from "../src/lib/seed-metadata";
import { categorizeLoadError, categorizePrismaPoolError, M10_TARGETS, m10RunGuardErrors, percentile } from "./m10-load-common";

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient({ log: [] });
export const M10_ROUTES = [
  { label: "/", path: "/", sessionGroup: "any" },
  { label: "/animals", path: "/animals", sessionGroup: "any" },
  { label: "/animals?search", path: "/animals?search=M10-A-5000", sessionGroup: "any" },
  { label: "/animals/:animalId", path: "/animals/m10-load-animal-5000", sessionGroup: "any" },
  { label: "/cages", path: "/cages", sessionGroup: "any" },
  { label: "/cages?search", path: "/cages?search=M10-CAGE-1500", sessionGroup: "any" },
  { label: "/cages/:cageId", path: "/cages/m10-load-cage-1500", sessionGroup: "any" },
  { label: "/cages/:cageId?action=move-mouse", path: "/cages/m10-load-cage-1500?action=move-mouse&animalSearch=M10-A-5000&destinationSearch=M10-CAGE-1500", sessionGroup: "manager" },
  { label: "/samples", path: "/samples", sessionGroup: "any" },
  { label: "/cryostorage", path: "/cryostorage", sessionGroup: "any" },
  { label: "/approvals", path: "/approvals", sessionGroup: "manager" },
  { label: "/scan/:barcode", path: "/scan/M10-CAGE-1500", sessionGroup: "any" },
  { label: "/scan/:barcode?action=move-mouse", path: "/scan/M10-CAGE-1500?action=move-mouse&animalSearch=M10-A-5000&destinationSearch=M10-CAGE-1500", sessionGroup: "manager" },
  { label: "/workbook", path: "/workbook", sessionGroup: "any" },
] as const;
type PhaseName = "warmup" | "ramp" | "steady";
type Observation = { category?: string; contentType: "rsc" | "other" | "missing"; durationMs: number; phase: PhaseName; rscBytes: number; scheduleDelayMs: number; route: string; status: number };
type Profile = { concurrency: number; durationSeconds: number; requestsPerSecond: number };
type ApplicationDatabaseFailureCounts = {
  P2024: number;
  P1001: number;
  P1002: number;
  P1017: number;
  poolTimeoutSignals: number;
  connectionLimitSignals: number;
};

export function recordApplicationDatabaseFailureLine(line: string, counts: ApplicationDatabaseFailureCounts) {
  for (const code of ["P2024", "P1001", "P1002", "P1017"] as const) {
    if (line.includes(code)) counts[code] += 1;
  }
  const normalized = line.toLowerCase();
  if (normalized.includes("pool timeout") || normalized.includes("timed out fetching a new connection")) {
    counts.poolTimeoutSignals += 1;
  }
  if (normalized.includes("too many connections") || normalized.includes("connection limit")) {
    counts.connectionLimitSignals += 1;
  }
}

function boundedNumber(value: string | undefined, fallback: number, minimum: number, maximum: number, label: string) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  return result;
}

export function loadProfiles(env: Record<string, string | undefined> = process.env): Record<PhaseName, Profile> {
  const quick = env.M10_LOAD_PROFILE === "quick";
  const defaults = quick
    ? { warmup: [3, 4, 8], ramp: [5, 12, 24], steady: [10, 20, 40] }
    : { warmup: [30, 8, 15], ramp: [60, 30, 60], steady: [300, 50, 100] };
  return Object.fromEntries((Object.keys(defaults) as PhaseName[]).map((phase) => {
    const prefix = `M10_LOAD_${phase.toUpperCase()}`;
    const values = defaults[phase];
    return [phase, {
      durationSeconds: boundedNumber(env[`${prefix}_SECONDS`], values[0], 1, 900, `${prefix}_SECONDS`),
      concurrency: Math.floor(boundedNumber(env[`${prefix}_CONCURRENCY`], values[1], 1, 100, `${prefix}_CONCURRENCY`)),
      requestsPerSecond: boundedNumber(env[`${prefix}_RPS`], values[2], 1, 200, `${prefix}_RPS`),
    }];
  })) as Record<PhaseName, Profile>;
}

function splitSetCookies(headers: Headers) {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (extended.getSetCookie) return extended.getSetCookie();
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,]+=)/) : [];
}

function mergeCookies(jar: Map<string, string>, response: Response) {
  for (const value of splitSetCookies(response.headers)) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function authenticate(baseUrl: string, index: number) {
  const jar = new Map<string, string>();
  const csrf = await fetch(`${baseUrl}/api/auth/csrf`, { redirect: "manual" });
  mergeCookies(jar, csrf);
  if (!csrf.ok) throw new Error("Authentication CSRF request failed");
  const body = await csrf.json() as { csrfToken?: string };
  if (!body.csrfToken) throw new Error("Authentication CSRF token was absent");
  const form = new URLSearchParams({
    csrfToken: body.csrfToken,
    email: `m10-load-user-${String(index).padStart(2, "0")}@example.test`,
    password: SEEDED_DEV_PASSWORD,
    callbackUrl: baseUrl,
  });
  const response = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar) },
    body: form,
    redirect: "manual",
  });
  mergeCookies(jar, response);
  if (response.status < 300 || response.status >= 400 || ![...jar.keys()].some((name) => name.includes("session-token"))) {
    throw new Error(`Synthetic session ${index} authentication failed`);
  }
  return cookieHeader(jar);
}

async function waitForServer(baseUrl: string, child: ChildProcess) {
  const startupTimeoutMs = boundedNumber(
    process.env.M10_LOAD_STARTUP_TIMEOUT_MS,
    120_000,
    45_000,
    180_000,
    "M10_LOAD_STARTUP_TIMEOUT_MS",
  );
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited before readiness (code ${child.exitCode})`);
    try {
      // The first route load can take several seconds from an external drive.
      // Give that cold read time to finish rather than repeatedly aborting it.
      const probeTimeoutMs = Math.max(1_000, Math.min(15_000, deadline - Date.now()));
      const response = await fetch(`${baseUrl}/api/auth/csrf`, { signal: AbortSignal.timeout(probeTimeoutMs) });
      if (response.ok) return;
    } catch { /* readiness retry */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`next start did not become ready within ${startupTimeoutMs} ms`);
}

async function runRequest(baseUrl: string, cookie: string, phase: PhaseName, route: typeof M10_ROUTES[number], scheduledAt: number): Promise<Observation> {
  const startedAt = performance.now();
  let status = 0;
  try {
    const response = await fetch(`${baseUrl}${route.path}`, {
      // An RSC-only request asks Next.js for a complete server-component render.
      // A router-state header is navigation-specific and cannot be fabricated.
      headers: { cookie, RSC: "1" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    status = response.status;
    const responseBytes = (await response.arrayBuffer()).byteLength;
    const contentTypeValue = response.headers.get("content-type");
    const contentType = contentTypeValue?.includes("text/x-component") ? "rsc" : contentTypeValue ? "other" : "missing";
    const redirectedToLogin = new URL(response.url).pathname === "/login";
    return {
      category: redirectedToLogin ? "auth" : status >= 400 ? categorizeLoadError({ status }) : contentType !== "rsc" ? "invalid_rsc" : undefined,
      contentType,
      durationMs: performance.now() - startedAt,
      phase,
      rscBytes: contentType === "rsc" ? responseBytes : 0,
      scheduleDelayMs: Math.max(0, startedAt - scheduledAt),
      route: route.label,
      status,
    };
  } catch (error) {
    return { category: categorizeLoadError({ error }), contentType: "missing", durationMs: performance.now() - startedAt, phase, rscBytes: 0, scheduleDelayMs: Math.max(0, startedAt - scheduledAt), route: route.label, status };
  }
}

async function runPhase(baseUrl: string, sessions: string[], phase: PhaseName, profile: Profile, output: Observation[]) {
  const startedAt = performance.now();
  const interval = 1_000 / profile.requestsPerSecond;
  const requestCount = Math.floor(profile.durationSeconds * profile.requestsPerSecond);
  const active = new Set<Promise<void>>();
  let peakConcurrency = 0;
  for (let index = 0; index < requestCount; index += 1) {
    const scheduledAt = startedAt + index * interval;
    const wait = scheduledAt - performance.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    while (active.size >= profile.concurrency) await Promise.race(active);
    const route = M10_ROUTES[index % M10_ROUTES.length];
    // Rotate ordinary reads across all users while binding the approvals route
    // to the deterministic manager subset seeded at indices 0-9.
    const sessionIndex = route.sessionGroup === "manager" ? index % 10 : index % sessions.length;
    const request = runRequest(baseUrl, sessions[sessionIndex], phase, route, scheduledAt)
      .then((observation) => { output.push(observation); })
      .finally(() => { active.delete(request); });
    active.add(request);
    peakConcurrency = Math.max(peakConcurrency, active.size);
  }
  await Promise.all(active);
  return {
    elapsedSeconds: Math.max((performance.now() - startedAt) / 1_000, Number.EPSILON),
    peakConcurrency,
  };
}

async function sampleRss(pid: number) {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "rss=", "-p", String(pid)]);
    return Number(stdout.trim()) * 1_024;
  } catch { return 0; }
}

function summarize(observations: Observation[], durationSeconds: number) {
  const durations = observations.map((item) => item.durationMs);
  const scheduleDelays = observations.map((item) => item.scheduleDelayMs);
  const rscBytes = observations.map((item) => item.rscBytes);
  const errors = observations.filter((item) => item.category);
  return {
    count: observations.length,
    errors: errors.length,
    errorRate: observations.length ? errors.length / observations.length : 0,
    throughputPerSecond: durationSeconds ? observations.length / durationSeconds : 0,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    scheduleDelayP50Ms: percentile(scheduleDelays, 0.5),
    scheduleDelayP95Ms: percentile(scheduleDelays, 0.95),
    rscBytesP50: percentile(rscBytes, 0.5),
    rscBytesP95: percentile(rscBytes, 0.95),
    rscBytesTotal: rscBytes.reduce((sum, value) => sum + value, 0),
    statusCounts: Object.fromEntries([...new Set(observations.map((item) => item.status))].sort((a, b) => a - b).map((status) => [status, observations.filter((item) => item.status === status).length])),
    contentTypeCounts: Object.fromEntries((["rsc", "other", "missing"] as const).map((type) => [type, observations.filter((item) => item.contentType === type).length])),
    errorCategories: Object.fromEntries([...new Set(errors.map((item) => item.category!))].sort().map((category) => [category, errors.filter((item) => item.category === category).length])),
  };
}

function distribution(values: readonly number[]) {
  return { p50: percentile(values, 0.5), p95: percentile(values, 0.95), maximum: Math.max(0, ...values), samples: values.length };
}

function optionalDistribution(values: readonly number[]) {
  return values.length === 0 ? { available: false as const, samples: 0 } : { available: true as const, ...distribution(values) };
}

export function loadGateErrors(observations: readonly Pick<Observation, "category" | "route">[], routeLabels: readonly string[], resourceSampleCounts: { databaseConnections: number; rss: number }) {
  const errors: string[] = [];
  const failed = observations.filter((item) => item.category).length;
  if (failed > 0) errors.push(`${failed} requests had unexpected auth, HTTP, transport, or RSC errors`);
  for (const route of routeLabels) if (!observations.some((item) => item.route === route)) errors.push(`route ${route} had no samples`);
  if (resourceSampleCounts.rss === 0) errors.push("application RSS had no samples");
  if (resourceSampleCounts.databaseConnections === 0) errors.push("database connections had no samples");
  return errors;
}

async function tableCounts() {
  const tables = await prisma.$queryRaw<Array<{ tableName: string }>>(Prisma.sql`
    SELECT table_name AS "tableName" FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
    ORDER BY table_name
  `);
  const counts: Record<string, number> = {};
  for (const { tableName } of tables) {
    const quoted = `"${tableName.replaceAll('"', '""')}"`;
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM ${quoted}`);
    counts[tableName] = Number(rows[0]?.count ?? 0);
  }
  return counts;
}

export function changedTableCounts(before: Record<string, number>, after: Record<string, number>) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((table) => before[table] !== after[table])
    .sort()
    .map((table) => ({ table, before: before[table] ?? 0, after: after[table] ?? 0 }));
}

async function pgStatCalls() {
  try {
    const rows = await prisma.$queryRaw<Array<{ calls: bigint | null }>>(Prisma.sql`
      SELECT SUM(calls)::bigint AS calls FROM public.pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
    `);
    return Number(rows[0]?.calls ?? 0);
  } catch { return null; }
}

async function outboxTimingMetrics(runStartedAt: Date) {
  const rows = await prisma.$queryRaw<Array<{ queueWaitMs: number | null; serviceMs: number | null; endToEndMs: number | null }>>(Prisma.sql`
    SELECT
      EXTRACT(EPOCH FROM (attempt."startedAt" - message."availableAt")) * 1000::float8 AS "queueWaitMs",
      CASE WHEN attempt."completedAt" IS NOT NULL THEN EXTRACT(EPOCH FROM (attempt."completedAt" - attempt."startedAt")) * 1000 END::float8 AS "serviceMs",
      CASE WHEN message."deliveredAt" IS NOT NULL THEN EXTRACT(EPOCH FROM (message."deliveredAt" - message."createdAt")) * 1000 END::float8 AS "endToEndMs"
    FROM "OutboxDeliveryAttempt" attempt
    JOIN "OutboxMessage" message ON message.id = attempt."messageId"
    WHERE attempt."startedAt" >= ${runStartedAt}
  `);
  const metric = (key: keyof typeof rows[number]) => optionalDistribution(rows.map((row) => row[key]).filter((value): value is number => value !== null && value >= 0));
  return { queueWaitMs: metric("queueWaitMs"), serviceMs: metric("serviceMs"), endToEndMs: metric("endToEndMs") };
}

async function verifyDataset() {
  const [animals, cages, users, animalAssignments, cageAssignments, occupancy] = await Promise.all([
    prisma.animal.count(), prisma.cage.count(), prisma.user.count(),
    prisma.facilityIdentifierAssignment.count({ where: { entityType: "animal" } }),
    prisma.facilityIdentifierAssignment.count({ where: { entityType: "cage" } }),
    prisma.$queryRaw<Array<{ maximum: bigint }>>(Prisma.sql`
      SELECT COALESCE(MAX(occupancy), 0)::bigint AS maximum FROM
      (SELECT COUNT(*) AS occupancy FROM "Animal" WHERE "currentCageId" IS NOT NULL GROUP BY "currentCageId") counts
    `),
  ]);
  const result = { animals, cages, users, animalAssignments, cageAssignments, maximumCageOccupancy: Number(occupancy[0]?.maximum ?? 0) };
  if (animals !== M10_TARGETS.animals || cages !== M10_TARGETS.cages || users !== 55 || animalAssignments !== animals || cageAssignments !== cages || result.maximumCageOccupancy > 6) {
    throw new Error("Post-run dataset counts or identity/occupancy invariants changed");
  }
  return result;
}

async function main() {
  const worktreePath = process.cwd();
  const baseUrl = process.env.M10_LOAD_BASE_URL ?? "http://127.0.0.1:3310";
  const guardErrors = m10RunGuardErrors({
    databaseUrl: process.env.DATABASE_URL,
    directDatabaseUrl: process.env.DIRECT_DATABASE_URL,
    baseUrl,
    artifactDirectory: process.env.M10_LOAD_ARTIFACT_DIR,
    worktreePath,
  });
  if (guardErrors.length) throw new Error(`M10 load run refused: ${guardErrors.join("; ")}.`);
  await readFile(path.join(worktreePath, ".next", "BUILD_ID"), "utf8").catch(() => { throw new Error("A production build is required; run npm run build first"); });
  const profiles = loadProfiles();
  const url = new URL(baseUrl);
  const server = spawn(process.execPath, [path.join(worktreePath, "node_modules", "next", "dist", "bin", "next"), "start", "-H", url.hostname, "-p", url.port], {
    cwd: worktreePath,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const runStartedAt = new Date();
  const observations: Observation[] = [];
  const rssSamples: number[] = [];
  const dbConnectionSamples: number[] = [];
  const prismaPoolConnectionFailures: Record<string, number> = { pool_timeout: 0, connection_limit: 0, connection: 0, other: 0 };
  const applicationDatabaseFailures: ApplicationDatabaseFailureCounts = {
    P2024: 0,
    P1001: 0,
    P1002: 0,
    P1017: 0,
    poolTimeoutSignals: 0,
    connectionLimitSignals: 0,
  };
  let applicationStderrTail = "";
  server.stderr?.setEncoding("utf8");
  server.stderr?.on("data", (chunk: string) => {
    const lines = `${applicationStderrTail}${chunk}`.split(/\r?\n/);
    applicationStderrTail = lines.pop() ?? "";
    for (const line of lines) recordApplicationDatabaseFailureLine(line, applicationDatabaseFailures);
  });
  let monitorRunning = false;
  let monitor: NodeJS.Timeout | undefined;
  try {
    await waitForServer(baseUrl, server);
    const sessions = await Promise.all(Array.from({ length: 50 }, (_, index) => authenticate(baseUrl, index + 1)));
    const beforeTableCounts = await tableCounts();
    const callsBefore = await pgStatCalls();
    monitor = setInterval(async () => {
      if (monitorRunning) return;
      monitorRunning = true;
      try {
        rssSamples.push(await sampleRss(server.pid!));
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT COUNT(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database()
        `);
        dbConnectionSamples.push(Number(rows[0]?.count ?? 0));
      } catch (error) {
        const category = categorizePrismaPoolError(error);
        prismaPoolConnectionFailures[category] += 1;
      } finally { monitorRunning = false; }
    }, 1_000);
    const phaseExecution = {} as Record<PhaseName, { elapsedSeconds: number; peakConcurrency: number }>;
    for (const phase of ["warmup", "ramp", "steady"] as const) {
      phaseExecution[phase] = await runPhase(baseUrl, sessions, phase, profiles[phase], observations);
    }
    if (monitor) {
      clearInterval(monitor);
      monitor = undefined;
    }
    while (monitorRunning) await new Promise((resolve) => setTimeout(resolve, 10));
    if (applicationStderrTail) {
      recordApplicationDatabaseFailureLine(applicationStderrTail, applicationDatabaseFailures);
      applicationStderrTail = "";
    }
    const callsAfter = await pgStatCalls();

    const totalSeconds = Object.values(phaseExecution).reduce((sum, execution) => sum + execution.elapsedSeconds, 0);
    const gateErrors = loadGateErrors(observations, M10_ROUTES.map((route) => route.label), { databaseConnections: dbConnectionSamples.length, rss: rssSamples.length });
    if (gateErrors.length > 0) {
      const diagnostic = summarize(observations, totalSeconds);
      throw new Error(`M10 load acceptance gate failed: ${gateErrors.join("; ")}; aggregate diagnostics=${JSON.stringify({
        contentTypes: diagnostic.contentTypeCounts,
        errorCategories: diagnostic.errorCategories,
        statuses: diagnostic.statusCounts,
      })}`);
    }
    const routes = Object.fromEntries(M10_ROUTES.map((route) => [route.label, summarize(observations.filter((item) => item.route === route.label), totalSeconds)]));
    const phases = Object.fromEntries((Object.keys(profiles) as PhaseName[]).map((phase) => [phase, {
      ...summarize(observations.filter((item) => item.phase === phase), phaseExecution[phase].elapsedSeconds),
      configuredDurationSeconds: profiles[phase].durationSeconds,
      elapsedSeconds: phaseExecution[phase].elapsedSeconds,
      peakConcurrency: phaseExecution[phase].peakConcurrency,
    }]));
    const afterTableCounts = await tableCounts();
    const unexpectedWrites = changedTableCounts(beforeTableCounts, afterTableCounts);
    if (unexpectedWrites.length > 0) throw new Error(`Read-only load caused unexpected writes in: ${unexpectedWrites.map((item) => item.table).join(", ")}`);
    const dataset = await verifyDataset();
    const postgres = await prisma.$queryRawUnsafe<Array<{ server_version: string }>>("SHOW server_version");
    const databaseUrl = new URL(process.env.DATABASE_URL!);
    const commit = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: worktreePath }).then(({ stdout }) => stdout.trim()).catch(() => "unavailable");
    const workingTreeDirty = await execFileAsync("git", ["status", "--porcelain"], { cwd: worktreePath })
      .then(({ stdout }) => stdout.trim().length > 0)
      .catch(() => null);
    const report = {
      schemaVersion: 1,
      profile: process.env.M10_LOAD_PROFILE === "quick" ? "quick" : "default",
      sessions: 50,
      profiles,
      overall: summarize(observations, totalSeconds),
      routes,
      phases,
      dataset,
      databaseCalls: callsBefore === null || callsAfter === null
        ? { available: false, reason: "pg_stat_statements unavailable; no SQL text was collected" }
        : {
            available: true,
            callsDelta: Math.max(0, callsAfter - callsBefore),
            instrumentationCalls: dbConnectionSamples.length,
            estimatedApplicationCalls: Math.max(0, callsAfter - callsBefore - dbConnectionSamples.length),
            note: "The estimate subtracts only the known pg_stat_activity sampler calls; no SQL text or parameters were collected.",
          },
      outboxTimings: {
        probeRan: false,
        note: "No delivery worker ran during this read-only load; empty distributions are reported as unavailable.",
        ...await outboxTimingMetrics(runStartedAt),
      },
      unexpectedWrites,
      resources: {
        appRssBytes: distribution(rssSamples),
        databaseConnections: distribution(dbConnectionSamples),
        prismaPoolConnectionFailures: {
          monitorClient: prismaPoolConnectionFailures,
          application: { available: true, ...applicationDatabaseFailures },
        },
      },
      environment: {
        commit,
        workingTreeDirty,
        node: process.version,
        postgres: postgres[0]?.server_version ?? "unavailable",
        machine: { platform: os.platform(), architecture: os.arch(), cpuCount: os.cpus().length, totalMemoryBytes: os.totalmem() },
        databasePool: {
          connectionLimit: databaseUrl.searchParams.get("connection_limit") ? Number(databaseUrl.searchParams.get("connection_limit")) : null,
          poolTimeoutSeconds: databaseUrl.searchParams.get("pool_timeout") ? Number(databaseUrl.searchParams.get("pool_timeout")) : null,
        },
        worker: {
          cadenceMs: process.env.OUTBOX_WORKER_CADENCE_MS ? Number(process.env.OUTBOX_WORKER_CADENCE_MS) : null,
          batchSize: process.env.OUTBOX_WORKER_BATCH_SIZE ? Number(process.env.OUTBOX_WORKER_BATCH_SIZE) : null,
          concurrency: process.env.OUTBOX_WORKER_CONCURRENCY ? Number(process.env.OUTBOX_WORKER_CONCURRENCY) : null,
        },
      },
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const runDirectory = path.join(path.resolve(process.env.M10_LOAD_ARTIFACT_DIR!), stamp);
    await mkdir(runDirectory, { recursive: true, mode: 0o700 });
    const csv = ["route,count,errors,error_rate,throughput_per_second,p50_ms,p95_ms,schedule_delay_p50_ms,schedule_delay_p95_ms,rsc_bytes_p50,rsc_bytes_p95,rsc_bytes_total", ...M10_ROUTES.map((route) => {
      const item = routes[route.label];
      return [route.label, item.count, item.errors, item.errorRate, item.throughputPerSecond, item.p50Ms, item.p95Ms, item.scheduleDelayP50Ms, item.scheduleDelayP95Ms, item.rscBytesP50, item.rscBytesP95, item.rscBytesTotal].join(",");
    })].join("\n") + "\n";
    const markdown = `# M10 local load result\n\n- Profile: ${report.profile}\n- Authenticated sessions: 50\n- Requests: ${report.overall.count}\n- Errors: ${report.overall.errors}\n- Overall p50 / p95: ${report.overall.p50Ms.toFixed(1)} ms / ${report.overall.p95Ms.toFixed(1)} ms\n- Throughput: ${report.overall.throughputPerSecond.toFixed(2)} requests/second\n- Client schedule delay p50 / p95: ${report.overall.scheduleDelayP50Ms.toFixed(1)} ms / ${report.overall.scheduleDelayP95Ms.toFixed(1)} ms\n- RSC response bytes p50 / p95: ${report.overall.rscBytesP50} / ${report.overall.rscBytesP95}\n- App RSS p50 / p95 / max: ${report.resources.appRssBytes.p50} / ${report.resources.appRssBytes.p95} / ${report.resources.appRssBytes.maximum} bytes\n- Database connections p50 / p95 / max: ${report.resources.databaseConnections.p50} / ${report.resources.databaseConnections.p95} / ${report.resources.databaseConnections.maximum}\n- Unexpected writes during read load: ${report.unexpectedWrites.length}\n`;
    await Promise.all([
      writeFile(path.join(runDirectory, "summary.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }),
      writeFile(path.join(runDirectory, "routes.csv"), csv, { mode: 0o600 }),
      writeFile(path.join(runDirectory, "summary.md"), markdown, { mode: 0o600 }),
    ]);
    console.log(`M10 load run completed. Sanitized artifacts: ${runDirectory}`);
  } finally {
    if (monitor) clearInterval(monitor);
    await prisma.$disconnect();
    if (server.exitCode === null) server.kill("SIGTERM");
  }
}

const direct = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (direct) main().catch((error) => { console.error(error instanceof Error ? error.message : "M10 load run failed"); process.exitCode = 1; });
