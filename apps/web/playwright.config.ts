// The browser tests (dashboard-plan.md 10): the production build served by `vite preview`, which
// sends the production Content Security Policy (dev/csp.ts), with the replay service beside it. With
// PLAYWRIGHT_BASE_URL set no server is started and that deployment is tested instead.

import { defineConfig, devices } from "@playwright/test"

const port = 4173
const ingestPort = 8091
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
  // The replay service (apps/ingest) beside the preview, which proxies /api to it, so the sandbox's
  // tests replay through the real assembler.
  webServer: external
    ? undefined
    : [
        {
          command: "pnpm --dir ../ingest start",
          url: `http://127.0.0.1:${ingestPort}/healthz`,
          env: { PORT: String(ingestPort) },
          reuseExistingServer: !process.env["CI"],
          timeout: 60_000,
        },
        {
          command: `pnpm exec vite build && pnpm exec vite preview --port ${port} --strictPort`,
          url: `http://localhost:${port}/`,
          env: { VITE_API_TARGET: `http://127.0.0.1:${ingestPort}` },
          reuseExistingServer: !process.env["CI"],
          timeout: 120_000,
        },
      ],
})
