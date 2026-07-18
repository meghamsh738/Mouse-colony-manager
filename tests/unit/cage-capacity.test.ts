import { describe, expect, it } from "vitest";

import {
  getCageCapacityState,
  resolveEffectiveCageCapacity,
  validateCapacityOverride,
  validateFacilityCageCapacity,
} from "@/lib/cage-capacity";

describe("cage capacity", () => {
  it("uses the facility limit unless a lower cage override is configured", () => {
    expect(resolveEffectiveCageCapacity(6)).toBe(6);
    expect(resolveEffectiveCageCapacity(6, 4)).toBe(4);
    expect(resolveEffectiveCageCapacity(6, 8)).toBe(6);
  });

  it("defensively clamps facility configuration above the hard limit of six", () => {
    expect(resolveEffectiveCageCapacity(7)).toBe(6);
    expect(resolveEffectiveCageCapacity(100, 100)).toBe(6);
    expect(validateCapacityOverride(100, 7)).toContain("facility limit");
  });

  it("rejects zero, fractional, and above-six facility configuration", () => {
    expect(validateFacilityCageCapacity(0)).toContain("1 to 6");
    expect(validateFacilityCageCapacity(1.5)).toContain("whole number");
    expect(validateFacilityCageCapacity(7)).toContain("1 to 6");
    expect(validateFacilityCageCapacity(6)).toBeNull();
  });

  it("reports remaining and over-capacity state", () => {
    expect(getCageCapacityState({ facilityLimit: 6, occupantCount: 5 })).toMatchObject({
      effectiveLimit: 6,
      remainingCapacity: 1,
      isFull: false,
      isOverCapacity: false,
    });
    expect(getCageCapacityState({ facilityLimit: 6, cageOverride: 4, occupantCount: 5 })).toMatchObject({
      effectiveLimit: 4,
      remainingCapacity: 0,
      isFull: true,
      isOverCapacity: true,
    });
  });

  it("rejects overrides above the facility limit or below live occupancy", () => {
    expect(validateCapacityOverride(6, 7, 0)).toContain("facility limit");
    expect(validateCapacityOverride(6, 3, 4)).toContain("current live occupants");
    expect(validateCapacityOverride(6, 4, 4)).toBeNull();
  });
});
