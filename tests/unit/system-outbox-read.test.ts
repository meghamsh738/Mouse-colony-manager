import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  outboxFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    outboxMessage: { findMany: mocks.outboxFindMany },
  },
}));

import { getOutboxQueueView } from "@/lib/system-read";
import type { ResolvedActor } from "@/lib/session";

function actor(canonicalRole: "it_head" | "facility_admin"): ResolvedActor {
  return {
    id: `user-${canonicalRole}`,
    email: `${canonicalRole}@example.test`,
    name: canonicalRole,
    role: canonicalRole,
    databaseRole: canonicalRole,
    canonicalRole,
    authzVersion: 1,
    activeLabId: null,
    activeMembership: null,
    memberships: [],
    capabilities: [],
  };
}

function queueMessage(index: number) {
  return {
    id: `outbox-${index}`,
    topic: "notification.email",
    status: "retry" as const,
    attemptCount: 2,
    maxAttempts: 8,
    availableAt: new Date("2026-07-17T11:00:00.000Z"),
    leasedAt: null,
    leaseExpiresAt: null,
    deliveredAt: null,
    deadLetteredAt: null,
    createdAt: new Date(`2026-07-17T10:0${index}:00.000Z`),
    updatedAt: new Date(`2026-07-17T10:1${index}:00.000Z`),
    attempts: [{
      id: `attempt-${index}`,
      attemptNumber: 2,
      workerId: "worker-7",
      workerType: "notification",
      status: "failed" as const,
      authorizedAt: new Date("2026-07-17T10:00:00.000Z"),
      startedAt: new Date("2026-07-17T10:01:00.000Z"),
      completedAt: new Date("2026-07-17T10:02:00.000Z"),
    }],
  };
}

describe("technical outbox queue projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    mocks.outboxFindMany.mockResolvedValue([]);
  });

  it("selects only allowlisted technical message and attempt metadata", async () => {
    mocks.outboxFindMany.mockResolvedValueOnce([queueMessage(1)]);

    const page = await getOutboxQueueView(actor("it_head"), {
      query: "notification",
      status: "retry",
      limit: 25,
    });

    const request = mocks.outboxFindMany.mock.calls[0]?.[0];
    expect(request.where).toEqual({
      status: "retry",
      OR: [
        { id: { contains: "notification", mode: "insensitive" } },
        { topic: { contains: "notification", mode: "insensitive" } },
      ],
    });
    expect(Object.keys(request.select).sort()).toEqual([
      "attemptCount", "attempts", "availableAt", "createdAt", "deadLetteredAt", "deliveredAt",
      "id", "leaseExpiresAt", "leasedAt", "maxAttempts", "status", "topic", "updatedAt",
    ].sort());
    expect(Object.keys(request.select.attempts.select).sort()).toEqual([
      "authorizedAt", "completedAt", "id", "attemptNumber", "startedAt", "status", "workerId", "workerType",
    ].sort());
    expect(request.select.attempts).toMatchObject({ take: 3, orderBy: [{ attemptNumber: "desc" }, { id: "desc" }] });
    expect(page.items[0]).toMatchObject({
      id: "outbox-1",
      availability: "ready",
      leaseState: "not_leased",
      attemptsRemaining: 6,
      availableAt: "2026-07-17T11:00:00.000Z",
      attempts: [{
        id: "attempt-1",
        authorizedAt: "2026-07-17T10:00:00.000Z",
        completedAt: "2026-07-17T10:02:00.000Z",
      }],
    });
  });

  it("cursor-paginates queue messages and derives safe lease indicators", async () => {
    const rows = [queueMessage(1), queueMessage(2), {
      ...queueMessage(3),
      status: "leased" as const,
      leasedAt: new Date("2026-07-17T11:30:00.000Z"),
      leaseExpiresAt: new Date("2026-07-17T11:59:00.000Z"),
    }];
    mocks.outboxFindMany.mockResolvedValueOnce(rows);

    const page = await getOutboxQueueView(actor("it_head"), { cursor: "outbox-0", limit: 2 });

    expect(mocks.outboxFindMany.mock.calls[0]?.[0]).toMatchObject({
      cursor: { id: "outbox-0" },
      skip: 1,
      take: 3,
    });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe("outbox-2");

    mocks.outboxFindMany.mockResolvedValueOnce([rows[2]]);
    const expiredLease = await getOutboxQueueView(actor("it_head"));
    expect(expiredLease.items[0]).toMatchObject({ availability: "not_applicable", leaseState: "expired" });
  });

  it("caps untrusted queue search text before building database filters", async () => {
    const longQuery = `  ${"x".repeat(240)}  `;
    await getOutboxQueueView(actor("it_head"), { query: longQuery });

    const query = mocks.outboxFindMany.mock.calls[0]?.[0].where.OR[0].id.contains;
    expect(query).toHaveLength(160);
    expect(query).toBe("x".repeat(160));
  });

  it("rejects non-IT actors before any queue query", async () => {
    await expect(getOutboxQueueView(actor("facility_admin"))).rejects.toThrow("unavailable");
    expect(mocks.outboxFindMany).not.toHaveBeenCalled();
  });
});
