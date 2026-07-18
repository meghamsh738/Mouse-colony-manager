import { describe, expect, it } from "vitest";

import { validateProjectedSexComposition, validateQuarantineAssignments } from "@/lib/cage-assignment-rules";

const active = {
  key: "existing:active",
  label: "CMU-1001",
  status: "active" as const,
  occupants: [{ id: "female-1", sex: "female" as const }],
};

describe("cage assignment rules", () => {
  it("blocks projected mixed-sex holding but permits a breeding cage", () => {
    expect(validateProjectedSexComposition({
      destinations: [active],
      incoming: [{ subjectId: "male-1", sex: "male", destinationKey: active.key }],
      mixedSexHoldingAllowed: false,
    })).toContain("cannot hold both male and female");

    expect(validateProjectedSexComposition({
      destinations: [{ ...active, status: "breeding" }],
      incoming: [{ subjectId: "male-1", sex: "male", destinationKey: active.key }],
      mixedSexHoldingAllowed: false,
    })).toBeNull();
  });

  it("accounts for animals moving out before validating the destination", () => {
    expect(validateProjectedSexComposition({
      destinations: [active],
      incoming: [{ subjectId: "male-1", sex: "male", destinationKey: active.key }],
      outgoingSubjectIds: new Set(["female-1"]),
      mixedSexHoldingAllowed: false,
    })).toBeNull();
  });

  it("reserves quarantine cages for quarantine purchase intake", () => {
    const quarantine = { ...active, key: "new:q", status: "quarantine" as const, occupants: [] };
    const usedDestinationKeys = new Set([quarantine.key]);

    expect(validateQuarantineAssignments({
      workflow: "wean",
      destinations: [quarantine],
      usedDestinationKeys,
    })).toContain("quarantine intake workflow");
    expect(validateQuarantineAssignments({
      workflow: "purchase",
      disposition: "quarantine",
      destinations: [quarantine],
      usedDestinationKeys,
    })).toBeNull();
    expect(validateQuarantineAssignments({
      workflow: "purchase",
      disposition: "quarantine",
      destinations: [active],
      usedDestinationKeys: new Set([active.key]),
    })).toContain("must be a quarantine cage");
  });
});
