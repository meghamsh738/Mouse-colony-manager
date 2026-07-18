import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const model = () => ({ findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), groupBy: vi.fn() });
  return {
    getActorLabAccess: vi.fn(),
    lab: model(),
    cageChargeCategory: model(),
    cageChargePeriod: model(),
    invoice: model(),
  };
});

vi.mock("@/lib/lab-access", () => ({ getActorLabAccess: mocks.getActorLabAccess }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lab: mocks.lab,
    cageChargeCategory: mocks.cageChargeCategory,
    cageChargePeriod: mocks.cageChargePeriod,
    invoice: mocks.invoice,
  },
}));

import { getBillingDashboardView, getBillingRatesView, getInvoiceDetailView, getInvoiceListView } from "@/lib/billing-read";
import { finalizeInvoice, generateLabInvoice, voidInvoice } from "@/lib/billing-write";

const labActor = {
  id: "user-two-labs",
  email: "staff@example.test",
  name: "Lab staff",
  role: "animal_staff" as const,
  databaseRole: "lab_user" as const,
  canonicalRole: "lab_user" as const,
  authzVersion: 1,
  activeLabId: "lab-a",
  activeMembership: { labId: "lab-a", labName: "Lab A", labCode: "A", role: "staff" as const },
  memberships: [{ labId: "lab-a", labName: "Lab A", labCode: "A", role: "staff" as const }],
  capabilities: ["billing:read"] as Array<"billing:read">,
};

describe("billing active-lab isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActorLabAccess.mockResolvedValue({
      canViewAll: false,
      memberLabIds: ["lab-a"],
      manageableLabIds: [],
      membershipByLabId: new Map(),
    });
    mocks.lab.findMany.mockResolvedValue([]);
    mocks.cageChargeCategory.findMany.mockResolvedValue([]);
    mocks.cageChargePeriod.findMany.mockResolvedValue([]);
    mocks.invoice.findMany.mockResolvedValue([]);
    mocks.invoice.groupBy.mockResolvedValue([]);
    mocks.invoice.findFirst.mockResolvedValue(null);
  });

  it("scopes dashboard rates, active periods, labs, and invoices to accessible labs", async () => {
    const view = await getBillingDashboardView(labActor);

    expect(view.canGenerateInvoices).toBe(false);
    expect(view.canManageRates).toBe(false);
    expect(view.canFinalizeInvoices).toBe(false);
    expect(mocks.lab.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true, id: { in: ["lab-a"] } },
    }));
    expect(mocks.cageChargeCategory.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { chargePeriods: { some: { labId: { in: ["lab-a"] } } } },
    }));
    expect(mocks.cageChargePeriod.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ lab: { active: true, id: { in: ["lab-a"] } } }),
    }));
    expect(mocks.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { lab: { active: true, id: { in: ["lab-a"] } } },
    }));
    expect(mocks.invoice.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { not: "void" }, lab: { active: true, id: { in: ["lab-a"] } } },
    }));
  });

  it("keeps active cage rates separated by currency and totals all non-void invoices", async () => {
    mocks.lab.findMany.mockResolvedValue([{ id: "lab-a", name: "Lab A", code: "A" }]);
    mocks.cageChargePeriod.findMany.mockResolvedValue([
      {
        id: "period-usd",
        dailyRateCents: 250,
        currencyCode: "USD",
        labId: "lab-a",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        category: { name: "Standard", code: "STD" },
        lab: { name: "Lab A", code: "A" },
        cage: {
          id: "cage-usd",
          facilityCageId: "1000",
          barcode: "CM-1000",
          cageNumber: "001",
          room: { roomNumber: "A101" },
          rack: { rackNumber: "R1" },
        },
      },
      {
        id: "period-eur",
        dailyRateCents: 300,
        currencyCode: "EUR",
        labId: "lab-a",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        category: { name: "EU service", code: "EUR" },
        lab: { name: "Lab A", code: "A" },
        cage: {
          id: "cage-eur",
          facilityCageId: "1001",
          barcode: "CM-1001",
          cageNumber: "002",
          room: { roomNumber: "A101" },
          rack: { rackNumber: "R1" },
        },
      },
    ]);
    mocks.invoice.groupBy.mockResolvedValue([
      { currencyCode: "USD", _sum: { totalCents: 25_000 } },
      { currencyCode: "EUR", _sum: { totalCents: 12_000 } },
    ]);

    const view = await getBillingDashboardView(labActor);

    expect(view.labs[0]?.activeDailyRates).toEqual([
      { currencyCode: "USD", totalCents: 250 },
      { currencyCode: "EUR", totalCents: 300 },
    ]);
    expect(view.activeInvoiceTotals).toEqual([
      { currencyCode: "USD", totalCents: 25_000 },
      { currencyCode: "EUR", totalCents: 12_000 },
    ]);
  });

  it("scopes rates and invoice lists to accessible labs", async () => {
    await Promise.all([getBillingRatesView(labActor), getInvoiceListView(labActor)]);

    expect(mocks.cageChargeCategory.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { chargePeriods: { some: { labId: { in: ["lab-a"] } } } },
    }));
    expect(mocks.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { lab: { active: true, id: { in: ["lab-a"] } } },
    }));
  });

  it("uses an ownership-scoped query for direct invoice IDs", async () => {
    expect(await getInvoiceDetailView("invoice-lab-b", labActor)).toBeNull();
    expect(mocks.invoice.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "invoice-lab-b", lab: { active: true, id: { in: ["lab-a"] } } },
    }));
  });

  it("rejects lab-user generation, finalization, and voiding before reading submitted foreign IDs", async () => {
    const identity = { idempotencyKey: "billing-lab-isolation-command", requestId: "billing-lab-isolation-request" };
    const results = await Promise.all([
      generateLabInvoice({ ...identity, labId: "lab-b", periodStart: "2026-04-01", periodEnd: "2026-05-01" }, labActor),
      finalizeInvoice({ ...identity, invoiceId: "invoice-lab-b", labId: "lab-b", expectedVersion: 1 }, labActor),
      voidInvoice({ ...identity, invoiceId: "invoice-lab-b", labId: "lab-b", expectedVersion: 1, reason: "foreign" }, labActor),
    ]);

    expect(results.every((result) => !result.ok)).toBe(true);
    expect(mocks.invoice.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a future service window before entering a billing command", async () => {
    const result = await generateLabInvoice({
      idempotencyKey: "billing-future-command",
      requestId: "billing-future-request",
      labId: "lab-a",
      periodStart: "2099-04-01",
      periodEnd: "2099-05-01",
    }, { ...labActor, capabilities: ["billing:read", "billing:generate"] });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("completed service period");
  });
});
