import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const databaseIntegrationFiles = [
  "identity-governance.test.ts",
  "facility-duty-governance.integration.test.ts",
  "colony.test.ts",
  "integration-api-routes.test.ts",
  "notification-delivery.test.ts",
  "notifications-read.test.ts",
  "quarantine-read.test.ts",
  "workbook-access.test.ts",
] as const;

describe("test suite safety boundary", () => {
  it("keeps destructive database tests out of the pure unit command", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["test:unit"]).toContain("--project unit-node --project unit-dom");
    expect(packageJson.scripts["test:unit"]).not.toContain("ALLOW_DESTRUCTIVE_SEED");
    expect(packageJson.scripts["test:watch"]).not.toContain("database-integration");
    expect(packageJson.scripts["test:db"]).toContain("npm run guard:test-db");
    expect(packageJson.scripts["guard:test-db"]).toContain("assert-test-database.ts");
  });

  it("assigns every database-backed file to only the guarded project", async () => {
    const configSource = await readFile(path.join(process.cwd(), "vitest.config.ts"), "utf8");
    const databaseProjectStart = configSource.indexOf('name: "database-integration"');
    const unitProjectStart = configSource.indexOf('name: "unit-node"');
    const databaseProject = configSource.slice(databaseProjectStart, unitProjectStart);
    const unitProject = configSource.slice(unitProjectStart);

    expect(databaseProjectStart).toBeGreaterThan(-1);
    expect(unitProjectStart).toBeGreaterThan(databaseProjectStart);
    for (const fileName of databaseIntegrationFiles) {
      expect(databaseProject).toContain(fileName);
      expect(unitProject).toContain(fileName);
    }
  });

  it("guards each seeded browser-test entry point", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    for (const scriptName of [
      "test:e2e",
      "test:e2e:smoke",
      "test:e2e:wsl",
      "test:e2e:smoke:wsl",
      "verify:e2e",
      "verify:e2e:reuse",
      "verify:e2e:wsl",
      "verify:e2e:reuse:wsl",
    ]) {
      expect(packageJson.scripts[scriptName]).toContain("npm run guard:test-db");
    }

    const serverSource = await readFile(path.join(process.cwd(), "scripts/start-e2e-server.sh"), "utf8");
    expect(serverSource.indexOf("npm run guard:test-db")).toBeLessThan(serverSource.indexOf('npm run "$E2E_DB_PREPARE_SCRIPT"'));
  });

  it("uses independent disposable schemas in both CI jobs", async () => {
    const workflowSource = await readFile(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf8");

    expect(workflowSource).not.toContain("schema=public");
    expect(workflowSource).toContain("schema=mcm_test_ci");
    expect(workflowSource).toContain("schema=mcm_e2e_ci");
  });
});
