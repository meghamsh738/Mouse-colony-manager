import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Prisma } from "@prisma/client";

import { materializeDashboardNotifications } from "../src/lib/notification-materialization";
import { runOutboxWorkerOnce } from "../src/lib/notification-delivery";
import { prisma } from "../src/lib/prisma";
import { isM10LoopbackServerAddress, percentile } from "./m10-load-common";

export const M10_QUEUE_SCHEMA_MARKER = "mcm_test_m10_queue";

type ProbeGuardInput = {
  artifactDirectory?: string;
  databaseUrl?: string;
  directDatabaseUrl?: string;
  enabled?: string;
  nodeEnv?: string;
  worktreePath: string;
};

type TimingDistribution = {
  count: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
};

export type QueueProbeMetrics = {
  status: "passed";
  queueWait: TimingDistribution;
  service: TimingDistribution;
  endToEnd: TimingDistribution;
};

class ProbeRefusalError extends Error {}

function parsedTarget(rawUrl: string, label: string, errors: string[]) {
  try {
    const url = new URL(rawUrl);
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const schema = url.searchParams.get("schema") ?? "public";
    if (!["postgresql:", "postgres:"].includes(url.protocol)) errors.push(`${label} must use PostgreSQL`);
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
      errors.push(`${label} must use a loopback host`);
    }
    if (!database.includes(M10_QUEUE_SCHEMA_MARKER) && !schema.includes(M10_QUEUE_SCHEMA_MARKER)) {
      errors.push(`${label} database or schema must contain ${M10_QUEUE_SCHEMA_MARKER}`);
    }
    return { database, schema };
  } catch {
    errors.push(`${label} must be a valid database URL`);
    return undefined;
  }
}

export function m10QueueProbeGuardErrors(input: ProbeGuardInput) {
  const errors: string[] = [];
  if (input.enabled !== "true") errors.push("M10_QUEUE_PROBE must be true");
  if (input.nodeEnv === "production") errors.push("NODE_ENV must not be production");
  if (!input.databaseUrl) errors.push("DATABASE_URL is required");
  if (!input.directDatabaseUrl) errors.push("DIRECT_DATABASE_URL is required");
  if (input.databaseUrl && input.directDatabaseUrl && input.databaseUrl !== input.directDatabaseUrl) {
    errors.push("DATABASE_URL and DIRECT_DATABASE_URL must match exactly");
  }
  if (input.databaseUrl) parsedTarget(input.databaseUrl, "DATABASE_URL", errors);
  if (input.directDatabaseUrl) parsedTarget(input.directDatabaseUrl, "DIRECT_DATABASE_URL", errors);

  if (!input.artifactDirectory) {
    errors.push("M10_QUEUE_PROBE_ARTIFACT_DIR is required");
  } else {
    const configured = path.resolve(input.artifactDirectory);
    const worktree = path.resolve(input.worktreePath);
    const approvedMarker = `${path.sep}.runtime-data${path.sep}m10-load`;
    if (!path.isAbsolute(input.artifactDirectory)) errors.push("artifact directory must be an absolute path");
    if (!(configured.includes(`${approvedMarker}${path.sep}`) || configured.endsWith(approvedMarker))) {
      errors.push("artifact directory must be under .runtime-data/m10-load");
    }
    if (configured === worktree || configured.startsWith(`${worktree}${path.sep}`)) {
      errors.push("artifact directory must be outside the worktree");
    }
  }
  return [...new Set(errors)];
}

export function queueProbeDistribution(values: readonly number[]): TimingDistribution {
  if (!values.length) throw new Error("Queue probe timing distribution requires at least one sample.");
  const normalized = values.map((value) => Math.max(0, value));
  return {
    count: normalized.length,
    p50Ms: percentile(normalized, 0.5),
    p95Ms: percentile(normalized, 0.95),
    maxMs: Math.max(...normalized),
  };
}

export function freshQueueProbeErrors(counts: {
  notificationEvents: number;
  notificationDeliveries: number;
  outboxMessages: number;
  deliveryAttempts: number;
}) {
  return Object.values(counts).some((count) => count !== 0)
    ? ["notification event, delivery, outbox, and attempt tables must all be empty"]
    : [];
}

export function buildQueueProbeMetrics(rows: ReadonlyArray<{
  availableAt: Date;
  startedAt: Date;
  completedAt: Date;
  createdAt: Date;
  deliveredAt: Date;
}>): QueueProbeMetrics {
  return {
    status: "passed",
    queueWait: queueProbeDistribution(rows.map((row) => row.startedAt.getTime() - row.availableAt.getTime())),
    service: queueProbeDistribution(rows.map((row) => row.completedAt.getTime() - row.startedAt.getTime())),
    endToEnd: queueProbeDistribution(rows.map((row) => row.deliveredAt.getTime() - row.createdAt.getTime())),
  };
}

async function assertLiveDedicatedTarget() {
  const expectedUrl = new URL(process.env.DIRECT_DATABASE_URL!);
  const expected = {
    database: decodeURIComponent(expectedUrl.pathname.replace(/^\//, "")),
    schema: expectedUrl.searchParams.get("schema") ?? "public",
  };
  const [live] = await prisma.$queryRaw<Array<{
    database: string;
    schema: string;
    serverAddress: string | null;
  }>>(Prisma.sql`
    SELECT current_database() AS database, current_schema() AS schema,
      inet_server_addr()::text AS "serverAddress"
  `);
  if (!live || live.database !== expected.database || live.schema !== expected.schema) {
    throw new ProbeRefusalError("Connected database/schema does not match the guarded URL target.");
  }
  if (!isM10LoopbackServerAddress(live.serverAddress)) {
    throw new ProbeRefusalError("Connected PostgreSQL server is not loopback.");
  }
  if (!live.database.includes(M10_QUEUE_SCHEMA_MARKER) && !live.schema.includes(M10_QUEUE_SCHEMA_MARKER)) {
    throw new ProbeRefusalError(`Live database or schema must contain ${M10_QUEUE_SCHEMA_MARKER}.`);
  }
}

async function assertFreshQueueAndSeedIdentity() {
  const [notificationEvents, notificationDeliveries, outboxMessages, deliveryAttempts] = await Promise.all([
    prisma.notificationEvent.count(),
    prisma.notificationDelivery.count(),
    prisma.outboxMessage.count(),
    prisma.outboxDeliveryAttempt.count(),
  ]);
  const queueErrors = freshQueueProbeErrors({ notificationEvents, notificationDeliveries, outboxMessages, deliveryAttempts });
  if (queueErrors.length) {
    throw new ProbeRefusalError(`Queue probe requires a fresh queue: ${queueErrors.join("; ")}.`);
  }
  const [producer, lab, cage, rule] = await Promise.all([
    prisma.user.findUnique({ where: { id: "user-admin" }, select: { id: true, active: true } }),
    prisma.lab.findUnique({ where: { id: "lab-microglia" }, select: { id: true, active: true } }),
    prisma.cage.findUnique({ where: { id: "cage-a101-001" }, select: { id: true, labId: true } }),
    prisma.ruleConfig.findUnique({ where: { key: "notify_email_enabled" }, select: { key: true } }),
  ]);
  if (!producer?.active || !lab?.active || !cage || cage.labId !== lab.id || !rule) {
    throw new ProbeRefusalError("Normal seed identities and notification rule are required before running the probe.");
  }
}

async function startIdempotentProvider() {
  const acceptedKeys = new Set<string>();
  let invalidRequests = 0;
  let requestCount = 0;
  const server = createServer((request, response) => {
    requestCount += 1;
    const rawKey = request.headers["idempotency-key"];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (request.method !== "POST" || !key) {
      invalidRequests += 1;
      request.resume();
      response.writeHead(400);
      response.end();
      return;
    }
    acceptedKeys.add(key);
    request.once("end", () => {
      response.writeHead(202, { "x-message-id": key });
      response.end();
    });
    request.resume();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Synthetic provider failed to bind.");
  return {
    acceptedKeys,
    invalidRequests: () => invalidRequests,
    requestCount: () => requestCount,
    url: `http://127.0.0.1:${address.port}/send`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function writeSanitizedMetrics(metrics: QueueProbeMetrics) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const root = path.resolve(process.env.M10_QUEUE_PROBE_ARTIFACT_DIR!);
  const runDirectory = path.join(root, `queue-probe-${stamp}`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  await mkdir(runDirectory, { mode: 0o700 });
  await chmod(runDirectory, 0o700);
  const markdown = `# M10 synthetic queue probe\n\n| Timing | Count | p50 (ms) | p95 (ms) | Max (ms) |\n| --- | ---: | ---: | ---: | ---: |\n| Queue wait | ${metrics.queueWait.count} | ${metrics.queueWait.p50Ms} | ${metrics.queueWait.p95Ms} | ${metrics.queueWait.maxMs} |\n| Service | ${metrics.service.count} | ${metrics.service.p50Ms} | ${metrics.service.p95Ms} | ${metrics.service.maxMs} |\n| End to end | ${metrics.endToEnd.count} | ${metrics.endToEnd.p50Ms} | ${metrics.endToEnd.p95Ms} | ${metrics.endToEnd.maxMs} |\n`;
  const jsonPath = path.join(runDirectory, "summary.json");
  const markdownPath = path.join(runDirectory, "summary.md");
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(metrics, null, 2)}\n`, { mode: 0o600, flag: "wx" }),
    writeFile(markdownPath, markdown, { mode: 0o600, flag: "wx" }),
  ]);
  await Promise.all([chmod(jsonPath, 0o600), chmod(markdownPath, 0o600)]);
}

export async function runM10OutboxProbe() {
  const guardErrors = m10QueueProbeGuardErrors({
    artifactDirectory: process.env.M10_QUEUE_PROBE_ARTIFACT_DIR,
    databaseUrl: process.env.DATABASE_URL,
    directDatabaseUrl: process.env.DIRECT_DATABASE_URL,
    enabled: process.env.M10_QUEUE_PROBE,
    nodeEnv: process.env.NODE_ENV,
    worktreePath: process.cwd(),
  });
  if (guardErrors.length) throw new ProbeRefusalError(`M10 queue probe refused: ${guardErrors.join("; ")}.`);
  await assertLiveDedicatedTarget();
  await assertFreshQueueAndSeedIdentity();

  const provider = await startIdempotentProvider();
  const workerToken = randomBytes(32).toString("hex");
  process.env.NOTIFICATION_EMAIL_PROVIDER_URL = provider.url;
  process.env.NOTIFICATION_EMAIL_PROVIDER_HOSTS = "127.0.0.1";
  process.env.NOTIFICATION_EMAIL_FROM = "m10-queue-probe@example.test";
  process.env.NOTIFICATION_EMAIL_PROVIDER_SUPPORTS_IDEMPOTENCY = "true";
  process.env.OUTBOX_WORKER_TOKEN_NOTIFICATION_DELIVERY = workerToken;
  try {
    await prisma.ruleConfig.update({ where: { key: "notify_email_enabled" }, data: { value: true } });
    const probeKey = randomUUID();
    await materializeDashboardNotifications({
      alerts: [{
        id: `m10-queue-probe-${probeKey}`,
        labId: "lab-microglia",
        entityType: "cage",
        entityId: "cage-a101-001",
        alertType: "welfare_note",
        severity: "critical",
        message: "Synthetic local queue timing probe.",
        status: "open",
        generatedAt: new Date().toISOString(),
        source: "manual",
      }],
      scopeLabIds: ["lab-microglia"],
      includeGlobal: false,
      producerId: "user-admin",
      resolveMissing: false,
    });
    const queued = await prisma.outboxMessage.count({ where: { topic: "notifications.email", status: "pending" } });
    if (queued < 1 || queued > 100) throw new Error("Synthetic alert did not create a bounded notification queue.");

    const worker = await runOutboxWorkerOnce({
      workerType: "notification_delivery",
      workerId: "m10-local-queue-probe",
      token: workerToken,
      batchSize: 100,
      concurrency: 4,
      providerTimeoutMs: 5_000,
      runTimeoutMs: 60_000,
      leaseMs: 30_000,
      maintenanceLimit: 25,
    });
    if (worker.outcome !== "completed" || worker.exitCode !== 0 || worker.delivered !== queued || worker.failed || worker.cancelled) {
      throw new Error("Production outbox worker did not complete every synthetic delivery.");
    }

    const [deliveries, messages, attempts] = await Promise.all([
      prisma.notificationDelivery.findMany({
        select: { status: true, deliveredAt: true, outboxMessageId: true },
      }),
      prisma.outboxMessage.findMany({
        select: { id: true, status: true, availableAt: true, createdAt: true, deliveredAt: true },
      }),
      prisma.outboxDeliveryAttempt.findMany({
        select: { messageId: true, attemptNumber: true, status: true, startedAt: true, completedAt: true },
      }),
    ]);
    if (
      deliveries.length !== queued
      || messages.length !== queued
      || attempts.length !== queued
      || deliveries.some((row) => row.status !== "delivered" || !row.deliveredAt)
      || messages.some((row) => row.status !== "delivered" || !row.deliveredAt)
      || attempts.some((row) => row.status !== "delivered" || row.attemptNumber !== 1 || !row.completedAt)
      || provider.invalidRequests() !== 0
      || provider.requestCount() !== queued
      || provider.acceptedKeys.size !== queued
    ) {
      throw new Error("Synthetic delivery, attempt, or idempotent-provider verification failed.");
    }
    const messagesById = new Map(messages.map((message) => [message.id, message]));
    const timingRows = attempts.map((attempt) => {
      const message = messagesById.get(attempt.messageId);
      if (!message?.deliveredAt || !attempt.completedAt) throw new Error("Synthetic timing evidence is incomplete.");
      return {
        availableAt: message.availableAt,
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
        createdAt: message.createdAt,
        deliveredAt: message.deliveredAt,
      };
    });
    const metrics = buildQueueProbeMetrics(timingRows);
    await writeSanitizedMetrics(metrics);
    console.log(JSON.stringify(metrics));
    return metrics;
  } finally {
    await provider.close();
  }
}

const direct = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (direct) {
  runM10OutboxProbe()
    .catch((error) => {
      console.error(error instanceof ProbeRefusalError ? error.message : "M10 queue probe failed; inspect the preserved dedicated database.");
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
