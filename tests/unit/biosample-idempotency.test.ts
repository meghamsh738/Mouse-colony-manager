import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { biosampleReplayMatches, buildBiosampleReplaySnapshot } from "@/lib/biosample-idempotency";

const base = {
  animalId: "animal-1",
  labId: "lab-a",
  projectRef: "project-a",
  experimentId: null,
  sampleLabel: " DNA-0001 ",
  sampleType: " Tail DNA ",
  status: "stored",
  collectedAt: "2026-07-01",
  storageLocation: " Freezer A / Box 1 / A01 ",
  quantityLabel: " 40 uL ",
  notes: " Retained aliquot ",
};

describe("biosample replay equivalence", () => {
  it("normalizes harmless whitespace and date representation", () => {
    expect(biosampleReplayMatches(base, {
      ...base,
      sampleLabel: "DNA-0001",
      sampleType: "Tail DNA",
      collectedAt: new Date("2026-07-01T00:00:00.000Z"),
      storageLocation: "Freezer A / Box 1 / A01",
      quantityLabel: "40 uL",
      notes: "Retained aliquot",
    })).toBe(true);
  });

  it.each([
    ["animal", { animalId: "animal-2" }],
    ["lab", { labId: "lab-b" }],
    ["project", { projectRef: "project-b" }],
    ["experiment", { experimentId: "experiment-2" }],
    ["type", { sampleType: "Serum" }],
    ["status", { status: "allocated" }],
    ["date", { collectedAt: "2026-07-02" }],
    ["storage", { storageLocation: "Freezer B" }],
    ["quantity", { quantityLabel: "20 uL" }],
    ["notes", { notes: "Different provenance" }],
  ])("rejects replay when %s differs", (_label, changed) => {
    expect(biosampleReplayMatches(base, { ...base, ...changed })).toBe(false);
  });

  it("uses a matching experiment as provenance even when the project was implicit", () => {
    const withExperiment = { ...base, projectRef: null, experimentId: "experiment-1" };
    expect(buildBiosampleReplaySnapshot(withExperiment).provenance).toBe("experiment:experiment-1");
    expect(biosampleReplayMatches(withExperiment, { ...withExperiment, projectRef: "project-a" })).toBe(true);
  });

  it("guards both API preflight and concurrent unique-constraint fallback", () => {
    const route = readFileSync(path.resolve(process.cwd(), "src/app/api/v1/samples/route.ts"), "utf8");
    const write = readFileSync(path.resolve(process.cwd(), "src/lib/colony-write.ts"), "utf8");
    expect(route).toContain("biosampleReplayMatches(");
    expect(route).toContain("different inventory or provenance data");
    expect(write).toContain("biosampleReplayMatches(");
    expect(write).toContain('error.code === "P2002"');
  });
});
