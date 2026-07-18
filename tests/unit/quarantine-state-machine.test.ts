import { describe, expect, it } from "vitest";

import {
  canRequestQuarantineRelease,
  isReservedQuarantineHealthAction,
  isTerminalQuarantineStatus,
  nextQuarantineStatusForObservation,
} from "@/lib/quarantine-state-machine";

describe("quarantine state machine", () => {
  it("opens and resolves exceptions explicitly", () => {
    expect(nextQuarantineStatusForObservation("admitted", "exception")).toBe("exception_open");
    expect(nextQuarantineStatusForObservation("exception_open", "clear")).toBeNull();
    expect(nextQuarantineStatusForObservation("exception_open", "exception_resolved")).toBe("under_observation");
  });

  it("keeps ordinary checks in observation and terminal states immutable", () => {
    expect(nextQuarantineStatusForObservation("admitted", "monitor")).toBe("under_observation");
    expect(nextQuarantineStatusForObservation("under_observation", "clear")).toBe("under_observation");
    expect(nextQuarantineStatusForObservation("release_requested", "monitor")).toBeNull();
    expect(isTerminalQuarantineStatus("released")).toBe(true);
  });

  it("requires elapsed holding time and a clearing observation before release request", () => {
    const minimumReleaseAt = new Date("2026-07-14T00:00:00.000Z");
    expect(canRequestQuarantineRelease({
      status: "under_observation",
      minimumReleaseAt,
      requestedAt: new Date("2026-07-13T00:00:00.000Z"),
      latestObservationResult: "clear",
      openFollowupCount: 0,
    })).toBe(false);
    expect(canRequestQuarantineRelease({
      status: "under_observation",
      minimumReleaseAt,
      requestedAt: new Date("2026-07-14T00:00:00.000Z"),
      latestObservationResult: "monitor",
      openFollowupCount: 0,
    })).toBe(false);
    expect(canRequestQuarantineRelease({
      status: "under_observation",
      minimumReleaseAt,
      requestedAt: new Date("2026-07-14T00:00:00.000Z"),
      latestObservationResult: "clear",
      openFollowupCount: 0,
    })).toBe(true);
    expect(canRequestQuarantineRelease({
      status: "under_observation",
      minimumReleaseAt,
      requestedAt: new Date("2026-07-14T00:00:00.000Z"),
      latestObservationResult: "clear",
      openFollowupCount: 1,
    })).toBe(false);
  });

  it("reserves quarantine observation provenance for the case writer", () => {
    expect(isReservedQuarantineHealthAction("Quarantine observation: clear")).toBe(true);
    expect(isReservedQuarantineHealthAction("  Quarantine observation: exception  ")).toBe(true);
    expect(isReservedQuarantineHealthAction("Routine cage check")).toBe(false);
    expect(isReservedQuarantineHealthAction(null)).toBe(false);
  });
});
