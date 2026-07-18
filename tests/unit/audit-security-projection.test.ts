import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditFindMany: vi.fn(),
  securityFindMany: vi.fn(),
  outboxGroupBy: vi.fn(),
  migrationFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { findMany: mocks.auditFindMany },
    securityEvent: { findMany: mocks.securityFindMany },
    outboxMessage: { groupBy: mocks.outboxGroupBy },
    migrationRun: { findMany: mocks.migrationFindMany },
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
});
