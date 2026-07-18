import { describe, expect, it } from "vitest";

import {
  getAllowedBreedingTransitions,
  isTerminalBreedingStatus,
  validateBreedingTransition,
} from "@/lib/breeding-state-machine";

describe("breeding state machine", () => {
  it("allows pause, resume, and terminal transitions while terminal states remain final", () => {
    expect(getAllowedBreedingTransitions("active")).toEqual(["paused", "failed", "retired"]);
    expect(getAllowedBreedingTransitions("paused")).toContain("active");
    expect(getAllowedBreedingTransitions("retired")).toEqual([]);
    expect(isTerminalBreedingStatus("failed")).toBe(true);
  });

  it("rejects illegal, backdated, and unexplained transitions", () => {
    const base = {
      fromStatus: "active" as const,
      toStatus: "paused" as const,
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      happenedAt: new Date("2026-07-12T00:00:00.000Z"),
      reason: "Temporary pairing pause",
      now: new Date("2026-07-12T12:00:00.000Z"),
    };

    expect(validateBreedingTransition(base)).toBeNull();
    expect(validateBreedingTransition({ ...base, toStatus: "planned" })).toContain("cannot move");
    expect(validateBreedingTransition({ ...base, happenedAt: new Date("2026-06-30") })).toContain("earlier");
    expect(validateBreedingTransition({ ...base, happenedAt: new Date("2026-07-13") })).toContain("future");
    expect(
      validateBreedingTransition({
        ...base,
        happenedAt: new Date("2026-07-10"),
        latestEffectiveDate: new Date("2026-07-11"),
      }),
    ).toContain("latest breeding status change");
    expect(
      validateBreedingTransition({
        ...base,
        happenedAt: new Date("2026-07-10"),
        latestLitterDate: new Date("2026-07-11"),
      }),
    ).toContain("latest recorded litter");
    expect(validateBreedingTransition({ ...base, reason: "x" })).toContain("clear reason");
  });
});
