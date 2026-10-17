// Posts the generated perf tree's events to the ingest service for playwright.perf-api.config.ts, with
// deploy/seed-events.mjs, as wrappers would; the store then holds what the tree holds. Then half of
// them again into a second tenant, so reads are scoped by tenant over a store holding two.

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  API_INGEST_PORT,
  INGEST_TOKEN,
  PERF_TREE,
  PERF_SECOND_TENANT as SECOND_TENANT,
} from "../e2e/env"

test("the store holds the perf tree's events", async ({ request }) => {
  const events = join(PERF_TREE, "events")
  const seeded = spawnSync(
    process.execPath,
    [
      resolve(import.meta.dirname, "../../../deploy/seed-events.mjs"),
      events,
      `http://127.0.0.1:${API_INGEST_PORT}`,
      "--token",
      INGEST_TOKEN,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  )
  expect(seeded.stderr).toBe("")
  expect(seeded.status).toBe(0)
  const names = readdirSync(events).filter((n) => n.endsWith(".json") && n !== "index.json")
  const index = await (
    await request.get(`http://127.0.0.1:${API_INGEST_PORT}/data/events/index.json`)
  ).json()
  const closed = (index.windows ?? []).reduce((n: number, w: { events: number }) => n + w.events, 0)
  expect(index.events.length + closed).toBe(names.length)
})

/** The second tenant's events (ADR-0012), their own ids derived from the first's, as the store tests do. */
const SECOND_EVENTS = 25_000

test("the store holds a second tenant's events", async ({ request }) => {
  const events = join(PERF_TREE, "events")
  const names = readdirSync(events)
    .filter((n) => n.endsWith(".json") && n !== "index.json")
    .sort()
    .slice(0, SECOND_EVENTS)
  const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let next = 0
  const failures: string[] = []
  let written = 0
  const post = async () => {
    while (next < names.length) {
      const name = names[next++]!
      const event = JSON.parse(readFileSync(join(events, name), "utf8")) as { event_id: string }
      const digest = createHash("sha256").update(`${SECOND_TENANT}/${event.event_id}`).digest()
      const tail = [...digest.subarray(0, 16)].map((byte) => CROCKFORD[byte % 32]).join("")
      const response = await request.post(`http://127.0.0.1:${API_INGEST_PORT}/events`, {
        headers: { authorization: `Bearer ${INGEST_TOKEN}` },
        data: { ...event, event_id: event.event_id.slice(0, 10) + tail, tenant: SECOND_TENANT },
      })
      if (response.status() === 201) written += 1
      else failures.push(`${name}: ${response.status()}`)
    }
  }
  await Promise.all(Array.from({ length: 16 }, post))
  expect(failures).toEqual([])
  // The store starts empty each run, so every event is new to it. (/data/tenants.json lists only the
  // tenants the reader may read, and this reader is anonymous.)
  expect(written).toBe(SECOND_EVENTS)
})
