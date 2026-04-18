import { defineConfig, devices } from "@playwright/test";

const e2eHost = process.env.E2E_HOST ?? "127.0.0.1";
const e2ePort = process.env.E2E_PORT ?? "3005";
const e2eBaseUrl = process.env.E2E_BASE_URL ?? `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "bash scripts/start-e2e-server.sh",
    url: e2eBaseUrl,
    reuseExistingServer: false,
    env: {
      ...process.env,
      E2E_HOST: e2eHost,
      E2E_PORT: e2ePort,
      E2E_BASE_URL: e2eBaseUrl,
    },
    timeout: 420_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
