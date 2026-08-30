import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    pool: "forks",
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: {
          name: "database-integration",
          environment: "node",
          include: [
            "tests/unit/identity-governance.test.ts",
            "tests/unit/facility-duty-governance.integration.test.ts",
            "tests/unit/welfare-command.integration.test.ts",
            "tests/unit/welfare-safety.integration.test.ts",
            "tests/unit/m13-weaning-command.integration.test.ts",
            "tests/unit/protocol-authorization-competency.integration.test.ts",
            "tests/unit/m13-experiment-completion.integration.test.ts",
            "tests/unit/colony.test.ts",
            "tests/unit/integration-api-routes.test.ts",
            "tests/unit/notification-delivery.test.ts",
            "tests/unit/notifications-read.test.ts",
            "tests/unit/quarantine-read.test.ts",
            "tests/unit/sop-governance-integration.test.ts",
            "tests/unit/workbook-access.test.ts",
          ],
          setupFiles: [],
          testTimeout: 45_000,
          hookTimeout: 120_000,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "unit-node",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          exclude: [
            "tests/unit/**/*.test.tsx",
            "tests/unit/identity-governance.test.ts",
            "tests/unit/facility-duty-governance.integration.test.ts",
            "tests/unit/welfare-command.integration.test.ts",
            "tests/unit/welfare-safety.integration.test.ts",
            "tests/unit/m13-weaning-command.integration.test.ts",
            "tests/unit/protocol-authorization-competency.integration.test.ts",
            "tests/unit/m13-experiment-completion.integration.test.ts",
            "tests/unit/colony.test.ts",
            "tests/unit/integration-api-routes.test.ts",
            "tests/unit/notification-delivery.test.ts",
            "tests/unit/notifications-read.test.ts",
            "tests/unit/quarantine-read.test.ts",
            "tests/unit/sop-governance-integration.test.ts",
            "tests/unit/workbook-access.test.ts",
          ],
          setupFiles: [],
          testTimeout: 45_000,
          hookTimeout: 120_000,
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: "unit-dom",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.ts"],
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
