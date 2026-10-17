// Starts the ingest service: PORT (8090), REPLAY_TIMEOUT_MS (5000), MAX_BODY_BYTES (4 MiB, the
// sandbox's snapshot limit, dashboard-plan.md 9), and, to keep and serve events, a store
// (open-store.ts: DATABASE_URL for PostgreSQL, else EVENTS_DIR for the tree) and, to take writes,
// INGEST_TOKEN, from the environment.

import { createWorkerRunner } from "./runner.ts"
import { createIngestServer } from "./server.ts"
import { openStore } from "./open-store.ts"

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
const server = createIngestServer({
  runner,
  ...(store === undefined ? {} : { store }),
  ...(token === undefined || token === "" ? {} : { token }),
  maxBodyBytes: number("MAX_BODY_BYTES", 4 * 1024 * 1024),
  maxQueue: number("MAX_QUEUE", 8),
})
server.listen(port, () =>
  process.stdout.write(`ingest: listening on ${port}, store: ${opened?.kind ?? "none"}\n`),
)

const stop = () => {
  server.close()
  void runner.close()
  void store?.close()
}
process.on("SIGTERM", stop)
process.on("SIGINT", stop)
