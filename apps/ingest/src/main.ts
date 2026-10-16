// Starts the ingest service: PORT (8090), REPLAY_TIMEOUT_MS (5000), MAX_BODY_BYTES (4 MiB, the
// sandbox's snapshot limit, dashboard-plan.md 9), and, to take events, EVENTS_DIR (the tree's root,
// beside events/ and sessions/) and INGEST_TOKEN, from the environment.

import { createWorkerRunner } from "./runner.ts"
import { createIngestServer } from "./server.ts"
import { createStore } from "./store.ts"

const number = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

const port = number("PORT", 8090)
const runner = createWorkerRunner({ timeoutMs: number("REPLAY_TIMEOUT_MS", 5000) })
const eventsDir = process.env["EVENTS_DIR"]
const store = eventsDir === undefined || eventsDir === "" ? undefined : await createStore(eventsDir)
const token = process.env["INGEST_TOKEN"]
const server = createIngestServer({
  runner,
  ...(store === undefined ? {} : { store }),
  ...(token === undefined || token === "" ? {} : { token }),
  maxBodyBytes: number("MAX_BODY_BYTES", 4 * 1024 * 1024),
  maxQueue: number("MAX_QUEUE", 8),
})
server.listen(port, () => process.stdout.write(`ingest: listening on ${port}\n`))

const stop = () => {
  server.close()
  void runner.close()
  void store?.close()
}
process.on("SIGTERM", stop)
process.on("SIGINT", stop)
