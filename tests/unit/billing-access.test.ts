import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoiceFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: {
      findUnique: mocks.invoiceFindUnique,
    },
  },
}));

import { finalizeInvoice, generateLabInvoice } from "@/lib/billing-write";

const labManager = {
  id: "user-lab-manager",
  email: "manager@example.test",
  name: "Lab manager",
  role: "animal_staff" as const,
  databaseRole: "lab_user" as const,
  canonicalRole: "lab_user" as const,
  authzVersion: 1,
  activeLabId: "lab-a",
  activeMembership: { labId: "lab-a", labName: "Lab A", labCode: "A", role: "manager" as const },
  memberships: [{ labId: "lab-a", labName: "Lab A", labCode: "A", role: "manager" as const }],
  capabilities: [],
};

describe("billing mutation authorization", () => {
  beforeEach(() => {
    mocks.invoiceFindUnique.mockReset();
  });

  it("rejects invoice generation for lab users before reading billing records", async () => {
    const result = await generateLabInvoice(
      {
        labId: "lab-a",
        periodStart: "2026-07-01",
        periodEnd: "2026-08-01",
        idempotencyKey: "billing-access-generate",
        requestId: "billing-access-generate-request",
      },
      labManager,
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("permission");
    expect(mocks.invoiceFindUnique).not.toHaveBeenCalled();
  });

  it("rejects invoice finalization for lab users before resolving a direct invoice id", async () => {
    const result = await finalizeInvoice({
      invoiceId: "foreign-invoice",
      labId: "lab-b",
      expectedVersion: 1,
      idempotencyKey: "billing-access-finalize",
      requestId: "billing-access-finalize-request",
    }, labManager);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("permission");
    expect(mocks.invoiceFindUnique).not.toHaveBeenCalled();
  });
});
