#!/usr/bin/env node
// Posts every event of an event tree to an ingest service's POST /events, as a wrapper would, so a
// store that starts empty (PostgreSQL, ADR-0007) holds the demo traffic. Idempotent: an event the
// store already has answers 409 and counts as there. Waits for the service's /healthz first.
//
//   node deploy/seed-events.mjs <events directory> <ingest base URL> [--token <token>]
//   INGEST_TOKEN=… node deploy/seed-events.mjs packages/demo-traffic/fixtures/events http://127.0.0.1:8090

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const args = process.argv.slice(2)
const at = args.indexOf("--token")
const token = at >= 0 ? args[at + 1] : process.env.INGEST_TOKEN
const [dir, base] = args.filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--token")
if (!dir || !base || !token) {
  process.stderr.write(
    "usage: seed-events.mjs <events directory> <ingest base URL> [--token <token>]\n",
  )
  process.exit(2)
}
const url = base.replace(/\/+$/, "")

for (let attempt = 0; ; attempt += 1) {
  const ok = await fetch(`${url}/healthz`).then(
    (r) => r.ok,
    () => false,
  )
  if (ok) break
  if (attempt >= 60) {
    process.stderr.write(`seed-events: ${url}/healthz did not answer\n`)
    process.exit(1)
  }
  await new Promise((done) => setTimeout(done, 1000))
}

const names = readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "index.json")
const counts = { written: 0, there: 0 }
for (const name of names) {
  const response = await fetch(`${url}/events`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: readFileSync(join(dir, name)),
  })
  if (response.status === 201) counts.written += 1
  else if (response.status === 409) counts.there += 1
  else {
    process.stderr.write(
      `seed-events: ${name} answered ${response.status}: ${await response.text()}\n`,
    )
    process.exit(1)
  }
}
process.stdout.write(
  `seed-events: ${counts.written} written, ${counts.there} already there, of ${names.length}\n`,
)
