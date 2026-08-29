import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("M13 operational protocol selection", () => {
  it("requires an active named breeding authorization in UI, server action, and API", () => {
    const page = read("src/app/breeding/page.tsx");
    const action = read("src/app/breeding/actions.ts");
    const form = read("src/components/app/breeding-setup-form.tsx");
    const route = read("src/app/api/v1/breeding-setups/route.ts");

    expect(page).toContain('status: "active"');
    expect(page).toContain('procedureCode: "breeding"');
    expect(page).toContain('roleLabel: "breeding_operator"');
    expect(form).toContain('name="protocolAuthorizationId"');
    expect(form).toContain("No active breeding authorization names you");
    expect(action).toContain("protocolAuthorizationId: z.string().trim().min(1)");
    expect(action).toContain('protocolAuthorizationId: formData.get("protocolAuthorizationId")');
    expect(route).toContain("protocolAuthorizationId: z.string().trim().min(1)");
    expect(route).toContain("protocolAuthorizationId: parsed.data.protocolAuthorizationId");
  });

  it("requires independent source and destination transfer authorizations", () => {
    const readSource = read("src/lib/lab-transfer-read.ts");
    const action = read("src/app/approvals/actions.ts");
    const workflow = read("src/components/app/lab-transfer-workflow.tsx");

    expect(readSource).toContain('procedureCode: "transfer"');
    expect(readSource).toContain('roleLabel: "transfer_coordinator"');
    expect(readSource).toContain("sourceProtocols");
    expect(readSource).toContain("destinationProtocols");
    expect(action).toContain("sourceProtocolAuthorizationId: z.string().trim().min(1)");
    expect(action).toContain("destinationProtocolAuthorizationId: z.string().trim().optional()");
    expect(action).toContain('parsed.data.decision === "accept" && !parsed.data.destinationProtocolAuthorizationId');
    expect(workflow).toContain('name="sourceProtocolAuthorizationId"');
    expect(workflow).toContain('name="destinationProtocolAuthorizationId"');
    expect(workflow).toContain("No matching destination-lab transfer authorization is active");
  });

  it("preserves explicit purchase and weaning protocol selection through saved review drafts", () => {
    const readSource = read("src/lib/cage-intake-read.ts");
    const draft = read("src/lib/cage-intake-draft.ts");
    const action = read("src/app/cages/intake/actions.ts");
    const wizard = read("src/components/app/cage-intake-wizard.tsx");

    expect(readSource).toContain('procedureCode: "intake"');
    expect(readSource).toContain('roleLabel: "intake_operator"');
    expect(draft).toContain("protocolAuthorizationId: z.string().default(\"\")");
    expect(action.match(/protocolAuthorizationId: z\.string\(\)\.trim\(\)\.min\(1\)/g)).toHaveLength(2);
    expect(wizard).toContain("restored?.protocolAuthorizationId");
    expect(wizard).toContain("hasValidProtocolSelection");
    expect(wizard).toContain("No matching intake authorization is active");
    expect(wizard).toContain("protocolAuthorizationId,");
  });
});
