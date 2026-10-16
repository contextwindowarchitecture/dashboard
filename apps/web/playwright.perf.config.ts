// The performance tests (dashboard-plan.md 11, DP-7): the production build over a generated tree of
// 50,000 events and the long content (a 400-row trace, a 60-turn session), with the replay service
// beside it, measured against the plan's budgets. `pnpm --filter web test:perf`; it generates the tree
// into the system's temporary directory first, which takes a minute.

import { resolve } from "node:path"

import { defineConfig, devices } from "@playwright/test"

import { INGEST_PORT, PERF_TREE } from "./e2e/env.ts"

const port = 4174
const generator = resolve(import.meta.dirname, "../../packages/demo-traffic/src/generate.ts")

export default defineConfig({
  testDir: "./e2e-perf",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 120_000,
  use: { baseURL: `http://localhost:${port}`, ...devices["Desktop Chrome"] },
  webServer: [
    {
      command: "pnpm --dir ../ingest start",
      url: `http://127.0.0.1:${INGEST_PORT}/healthz`,
      env: { PORT: String(INGEST_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `node ${generator} --events 50000 --long --out ${PERF_TREE} && pnpm exec vite build && pnpm exec vite preview --port ${port} --strictPort`,
      url: `http://localhost:${port}/`,
      env: { VITE_DATA_DIR: PERF_TREE, VITE_API_TARGET: `http://127.0.0.1:${INGEST_PORT}` },
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
})
