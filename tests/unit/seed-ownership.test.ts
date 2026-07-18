import { describe, expect, it } from "vitest";

import { requireExplicitSeedLabId } from "../../prisma/seed-database";
import { seedColonyData } from "../../prisma/seed-data";

describe("demo seed ownership", () => {
  const labIds = new Set(seedColonyData.labs.map((lab) => lab.id));

  it("gives every cage and animal an explicit, known owner", () => {
    expect(seedColonyData.cages.every((cage) => cage.labId && labIds.has(cage.labId))).toBe(true);
    expect(seedColonyData.animals.every((animal) => animal.owningLabId && labIds.has(animal.owningLabId))).toBe(true);
  });

  it("fails closed for missing or unknown ownership", () => {
    expect(() => requireExplicitSeedLabId(undefined, "animal", "animal-missing", labIds))
      .toThrow("Seed animal animal-missing is missing explicit lab ownership.");
    expect(() => requireExplicitSeedLabId("lab-unknown", "cage", "cage-unknown", labIds))
      .toThrow("Seed cage cage-unknown references unknown lab lab-unknown.");
  });
});
