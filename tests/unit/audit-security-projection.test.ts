import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditFindMany: vi.fn(),
  securityFindMany: vi.fn(),
  outboxGroupBy: vi.fn(),
  queueSummary: vi.fn(),
  migrationFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { findMany: mocks.auditFindMany },
    securityEvent: { findMany: mocks.securityFindMany },
    outboxMessage: { groupBy: mocks.outboxGroupBy },
    migrationRun: { findMany: mocks.migrationFindMany },
    $queryRaw: mocks.queueSummary,
  },
}));

import { getOperationalAuditHistoryView, getRecentAuditLogsView } from "@/lib/settings-read";
import { getTechnicalConsoleView } from "@/lib/system-read";
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

describe("role-projected audit and security history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditFindMany.mockResolvedValue([]);
    mocks.securityFindMany.mockResolvedValue([]);
    mocks.outboxGroupBy.mockResolvedValue([]);
    mocks.queueSummary.mockResolvedValue([]);
    mocks.migrationFindMany.mockResolvedValue([]);
  });

  it("allows Facility Admin to read operational metadata without before/after JSON", async () => {
    await expect(getRecentAuditLogsView(actor("facility_admin"))).resolves.toEqual([]);
    const select = mocks.auditFindMany.mock.calls[0]?.[0]?.select;
    const where = mocks.auditFindMany.mock.calls[0]?.[0]?.where;

    expect(select).toMatchObject({ action: true, actorRole: true, lab: { select: { code: true } } });
    expect(where).toMatchObject({ AND: [{ entityType: { notIn: ["user_invitation", "user_role", "user_access"] } }] });
    expect(select).not.toHaveProperty("previousValue");
    expect(select).not.toHaveProperty("newValue");
    await expect(getRecentAuditLogsView(actor("it_head"))).rejects.toThrow("unavailable");
  });

  it("allows only IT Head to read allowlisted security and runtime fields", async () => {
    await expect(getTechnicalConsoleView(actor("it_head"))).resolves.toEqual({
      securityEvents: [],
      securityNextCursor: null,
      outboxStatuses: [],
      queueTopics: [],
      recentWorkerRuns: [],
      recentMigrations: [],
    });
    await expect(getTechnicalConsoleView(actor("facility_admin"))).rejects.toThrow("unavailable");

    const securitySelect = mocks.securityFindMany.mock.calls[0]?.[0]?.select;
    const migrationSelect = mocks.migrationFindMany.mock.calls[0]?.[0]?.select;
    expect(securitySelect).not.toHaveProperty("metadata");
    expect(migrationSelect).not.toHaveProperty("summary");
    expect(migrationSelect).not.toHaveProperty("errorMessage");
  });

  it("paginates and filters complete operational history without exposing payload JSON", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      id: `audit-${String(index).padStart(3, "0")}`,
      action: index === 100 ? "critical_review" : "updated",
      actorRole: "facility_admin",
      entityType: "cage",
      entityId: `cage-${index}`,
      requestId: `request-${index}`,
      timestamp: new Date(2026, 0, 1, 0, 0, index),
      actor: { name: "Facility Admin" },
      lab: { code: "LAB" },
    }));
    mocks.auditFindMany.mockResolvedValueOnce(rows);

    const page = await getOperationalAuditHistoryView(actor("facility_admin"), {
      query: "critical",
      entityType: "cage",
      limit: 100,
    });
    expect(page.items).toHaveLength(100);
    expect(page.nextCursor).toBe("audit-099");
    expect(mocks.auditFindMany.mock.calls[0]?.[0]).toMatchObject({ take: 101 });
    expect(mocks.auditFindMany.mock.calls[0]?.[0]?.where.OR).toEqual(expect.arrayContaining([
      { action: { contains: "critical", mode: "insensitive" } },
    ]));
    expect(page.items[0]).not.toHaveProperty("previousValue");

    mocks.auditFindMany.mockResolvedValueOnce([]);
    await getOperationalAuditHistoryView(actor("facility_admin"), { cursor: page.nextCursor });
    expect(mocks.auditFindMany.mock.calls[1]?.[0]).toMatchObject({ cursor: { id: "audit-099" }, skip: 1 });
  });

  it("paginates security history so older critical events remain retrievable", async () => {
    const events = Array.from({ length: 101 }, (_, index) => ({
      id: `security-${String(index).padStart(3, "0")}`,
      eventType: index === 100 ? "technical.outbox.dead_lettered" : "authentication.sign_in.succeeded",
      severity: index === 100 ? "critical" : "info",
      outcome: index === 100 ? "failed" : "succeeded",
      actorRole: "it_head",
      correlationId: `request-${index}`,
      subjectType: "user",
      subjectId: `user-${index}`,
      source: "test",
      summary: `Event ${index}`,
      occurredAt: new Date(2026, 0, 1, 0, 0, index),
      actor: { name: "IT Head" },
      scopeLab: null,
    }));
    mocks.securityFindMany.mockResolvedValueOnce(events);
    const view = await getTechnicalConsoleView(actor("it_head"), { severity: "critical", limit: 100 });

    expect(view.securityEvents).toHaveLength(100);
    expect(view.securityNextCursor).toBe("security-099");
    expect(mocks.securityFindMany.mock.calls[0]?.[0]).toMatchObject({ where: { severity: "critical" }, take: 101 });
  });

  it("projects privacy-safe per-topic queue health and recent worker outcomes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    mocks.queueSummary.mockResolvedValueOnce([{
      topic: "notifications.email",
      ready: 2,
      scheduled: 3,
      retry: 1,
      active: 1,
      expired: 0,
      deadLetter: 1,
      oldestReadyAt: new Date("2026-07-17T11:55:00.000Z"),
    }]);
    mocks.securityFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "security-worker-run",
        outcome: "succeeded",
        severity: "info",
        subjectId: "notification_delivery",
        summary: "notification_delivery worker completed; claimed 2, delivered 2, failed 0, cancelled 0.",
        occurredAt: new Date("2026-07-17T11:59:00.000Z"),
      }]);

    const view = await getTechnicalConsoleView(actor("it_head"));

    expect(view.queueTopics).toEqual([expect.objectContaining({
      topic: "notifications.email",
      ready: 2,
      scheduled: 3,
      retry: 1,
      active: 1,
      expired: 0,
      deadLetter: 1,
      oldestReadyAt: "2026-07-17T11:55:00.000Z",
      oldestReadyLagSeconds: 300,
    })]);
    expect(view.recentWorkerRuns).toEqual([expect.objectContaining({
      subjectId: "notification_delivery",
      outcome: "succeeded",
      occurredAt: "2026-07-17T11:59:00.000Z",
    })]);
    vi.useRealTimers();
  });
});
