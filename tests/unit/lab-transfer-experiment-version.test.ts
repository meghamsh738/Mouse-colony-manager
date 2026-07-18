import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(process.cwd(), "src/lib/lab-transfer-write.ts"), "utf8");

describe("lab transfer experiment override versioning", () => {
  it("advances assignment and parent experiment versions with stale-write checks", () => {
    expect(source).toContain("assignment.experiment.version");
    expect(source).toContain("tx.experiment.updateMany({");
    expect(source).toContain("where: { id: experimentId, version: experiment.version }");
    expect(source).toContain("tx.experimentAssignment.updateMany({");
    expect(source).toContain("where: { id: assignment.id, version: assignment.version, status: assignment.status }");
    expect(source.match(/version: \{ increment: 1 \}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('entityType: "experiment"');
    expect(source).toContain("cancelledAssignmentIds: experiment.assignmentIds");
  });
});
