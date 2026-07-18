import { describe, expect, it } from "vitest";

import { validateBiosampleStorage, validateBiosampleTransition } from "@/lib/biosample-state-machine";

describe("biosample lifecycle", () => {
  it("allows reversible inventory work before terminal closure", () => {
    expect(validateBiosampleTransition("collected", "stored")).toBeNull();
    expect(validateBiosampleTransition("stored", "allocated")).toBeNull();
    expect(validateBiosampleTransition("allocated", "stored")).toBeNull();
    expect(validateBiosampleTransition("stored", "consumed")).toBeNull();
  });

  it("keeps consumed and discarded records terminal", () => {
    expect(validateBiosampleTransition("consumed", "stored")).toMatch(/cannot move/);
    expect(validateBiosampleTransition("discarded", "collected")).toMatch(/cannot move/);
  });

  it("requires storage for held inventory and quantity for allocation", () => {
    expect(validateBiosampleStorage({ status: "stored", storageLocation: null, quantityLabel: null })).toMatch(/storage/);
    expect(validateBiosampleStorage({ status: "allocated", storageLocation: "F1/B1/A1", quantityLabel: null })).toMatch(/quantity/);
    expect(validateBiosampleStorage({ status: "allocated", storageLocation: "F1/B1/A1", quantityLabel: "20 uL" })).toBeNull();
  });
});
