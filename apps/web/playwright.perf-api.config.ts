// The performance tests over the query API (DP-14, ADR-0007): the same budgets as
// playwright.perf.config.ts, with every document read from PostgreSQL (PGlite in a fresh directory)
// through the ingest service, as the production overlay serves them. The generated tree of 50,000
// events and the long content is posted through POST /events by a setup project first, as wrappers
// would, which takes a couple of minutes, and half of them into a second tenant. Readers sign in
// through the test issuer, and e2e-perf/access.json checks every read. `pnpm --filter web test:perf:api`.

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { defineConfig, devices } from "@playwright/test"

import { API_INGEST_PORT, INGEST_TOKEN, OIDC_TEST, PERF_TREE } from "./e2e/env.ts"

const port = 4177
const generator = resolve(import.meta.dirname, "../../packages/demo-traffic/src/generate.ts")
const database = mkdtempSync(join(tmpdir(), "cwa-perf-pglite-"))
const empty = mkdtempSync(join(tmpdir(), "cwa-perf-empty-"))

export default defineConfig({
  testDir: "./e2e-perf",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 120_000,
  use: { baseURL: `http://localhost:${port}`, ...devices["Desktop Chrome"] },
  projects: [
    { name: "seed-perf", testMatch: /seed\.setup\.ts/, timeout: 900_000 },
    { name: "perf-api", testIgnore: /seed\.setup\.ts/, dependencies: ["seed-perf"] },
  ],
  webServer: [
    // The test issuer (apps/ingest/test/oidc-issuer.ts): a reader signs in, a member of cwa:owners.
    {
      command: "node ../ingest/test/oidc-issuer-main.ts",
      url: `http://127.0.0.1:${OIDC_TEST.port}/.well-known/openid-configuration`,
      env: {
        OIDC_TEST_PORT: String(OIDC_TEST.port),
        OIDC_TEST_CLIENT_ID: OIDC_TEST.clientId,
        OIDC_TEST_CLIENT_SECRET: OIDC_TEST.clientSecret,
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "pnpm --dir ../ingest start",
      url: `http://127.0.0.1:${API_INGEST_PORT}/healthz`,
      env: {
        PORT: String(API_INGEST_PORT),
        DATABASE_URL: `pglite:${database}`,
        INGEST_TOKEN,
        // Sessions and roles (ADR-0010, ADR-0011): every read checked against the reader's roles,
        // an anonymous reader's bodies withheld, a signed-in owner's served.
        OIDC_ISSUER: `http://127.0.0.1:${OIDC_TEST.port}`,
        OIDC_CLIENT_ID: OIDC_TEST.clientId,
        OIDC_CLIENT_SECRET: OIDC_TEST.clientSecret,
        OIDC_REDIRECT_URI: `http://localhost:${port}/api/auth/callback`,
        ACCESS_FILE: resolve(import.meta.dirname, "e2e-perf/access.json"),
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `node ${generator} --events 50000 --long --out ${PERF_TREE} && pnpm exec vite build && pnpm exec vite preview --port ${port} --strictPort`,
      url: `http://localhost:${port}/`,
      env: {
        VITE_API_TARGET: `http://127.0.0.1:${API_INGEST_PORT}`,
        VITE_DATA_ROOT: "/api/data",
        VITE_DATA_DIR: empty,
      },
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
})
