import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getOutboxWorkerLimits } from "@/lib/notification-delivery";

describe("portable outbox worker bounds", () => {
  it("hard-clamps scheduler-controlled work and keeps the lease longer than provider I/O", () => {
    expect(getOutboxWorkerLimits({
      batchSize: 100_000,
      concurrency: 1_000,
      providerTimeoutMs: 999_999,
      runTimeoutMs: 999_999_999,
      leaseMs: 1,
      maintenanceLimit: 50_000,
    })).toEqual({
      batchSize: 100,
      concurrency: 8,
      providerTimeoutMs: 30_000,
      runTimeoutMs: 600_000,
      leaseMs: 80_000,
      maintenanceLimit: 100,
    });
  });

  it("reduces provider time to fit a clamped run and covers DNS plus HTTP in the lease", () => {
    expect(getOutboxWorkerLimits({
      providerTimeoutMs: 30_000,
      runTimeoutMs: 1,
      leaseMs: 1,
    })).toMatchObject({
      providerTimeoutMs: 5_000,
      runTimeoutMs: 30_000,
      leaseMs: 30_000,
    });
  });

  it("keeps the scheduler entry point session-free and limits supported consumers", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts/run-outbox-worker.ts"), "utf8");
    expect(source).toContain('rawWorkerType !== "notification_delivery"');
    expect(source).toContain('rawWorkerType !== "sop_delivery"');
    expect(source).not.toContain("requireUser");
    expect(source).not.toContain("ResolvedActor");
    expect(source).not.toContain("payload");
    expect(source).not.toContain("leaseToken");
  });

  it("reclassifies a one-job post-call deadline overrun instead of reporting completion", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/notification-delivery.ts"), "utf8");
    const runner = source.slice(
      source.indexOf("export async function runOutboxWorkerOnce"),
      source.indexOf("export async function deliverNotificationDigest"),
    );
    const resultCount = runner.indexOf("totals[status] += 1;");
    const postCallDeadline = runner.indexOf("if (Date.now() >= deadline)", resultCount);
    const outcome = runner.indexOf('deadlineHit ? "timed_out"', postCallDeadline);
    expect(resultCount).toBeGreaterThan(0);
    expect(postCallDeadline).toBeGreaterThan(resultCount);
    expect(outcome).toBeGreaterThan(postCallDeadline);
  });

  it("stops before claiming near the deadline and preserves an unexpected claimed attempt as failed", () => {
    const deliverySource = fs.readFileSync(path.join(process.cwd(), "src/lib/notification-delivery.ts"), "utf8");
    const commandSource = fs.readFileSync(path.join(process.cwd(), "src/lib/command-foundation.ts"), "utf8");
    const runner = deliverySource.slice(
      deliverySource.indexOf("export async function runOutboxWorkerOnce"),
      deliverySource.indexOf("export async function deliverNotificationDigest"),
    );
    expect(runner.indexOf('deadline - Date.now() < minimumNotificationWindowMs')).toBeLessThan(
      runner.indexOf("const [message] = await claimOutboxMessages"),
    );
    expect(runner).toContain("claimBefore:");
    expect(runner).toContain("Worker clock advanced past the safe provider window after the durable claim.");
    expect(commandSource).not.toContain("releaseUnstartedOutboxMessage");
    expect(commandSource).not.toContain("attemptCount: { decrement: 1 }");
    const failure = commandSource.slice(
      commandSource.indexOf("export async function failOutboxMessage"),
      commandSource.indexOf("export async function createMigrationRun"),
    );
    expect(failure).toContain('status: "failed", completedAt: now');
  });

  it("attempts each durable message at most once per scheduled invocation", () => {
    const deliverySource = fs.readFileSync(path.join(process.cwd(), "src/lib/notification-delivery.ts"), "utf8");
    const commandSource = fs.readFileSync(path.join(process.cwd(), "src/lib/command-foundation.ts"), "utf8");
    expect(deliverySource.match(/const attemptedMessageIds = new Set<string>\(\);/g)).toHaveLength(2);
    expect(deliverySource.match(/excludeMessageIds: \[\.\.\.attemptedMessageIds\]/g)).toHaveLength(2);
    expect(deliverySource.match(/attemptedMessageIds\.add\(message\.id\);/g)).toHaveLength(2);
    expect(commandSource).toContain("excludeMessageIds?: readonly string[];");
    expect(commandSource).toContain("AND id NOT IN (${Prisma.join(excludedMessageIds)})");
  });
});
