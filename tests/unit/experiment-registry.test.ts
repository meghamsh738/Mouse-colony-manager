import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { canTransitionExperimentStatus } from "@/lib/experiments-write";

const writeSource = fs.readFileSync(path.resolve(process.cwd(), "src/lib/experiments-write.ts"), "utf8");
const actionSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/experiments/actions.ts"), "utf8");
const registrySource = fs.readFileSync(path.resolve(process.cwd(), "src/components/app/experiment-registry.tsx"), "utf8");
const pageSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/experiments/page.tsx"), "utf8");

describe("experiment registry lifecycle", () => {
  it("allows only the bounded forward lifecycle transitions", () => {
    expect(canTransitionExperimentStatus("planned", "active")).toBe(true);
    expect(canTransitionExperimentStatus("planned", "cancelled")).toBe(true);
    expect(canTransitionExperimentStatus("active", "completed")).toBe(true);
    expect(canTransitionExperimentStatus("active", "cancelled")).toBe(true);
    expect(canTransitionExperimentStatus("active", "planned")).toBe(false);
    expect(canTransitionExperimentStatus("completed", "active")).toBe(false);
    expect(canTransitionExperimentStatus("cancelled", "planned")).toBe(false);
  });

  it("uses actor-aware idempotent, audited, versioned commands", () => {
    expect(writeSource.match(/executeIdempotentCommand\(\{/g)).toHaveLength(3);
    expect(writeSource.match(/requiredCapability: "experiments:manage"/g)).toHaveLength(3);
    expect(writeSource).toContain('aggregateType: "experiment"');
    expect(writeSource).toContain("expectedVersion: input.expectedVersion");
    expect(writeSource).toContain('entityType: "experiment"');
    expect(writeSource).toContain('version: { increment: 1 }');
    expect(writeSource).toMatch(/role === "facility_admin" \|\| \(\s*role === "lab_user"/);
    expect(writeSource).toContain('["owner", "manager", "staff"]');
    expect(writeSource).toContain("id: command.projectId, labId: command.labId");
    expect(writeSource).toContain("id: command.projectId, labId: experiment.labId");
  });

  it("requires experiment management authority in every mutating server action", () => {
    expect(actionSource.match(/requireUser\(\{ capability: "experiments:manage" \}\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(actionSource).toContain("executeCreateExperimentCommand");
    expect(actionSource).toContain("executeUpdateExperimentCommand");
    expect(actionSource).toContain("executeTransitionExperimentCommand");
    expect(actionSource).toContain("planExperimentCohortAction");
    expect(actionSource).toContain("promotePlannedCohortAction");
    expect(actionSource).toContain("demoteReservedCohortAction");
  });

  it("submits operational and private fields with command identity and expected versions", () => {
    for (const field of [
      "plannedStartAt",
      "plannedEndAt",
      "operationalContact",
      "procedureSummary",
      "treatmentSummary",
      "welfareRisks",
      "scheduleNotes",
      "operationalNotes",
      "notes",
      "resultSummary",
    ]) {
      expect(registrySource).toContain(`name="${field}"`);
      expect(actionSource).toContain(`formData.get("${field}")`);
    }
    expect(registrySource).toContain('name="idempotencyKey"');
    expect(registrySource).toContain('name="requestId"');
    expect(registrySource).toContain('name="expectedVersion"');
  });

  it("wires the full registry above the planner while retaining the operational worksheet branch", () => {
    expect(pageSource.indexOf("<ExperimentRegistry")).toBeLessThan(pageSource.indexOf("<ExperimentsWorksheet"));
    expect(pageSource).toContain("<OperationalExperimentsWorksheet overview={overview} />");
  });
});
