import { describe, expect, it } from "vitest";

import {
  buildQueueProbeMetrics,
  freshQueueProbeErrors,
  m10QueueProbeGuardErrors,
  queueProbeDistribution,
} from "../../scripts/run-m10-outbox-probe";

const target = "postgresql://postgres:postgres@127.0.0.1:5432/colony?schema=mcm_test_m10_queue_01";
const artifactDirectory = "/project/.runtime-data/m10-load/queue-probes";
const worktreePath = "/project/.runtime-data/worktrees/queue-probe";

describe("M10 synthetic outbox probe guard", () => {
  it("accepts only an explicit non-production exact dedicated loopback target", () => {
    expect(m10QueueProbeGuardErrors({
      artifactDirectory,
      databaseUrl: target,
      directDatabaseUrl: target,
      enabled: "true",
      nodeEnv: "test",
      worktreePath,
    })).toEqual([]);
  });

  it("rejects missing opt-in, production, mismatched or remote targets, and unsafe artifacts", () => {
    const errors = m10QueueProbeGuardErrors({
      artifactDirectory: `${worktreePath}/results`,
      databaseUrl: "postgresql://user:secret@db.example.test/colony?schema=mcm_test_m10_queue_01",
      directDatabaseUrl: `${target}&connection_limit=2`,
      enabled: "false",
      nodeEnv: "production",
      worktreePath,
    });
    expect(errors).toEqual(expect.arrayContaining([
      "M10_QUEUE_PROBE must be true",
      "NODE_ENV must not be production",
      "DATABASE_URL and DIRECT_DATABASE_URL must match exactly",
      "DATABASE_URL must use a loopback host",
      "artifact directory must be outside the worktree",
    ]));
  });

  it("requires the queue-specific marker in the database or schema", () => {
    const unmarked = "postgresql://postgres:postgres@127.0.0.1:5432/colony?schema=public";
    expect(m10QueueProbeGuardErrors({
      artifactDirectory,
      databaseUrl: unmarked,
      directDatabaseUrl: unmarked,
      enabled: "true",
      nodeEnv: "test",
      worktreePath,
    })).toEqual(expect.arrayContaining([
      "DATABASE_URL database or schema must contain mcm_test_m10_queue",
      "DIRECT_DATABASE_URL database or schema must contain mcm_test_m10_queue",
    ]));
  });

  it("refuses any pre-existing row in the four durable queue tables", () => {
    expect(freshQueueProbeErrors({
      notificationEvents: 0,
      notificationDeliveries: 0,
      outboxMessages: 0,
      deliveryAttempts: 0,
    })).toEqual([]);
    expect(freshQueueProbeErrors({
      notificationEvents: 0,
      notificationDeliveries: 1,
      outboxMessages: 0,
      deliveryAttempts: 0,
    })).toEqual(["notification event, delivery, outbox, and attempt tables must all be empty"]);
  });
});

describe("M10 synthetic outbox probe metrics", () => {
  it("computes deterministic nearest-rank p50, p95, max, and count", () => {
    expect(queueProbeDistribution([100, 5, 20, 10])).toEqual({
      count: 4,
      p50Ms: 10,
      p95Ms: 100,
      maxMs: 100,
    });
  });

  it("exports only aggregate queue-wait, service, and end-to-end timings", () => {
    const metrics = buildQueueProbeMetrics([{
      availableAt: new Date("2026-08-12T10:00:00.000Z"),
      startedAt: new Date("2026-08-12T10:00:00.010Z"),
      completedAt: new Date("2026-08-12T10:00:00.030Z"),
      createdAt: new Date("2026-08-12T10:00:00.000Z"),
      deliveredAt: new Date("2026-08-12T10:00:00.035Z"),
    }]);
    expect(metrics).toEqual({
      status: "passed",
      queueWait: { count: 1, p50Ms: 10, p95Ms: 10, maxMs: 10 },
      service: { count: 1, p50Ms: 20, p95Ms: 20, maxMs: 20 },
      endToEnd: { count: 1, p50Ms: 35, p95Ms: 35, maxMs: 35 },
    });
    const serialized = JSON.stringify(metrics).toLowerCase();
    for (const forbidden of ["id", "url", "email", "payload", "token", "log", "request", "provider"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
