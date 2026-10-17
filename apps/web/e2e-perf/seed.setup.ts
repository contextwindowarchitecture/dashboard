// Posts the generated perf tree's events to the ingest service for playwright.perf-api.config.ts, with
// deploy/seed-events.mjs, as wrappers would; the store then holds what the tree holds.

import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { join, resolve } from "node:path"

import { expect, test } from "@playwright/test"

import { API_INGEST_PORT, INGEST_TOKEN, PERF_TREE } from "../e2e/env"

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
