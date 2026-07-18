import { describe, expect, it } from "vitest";

import { parseExactLifecycleTimestamp, parseExternalTransferProvenance } from "@/lib/lifecycle-provenance";

describe("exact lifecycle timestamps", () => {
  it("accepts timezone-qualified instants and preserves their exact time", () => {
    expect(parseExactLifecycleTimestamp("2026-07-16T15:42:12.125+01:00")?.toISOString())
      .toBe("2026-07-16T14:42:12.125Z");
    expect(parseExactLifecycleTimestamp("2026-07-16T14:42Z")?.toISOString())
      .toBe("2026-07-16T14:42:00.000Z");
  });

  it("rejects date-only, timezone-free, and normalized invalid calendar values", () => {
    expect(parseExactLifecycleTimestamp("2026-07-16")).toBeNull();
    expect(parseExactLifecycleTimestamp("2026-07-16T15:42")).toBeNull();
    expect(parseExactLifecycleTimestamp("2026-02-30T15:42:00Z")).toBeNull();
    expect(parseExactLifecycleTimestamp("2026-07-16T24:00:00Z")).toBeNull();
    expect(parseExactLifecycleTimestamp("2026-07-16T15:42:00+14:01")).toBeNull();
  });
});

describe("external transfer provenance", () => {
  it("projects the immutable lifecycle audit fields", () => {
    expect(parseExternalTransferProvenance({
      status: "transferred_out",
      destination: "External Facility",
      transferReference: "EXT-001",
      happenedAt: "2026-07-13",
      reason: "Transferred after review.",
    })).toEqual({
      destination: "External Facility",
      reference: "EXT-001",
      happenedAt: "2026-07-13",
      reason: "Transferred after review.",
    });
  });

  it("fails closed for incomplete or non-transfer audit payloads", () => {
    expect(parseExternalTransferProvenance(null)).toBeNull();
    expect(parseExternalTransferProvenance({ status: "dead", destination: "External Facility" })).toBeNull();
    expect(parseExternalTransferProvenance({
      status: "transferred_out",
      destination: "",
      happenedAt: "2026-07-13",
      reason: "Transferred after review.",
    })).toBeNull();
  });
});
