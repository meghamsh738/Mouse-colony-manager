import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://localhost:3005",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "AUTH_URL=http://localhost:3005 NEXTAUTH_URL=http://localhost:3005 npm run db:seed && npm run build && AUTH_URL=http://localhost:3005 NEXTAUTH_URL=http://localhost:3005 npx next start --hostname 127.0.0.1 --port 3005",
    url: "http://localhost:3005",
    reuseExistingServer: false,
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
