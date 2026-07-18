import { describe, expect, it } from "vitest";

import { parseCageIntakeDate } from "@/lib/cage-intake-write";

describe("cage intake date boundaries", () => {
  it("normalizes a valid date-only value to UTC midnight", () => {
    const parsed = parseCageIntakeDate("2026-05-01", "cage start date");

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.date.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it.each([
    "2026-05-01T12:00:00.000Z",
    "2026-02-30",
    "05/01/2026",
    "",
  ])("rejects non-date-only or impossible input %s", (value) => {
    const parsed = parseCageIntakeDate(value, "cage start date");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain("valid cage start date");
  });
});
