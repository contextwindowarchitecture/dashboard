// Starts the ingest service: PORT (8090), REPLAY_TIMEOUT_MS (5000), MAX_BODY_BYTES (4 MiB, the
// sandbox's snapshot limit, dashboard-plan.md 9), and, to keep and serve events, a store
// (open-store.ts: DATABASE_URL for PostgreSQL, else EVENTS_DIR for the tree) and, to take writes,
// INGEST_TOKEN, to sign compliance bundles, SIGNING_KEY (an Ed25519 PKCS #8 PEM), and, to keep
// redacted bodies (ADR-0009), a vault (DATABASE_URL's database, or VAULT_DIR) with VAULT_TOKEN, the
// operator's, to read them, and, to sign readers in (ADR-0010), OIDC_ISSUER, OIDC_CLIENT_ID,
// OIDC_CLIENT_SECRET and OIDC_REDIRECT_URI (OIDC_SCOPES; OIDC_ISSUER_INTERNAL, where the service
// reaches an issuer served behind the site's proxy; OIDC_ALLOW_HTTP for an issuer on plain HTTP),
// and ACCESS_FILE, who may read what (ADR-0011), from the environment.

import { createWorkerRunner } from "./runner.ts"
import { createIngestServer } from "./server.ts"
import { signingKeyFrom } from "./bundle.ts"
import { loadAccess } from "./access.ts"
import { authConfigFrom, createAuth } from "./auth.ts"
import { openStore, openVault } from "./open-store.ts"

const number = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

const port = number("PORT", 8090)
const runner = createWorkerRunner({ timeoutMs: number("REPLAY_TIMEOUT_MS", 5000) })
const opened = await openStore(process.env)
const store = opened?.store
const token = process.env["INGEST_TOKEN"]
const vault = openVault(process.env, opened)
const vaultToken = process.env["VAULT_TOKEN"]
// Sign-in (ADR-0010) keeps its sessions in PostgreSQL; the tree's readers stay anonymous.
const authConfig = authConfigFrom(process.env)
const sessions = opened?.sessions
if (authConfig !== undefined && sessions === undefined) {
  throw new Error(
    "Sign-in keeps its sessions in PostgreSQL: set DATABASE_URL, or leave OIDC_* unset.",
  )
}
const auth =
  authConfig === undefined
    ? undefined
    : createAuth({
        config: authConfig,
        sessions: sessions!,
        allowHttp: process.env["OIDC_ALLOW_HTTP"] === "true",
      })
// A compliance bundle's signing key, a PKCS #8 PEM; a key that is not Ed25519 stops the service.
const signingPem = process.env["SIGNING_KEY"]
const signingKey =
  signingPem === undefined || signingPem === "" ? undefined : signingKeyFrom(signingPem)
// Who may read what (ADR-0011): ACCESS_FILE, a JSON file; without it every reader reads everything.
const access = loadAccess(process.env)
const server = createIngestServer({
  runner,
  ...(store === undefined ? {} : { store }),
  ...(token === undefined || token === "" ? {} : { token }),
  ...(signingKey === undefined ? {} : { signingKey }),
  ...(vault === undefined ? {} : { vault }),
  ...(vaultToken === undefined || vaultToken === "" ? {} : { vaultToken }),
  ...(auth === undefined ? {} : { auth }),
  ...(access === undefined ? {} : { access }),
  maxBodyBytes: number("MAX_BODY_BYTES", 4 * 1024 * 1024),
  maxQueue: number("MAX_QUEUE", 8),
})
server.listen(port, () =>
  process.stdout.write(
    `ingest: listening on ${port}, store: ${opened?.kind ?? "none"}, vault: ${vault === undefined ? "none" : "on"}, sign-in: ${auth === undefined ? "none" : authConfig!.issuer}, access: ${access === undefined ? "open" : "by role"}\n`,
  ),
)

const stop = () => {
  server.close()
  void runner.close()
  void store?.close()
}
process.on("SIGTERM", stop)
process.on("SIGINT", stop)
