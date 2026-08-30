import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/welfare/page.tsx", "utf8");
const form = readFileSync("src/components/app/welfare-command-form.tsx", "utf8");

describe("M14 welfare workspace UI contract", () => {
  it("uses one authoritative subject selection with the stored subject version", () => {
    expect(form).toContain('data-testid="welfare-subject-picker"');
    expect(form).toContain('name="subjectType"');
    expect(form).toContain('value={selection?.type ?? ""}');
    expect(form).toContain('name="expectedSubjectVersion"');
    expect(form).toContain('value={selection?.version ?? ""}');
    expect(page).not.toContain('defaultValue="1"');
  });

  it("keeps private clinical and treatment projections behind veterinarian access", () => {
    expect(page).toContain('veterinarian && "privateClinicalSummary" in welfareCase');
    expect(page).toContain('data-testid="welfare-private-clinical"');
    expect(page).toContain('veterinarian && "treatmentOrders" in welfareCase');
    expect(page).toContain('data-testid="welfare-treatment-order"');
  });

  it("exposes stable workspace hooks and the visible fail-closed policy marker", () => {
    expect(page).toContain('data-testid="welfare-workspace"');
    expect(page).toContain('data-testid="welfare-policy-marker"');
    expect(page).toContain('data-testid="welfare-case-card"');
    expect(page).toContain("view.policyMarker");
  });
});
