import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actions = readFileSync("src/app/reconciliation/actions.ts", "utf8");
const page = readFileSync("src/app/reconciliation/page.tsx", "utf8");
const workbench = readFileSync("src/components/app/reconciliation-workbench.tsx", "utf8");

describe("M16 operational reconciliation UI", () => {
  it("redirects only committed commands to a bounded notice code", () => {
    expect(actions).toContain('if (!result.ok) return { status: "error"');
    expect(actions).toContain('redirect("/reconciliation?notice=evidence-saved")');
    expect(actions).not.toContain("encodeURIComponent");
    expect(page).toContain('"evidence-saved"');
    expect(page).toContain("params.notice in notices");
    expect(page).toContain('data-testid="reconciliation-notice"');
  });

  it("states the independent veterinary and empty-quarantine-cage boundaries", () => {
    expect(workbench).toContain("pre-existing empty quarantine cage");
    expect(workbench).toContain("Record independent veterinary decision");
    expect(workbench).toContain("You cannot certify evidence that you recorded");
  });
});
