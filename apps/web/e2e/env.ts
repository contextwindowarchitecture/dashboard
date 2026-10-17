// What the browser tests and the servers Playwright starts agree on.

import { generateKeyPairSync } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** The bearer token the ingest service takes in the browser tests. */
export const INGEST_TOKEN = "e2e-ingest-token"
/** The port the ingest service listens on in the browser tests. */
export const INGEST_PORT = 8091

/** The generated tree the performance tests serve (playwright.perf.config.ts). */
export const PERF_TREE = join(tmpdir(), "cwa-dashboard-perf-tree")

/** The port the ingest service listens on in the browser tests over the query API. */
export const API_INGEST_PORT = 8093

/** The key the ingest service signs compliance bundles with in the browser tests: fresh each run. */
export const SIGNING_KEY = generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString()

/** The corpus the shadow page's tests replay, frozen by e2e/corpus.setup.ts. */
export const E2E_CORPUS = "e2e-chat"

/** The operator token the ingest service resolves vaulted bodies with in the browser tests. */
export const VAULT_TOKEN = "e2e-vault-token"

/** The test issuer the browser tests over the query API sign in through (ADR-0010). */
export const OIDC_TEST = {
  port: 8094,
  clientId: "cwa-dashboard-e2e",
  clientSecret: "e2e-client-secret",
} as const
