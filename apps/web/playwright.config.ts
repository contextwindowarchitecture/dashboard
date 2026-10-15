// The browser tests (dashboard-plan.md 10): the production build served by `vite preview`, which
// sends the production Content Security Policy (dev/csp.ts). With PLAYWRIGHT_BASE_URL set no
// server is started and that deployment is tested instead.

import { defineConfig, devices } from "@playwright/test"

const port = 4173
const external = process.env["PLAYWRIGHT_BASE_URL"]

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: external ?? `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: external
    ? undefined
    : {
        command: `pnpm exec vite build && pnpm exec vite preview --port ${port} --strictPort`,
        url: `http://localhost:${port}/`,
        reuseExistingServer: !process.env["CI"],
        timeout: 120_000,
      },
})
