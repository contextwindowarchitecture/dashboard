// The browser tests over the query API (ADR-0007): the same smoke, accessibility and visual specs,
// with config.json's dataRoot at /api/data, so every document comes from the ingest service's
// PostgreSQL store (PGlite, in memory) and none from a tree: the preview's own /data/ serves an
// empty directory. Setup projects post the demo tree's events, freeze the shadow corpus and deposit the demo vault's bodies. `pnpm test:e2e:api`.

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { defineConfig, devices } from "@playwright/test"

import { API_INGEST_PORT, INGEST_TOKEN, SIGNING_KEY, VAULT_TOKEN } from "./e2e/env.ts"

const port = 4176
const empty = mkdtempSync(join(tmpdir(), "cwa-e2e-empty-"))

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "seed", testMatch: /seed\.setup\.ts/ },
    // The corpus is frozen from the store's events, so after the seed.
    { name: "corpus", testMatch: /corpus\.setup\.ts/, dependencies: ["seed"] },
    { name: "vault", testMatch: /vault\.setup\.ts/ },
    {
      name: "chromium-api",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/ingest\.spec\.ts/, /seed\.setup\.ts/],
      dependencies: ["corpus", "vault"],
    },
  ],
  webServer: [
    {
      command: "pnpm --dir ../ingest start",
      url: `http://127.0.0.1:${API_INGEST_PORT}/healthz`,
      env: {
        PORT: String(API_INGEST_PORT),
        DATABASE_URL: "pglite:memory",
        INGEST_TOKEN,
        SIGNING_KEY,
        VAULT_TOKEN,
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec vite build && pnpm exec vite preview --port ${port} --strictPort`,
      url: `http://localhost:${port}/`,
      env: {
        VITE_API_TARGET: `http://127.0.0.1:${API_INGEST_PORT}`,
        VITE_DATA_ROOT: "/api/data",
        VITE_DATA_DIR: empty,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
