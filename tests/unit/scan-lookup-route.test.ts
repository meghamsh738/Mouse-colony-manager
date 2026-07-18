import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { GET } from "@/app/scan/lookup/route";

vi.mock("@/lib/api-route", () => ({
  requireApiUser: vi.fn(async () => ({
    user: { id: "user-admin", role: "admin", activeLabId: null },
  })),
}));
vi.mock("@/lib/integration-api", () => ({
  resolveCageByApiReference: vi.fn(async (input: { cageBarcode?: string }) => ({
    ok: true,
    value: { cageId: "cage-a101-003", cageBarcode: input.cageBarcode, labId: "lab-microglia" },
  })),
}));

describe("scan lookup route", () => {
  it("normalizes wildcard dev hosts before redirecting the browser", async () => {
    const response = await GET(new NextRequest("http://0.0.0.0:3005/scan/lookup?barcode=CM-A101-003"));

    expect(response.headers.get("location")).toBe("http://localhost:3005/scan/CM-A101-003");
  });

  it("keeps empty lookups on the scan workspace", async () => {
    const response = await GET(new NextRequest("http://0.0.0.0:3005/scan/lookup"));

    expect(response.headers.get("location")).toBe("http://localhost:3005/scan");
  });
});
