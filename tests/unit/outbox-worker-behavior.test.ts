import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  deliver: vi.fn(),
  fail: vi.fn(),
  maintain: vi.fn(),
  ruleFind: vi.fn(),
  securityCreate: vi.fn(),
  securityCreateMany: vi.fn(),
  securityFind: vi.fn(),
}));

vi.mock("@/lib/command-foundation", () => ({
  OUTBOX_MAX_CLAIM_BATCH: 100,
  OUTBOX_MAX_MAINTENANCE_BATCH: 100,
  authenticateOutboxWorker: vi.fn((input: { workerId: string; workerType: string; token: string }) => (
    input.token.length >= 32 ? { id: input.workerId, type: input.workerType } : null
  )),
  claimOutboxMessages: mocks.claim,
  completeOutboxMessage: mocks.complete,
  deliverClaimedNotificationMessage: mocks.deliver,
  failOutboxMessage: mocks.fail,
  maintainExpiredOutboxLeases: mocks.maintain,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ruleConfig: { findUnique: mocks.ruleFind },
    securityEvent: {
      create: mocks.securityCreate,
      createMany: mocks.securityCreateMany,
      findUniqueOrThrow: mocks.securityFind,
    },
  },
}));

import { runOutboxWorkerOnce } from "@/lib/notification-delivery";

const token = "behavior-worker-token-at-least-32-characters";
const message = {
  id: "message-1",
  attemptCount: 1,
  leaseToken: "lease-1",
} as never;

describe("one-shot outbox worker behavior", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T10:00:00.000Z"));
    vi.stubEnv("NOTIFICATION_EMAIL_PROVIDER_URL", "http://127.0.0.1:8099/send");
    vi.stubEnv("NOTIFICATION_EMAIL_FROM", "worker@example.test");
    vi.stubEnv("NOTIFICATION_EMAIL_PROVIDER_SUPPORTS_IDEMPOTENCY", "true");
    mocks.ruleFind.mockResolvedValue({ value: true });
    mocks.maintain.mockResolvedValue({ scanned: 0, retried: 0, deadLettered: 0 });
    mocks.securityCreateMany.mockResolvedValue({ count: 1 });
    mocks.securityFind.mockResolvedValue({});
    mocks.claim.mockResolvedValue([]);
    mocks.fail.mockResolvedValue(true);
  });

  it("classifies a run as timed out when provider completion crosses the run deadline", async () => {
    mocks.claim.mockResolvedValueOnce([message]).mockResolvedValueOnce([]);
    mocks.deliver.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date("2026-08-13T10:00:31.000Z"));
      return { status: "delivered" };
    });

    const result = await runOutboxWorkerOnce({
      workerType: "notification_delivery",
      workerId: "behavior-timeout-worker",
      token,
      batchSize: 1,
      concurrency: 1,
      providerTimeoutMs: 5_000,
      runTimeoutMs: 30_000,
    });

    expect(result).toMatchObject({
      outcome: "timed_out",
      exitCode: 1,
      claimed: 1,
      delivered: 1,
      failed: 0,
    });
    expect(mocks.deliver).toHaveBeenCalledOnce();
  });

  it("records only one attempt for a message during one invocation after provider failure", async () => {
    mocks.claim.mockImplementation(async (input: { excludeMessageIds?: string[] }) => (
      input.excludeMessageIds?.includes("message-1") ? [] : [message]
    ));
    mocks.deliver.mockRejectedValueOnce(new Error("synthetic provider failure"));

    const result = await runOutboxWorkerOnce({
      workerType: "notification_delivery",
      workerId: "behavior-failure-worker",
      token,
      batchSize: 5,
      concurrency: 1,
      providerTimeoutMs: 5_000,
      runTimeoutMs: 60_000,
    });

    expect(result).toMatchObject({
      outcome: "completed",
      exitCode: 1,
      claimed: 1,
      delivered: 0,
      failed: 1,
    });
    expect(mocks.deliver).toHaveBeenCalledOnce();
    expect(mocks.fail).toHaveBeenCalledOnce();
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    expect(mocks.claim.mock.calls[1]?.[0]).toMatchObject({ excludeMessageIds: ["message-1"] });
  });
});
