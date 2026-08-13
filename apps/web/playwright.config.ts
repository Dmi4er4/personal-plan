import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: "line",
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:8787",
    serviceWorkers: "allow",
    timezoneId: "Europe/Minsk",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --dir ../relay dev",
    reuseExistingServer: true,
    timeout: 120_000,
    url: "http://127.0.0.1:8787",
  },
  workers: 1,
});
