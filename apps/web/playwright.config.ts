// The browser tests (dashboard-plan.md 10): the production build served by `vite preview`, which
// sends the production Content Security Policy (dev/csp.ts), with the replay service beside it. With
// PLAYWRIGHT_BASE_URL set no server is started and that deployment is tested instead.

import { cpSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { defineConfig, devices } from "@playwright/test"

import { INGEST_PORT, INGEST_TOKEN, SIGNING_KEY } from "./e2e/env.ts"

const port = 4173
// The tree the preview serves and the service writes into: a copy of the committed demo tree, so a
// test that posts an event never writes into the repository. Only the ingest project posts.
const tree = mkdtempSync(join(tmpdir(), "cwa-e2e-tree-"))
cpSync(resolve(import.meta.dirname, "../../packages/demo-traffic/fixtures"), tree, {
  recursive: true,
})
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
  projects: [
    { name: "corpus", testMatch: /corpus\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /ingest\.spec\.ts/,
      dependencies: ["corpus"],
    },
    // After the others, since it adds an event to the tree they count.
    {
      name: "ingest",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /ingest\.spec\.ts/,
      dependencies: ["chromium"],
    },
  ],
  // The replay service (apps/ingest) beside the preview, which proxies /api to it, so the sandbox's
  // tests replay through the real assembler.
  webServer: external
    ? undefined
    : [
        {
          command: "pnpm --dir ../ingest start",
          url: `http://127.0.0.1:${INGEST_PORT}/healthz`,
          env: { PORT: String(INGEST_PORT), EVENTS_DIR: tree, INGEST_TOKEN, SIGNING_KEY },
          reuseExistingServer: !process.env["CI"],
          timeout: 60_000,
        },
        {
          command: `pnpm exec vite build && pnpm exec vite preview --port ${port} --strictPort`,
          url: `http://localhost:${port}/`,
          env: { VITE_API_TARGET: `http://127.0.0.1:${INGEST_PORT}`, VITE_DATA_DIR: tree },
          reuseExistingServer: !process.env["CI"],
          timeout: 120_000,
        },
      ],
})
