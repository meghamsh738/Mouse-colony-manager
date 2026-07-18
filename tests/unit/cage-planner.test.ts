import { describe, expect, it } from "vitest";

import { planCageAssignments } from "@/lib/cage-planner";

const base = {
  labId: "lab-1",
  roomId: "room-1",
  rackId: "rack-1",
  startDate: "2026-07-12",
  status: "active" as const,
  chargeCategoryId: "standard",
  facilityLimit: 6,
  existingCageNumbers: ["001", "009", "not-a-number"],
};

describe("planCageAssignments", () => {
  it("is deterministic regardless of subject input order", () => {
    const subjects = [
      { id: "b", sex: "male" as const, strainId: "strain-1" },
      { id: "a", sex: "female" as const, strainId: "strain-1" },
      { id: "c", sex: "female" as const, strainId: "strain-1" },
    ];

    expect(planCageAssignments({ ...base, subjects: [...subjects].reverse() }))
      .toEqual(planCageAssignments({ ...base, subjects }));
  });

  it("separates sex and strain groups and plans to five below the hard cap of six", () => {
    const subjects = [
      ...Array.from({ length: 6 }, (_, index) => ({ id: `f-${index}`, sex: "female" as const, strainId: "s1" })),
      { id: "m-1", sex: "male" as const, strainId: "s1" },
      { id: "f-other", sex: "female" as const, strainId: "s2" },
    ];
    const result = planCageAssignments({ ...base, subjects });

    expect(result.hardLimit).toBe(6);
    expect(result.planningTarget).toBe(5);
    expect(result.cages).toHaveLength(4);
    expect(result.cages.map((cage) => cage.cageNumber)).toEqual(["010", "011", "012", "013"]);
    expect(result.assignments["f-0"]).not.toBe(result.assignments["m-1"]);
    expect(result.assignments["f-0"]).not.toBe(result.assignments["f-other"]);
  });

  it("creates one deterministic empty cage when no animals are assigned", () => {
    const result = planCageAssignments({ ...base, subjects: [] });

    expect(result.cages).toHaveLength(1);
    expect(result.cages[0]).toMatchObject({ clientId: "cage-001", cageNumber: "010" });
    expect(result.assignments).toEqual({});
  });
});
