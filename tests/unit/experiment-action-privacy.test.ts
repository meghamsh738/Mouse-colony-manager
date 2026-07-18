import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("experiment planner assignment action", () => {
  it("submits the rendered snapshot instead of recomputing the planner in a server action", async () => {
    const actions = await readFile(path.join(process.cwd(), "src/app/experiments/actions.ts"), "utf8");
    const form = await readFile(path.join(process.cwd(), "src/components/app/experiment-plan-save-form.tsx"), "utf8");

    expect(actions).toContain('assignments: parseJsonField(formData.get("assignmentsJson"))');
    expect(actions).not.toContain("getExperimentPlannerView");
    expect(actions).not.toContain("parseExperimentPlannerFilters");
    expect(form).toContain('name="assignmentsJson"');
    expect(form).toContain("JSON.stringify(assignments)");
  });
});
