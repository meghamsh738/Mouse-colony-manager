import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/corrections/page.tsx", "utf8");
const form = readFileSync("src/components/app/correction-command-form.tsx", "utf8");
const actions = readFileSync("src/app/corrections/actions.ts", "utf8");

describe("M15 corrections workspace UI", () => {
  it("states that metadata supersession is not physical reversal", () => {
    expect(page).toContain("This workflow does not reverse a physical action");
    expect(page).toContain("A blocked request is never an applied correction");
    expect(form).toContain("Physical moves, custody, generated weaning records, euthanasia/status reversals");
  });

  it("exposes stable requester, review, block, projection, and reconciliation hooks", () => {
    for (const hook of ["correction-workspace", "correction-request-form", "correction-target-picker", "correction-card", "correction-block-code", "correction-effective-projection", "correction-reconciliation"]) {
      expect(`${page}\n${form}`).toContain(hook);
    }
  });

  it("derives target identity and source time from an authorized server-provided selection", () => {
    expect(form).toContain('name="targetEntityId" type="hidden"');
    expect(form).toContain('name="sourceEventAt" type="hidden"');
    expect(form).toContain("server reloads its evidence before saving");
  });

  it("redirects successful commands with bounded notice codes only", () => {
    for (const code of ["request-blocked", "request-submitted", "supersession-applied", "request-rejected"]) {
      expect(actions).toContain(`/corrections?notice=${code}`);
      expect(page).toContain(`"${code}"`);
    }
    expect(actions).not.toContain("encodeURIComponent");
    expect(page).toContain("params.notice in notices");
    expect(page).toContain('data-testid="correction-notice"');
  });
});
