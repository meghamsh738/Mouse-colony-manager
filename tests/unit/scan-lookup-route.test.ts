import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET } from "@/app/scan/lookup/route";

describe("scan lookup route", () => {
  it("normalizes wildcard dev hosts before redirecting the browser", () => {
    const response = GET(new NextRequest("http://0.0.0.0:3005/scan/lookup?barcode=CM-A101-003"));

    expect(response.headers.get("location")).toBe("http://localhost:3005/scan/CM-A101-003");
  });

  it("keeps empty lookups on the scan workspace", () => {
    const response = GET(new NextRequest("http://0.0.0.0:3005/scan/lookup"));

    expect(response.headers.get("location")).toBe("http://localhost:3005/scan");
  });
});
