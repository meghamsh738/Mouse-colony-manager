import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditFindMany: vi.fn(),
  securityFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { findMany: mocks.auditFindMany },
    securityEvent: { findMany: mocks.securityFindMany },
  },
}));

vi.mock("@/lib/integration-api", () => ({
  getAnimalApiList: vi.fn(),
  getCageApiList: vi.fn(),
}));

vi.mock("@/lib/lab-access", () => ({
  getActorLabAccess: vi.fn(),
}));

import {
  assertPrivilegedExportRowCount,
  buildCsvExport,
  CsvExportLimitError,
  escapeCsvCell,
  toCsv,
  validatePrivilegedExportRange,
} from "@/lib/export-csv";

const actor = { id: "user-it-head", role: "it_head" } as const;
const filters = { from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T00:00:00.000Z" };
const auditRow = {
  action: "updated",
  actorRole: "facility_admin",
  entityType: "cage",
  entityId: "cage-1",
  requestId: "request-1",
  timestamp: new Date("2026-01-15T00:00:00.000Z"),
  actor: { name: "Facility Admin" },
  lab: { code: "LAB" },
};
const securityRow = {
  eventType: "authentication.sign_in.succeeded",
  severity: "info",
  outcome: "succeeded",
  actorRole: "it_head",
  correlationId: "request-1",
  subjectType: "user",
  subjectId: "user-1",
  source: "auth",
  summary: "Sign-in succeeded",
  occurredAt: new Date("2026-01-15T00:00:00.000Z"),
  actor: { name: "IT Head" },
  scopeLab: { code: "LAB" },
};

const privilegedExports = [
  {
    entity: "audit",
    findMany: mocks.auditFindMany,
    row: auditRow,
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    header: "action,actor,actorRole,entityType,entityId,lab,requestId,occurredAt",
  },
  {
    entity: "security",
    findMany: mocks.securityFindMany,
    row: securityRow,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    header: "eventType,severity,outcome,summary,source,actor,actorRole,subject,scope,correlationId,occurredAt",
  },
] as const;

describe("privileged CSV export safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditFindMany.mockResolvedValue([]);
    mocks.securityFindMany.mockResolvedValue([]);
  });

  it.each([
    "=HYPERLINK(\"https://example.test\")",
    "+cmd|' /C calc'!A0",
    "-2+3",
    "@SUM(A1:A2)",
    " \t=SUM(A1:A2)",
    "\r\n+SUM(A1:A2)",
  ])("neutralizes formula-leading text %j", (value) => {
    expect(escapeCsvCell(value)).toBe(`"'${value.replaceAll('"', '""')}"`);
  });

  it("keeps numeric cells numeric while escaping quotes in ordinary text", () => {
    expect(escapeCsvCell(-25)).toBe('"-25"');
    expect(toCsv([{ label: 'Cage "A"', amount: -25 }])).toBe('label,amount\n"Cage ""A""","-25"');
  });

  it("requires a valid export window no longer than 31 days", () => {
    expect(() => validatePrivilegedExportRange({})).toThrow("require explicit from and to");
    expect(() => validatePrivilegedExportRange({ from: "2026-01-02", to: "2026-01-01" })).toThrow("invalid");
    expect(() => validatePrivilegedExportRange({ from: "2026-01-01", to: "2026-02-02" })).toThrow("31-day");
    expect(validatePrivilegedExportRange({ from: "2026-01-01", to: "2026-01-31" })).toMatchObject({
      from: new Date("2026-01-01"),
      to: new Date("2026-01-31"),
    });
  });

  it("enforces the exact privileged export row-count boundary", () => {
    expect(() => assertPrivilegedExportRowCount(50_000)).not.toThrow();
    expect(() => assertPrivilegedExportRowCount(50_001)).toThrow("Narrow the date range");
  });

  it.each(privilegedExports)("returns exactly 50,000 $entity rows from one bounded ordered read", async ({
    entity,
    findMany,
    row,
    orderBy,
    header,
  }) => {
    findMany.mockResolvedValueOnce(Array(50_000).fill(row));

    const csv = await buildCsvExport(entity, actor, filters);

    expect(csv?.split("\n")).toHaveLength(50_001);
    expect(csv?.split("\n", 1)[0]).toBe(header);
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50_001, orderBy }));
  });

  it.each(privilegedExports)("rejects $entity export when the bounded read finds row 50,001", async ({
    entity,
    findMany,
    row,
    orderBy,
  }) => {
    findMany.mockResolvedValueOnce(Array(50_001).fill(row));

    await expect(buildCsvExport(entity, actor, filters)).rejects.toBeInstanceOf(CsvExportLimitError);
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50_001, orderBy }));
  });
});
