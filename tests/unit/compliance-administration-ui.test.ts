import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { navigationRegistry } from "@/lib/navigation";

const root = process.cwd();
const page = fs.readFileSync(path.join(root, "src/app/administration/compliance/page.tsx"), "utf8");
const actions = fs.readFileSync(path.join(root, "src/app/administration/compliance/actions.ts"), "utf8");
const workspace = fs.readFileSync(path.join(root, "src/components/app/compliance-admin-workspace.tsx"), "utf8");

describe("M13 compliance administration UI", () => {
  it("authenticates the shared page and authorizes every mutation independently", () => {
    expect(page).toContain('requireUser({ capability: "dashboard:view" })');
    expect(actions).toContain('requireUser({ capability: "protocols:draft" })');
    expect(actions).toContain('requireUser({ capability: "protocols:approve" })');
    expect(actions.match(/requireUser\(\{ capability: "competencies:manage" \}\)/g)).toHaveLength(2);
    expect(actions).toContain("actor.activeLabId");
    expect(page).not.toMatch(/export async function .*Action/);
  });

  it("exposes only governance metadata and states the synthetic privacy boundary", () => {
    expect(workspace).toContain("Synthetic policy");
    expect(workspace).toContain("Local qualification only");
    expect(workspace).toContain("never animal-level records");
    expect(workspace).toContain("Independent review is enforced");
    expect(workspace).toContain("A different protocol reviewer must decide this authorization");
    expect(workspace).toContain("A different training administrator must govern your evidence");
    expect(page).not.toMatch(/animal\.(?:barcode|dateOfBirth|genotype)/);
  });

  it("supports draft, protocol decision, competency issue, renewal, revocation, and expiry forms", () => {
    for (const testId of [
      "protocol-draft-form",
      "protocol-decision-",
      "competency-issue-form",
      "competency-renew-",
      "competency-transition-",
    ]) expect(workspace).toContain(testId);
    expect(workspace).toContain('<option value="expired">Expired</option>');
    expect(workspace).toContain('<option value="revoked">Revoked</option>');
  });

  it("adds the responsive workspace to authenticated navigation", () => {
    expect(navigationRegistry).toContainEqual(expect.objectContaining({
      id: "compliance",
      href: "/administration/compliance",
      label: "Protocol compliance",
      group: "Administration",
    }));
    expect(workspace).toContain('className="grid gap-3 p-4 xl:grid-cols-2"');
  });
});
