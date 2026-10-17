// Seeds the query API for playwright.api.config.ts: every event of the demo tree, posted to the
// ingest service as a wrapper would, so its store holds what the tree holds.

import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { expect, test } from "@playwright/test"

import { API_INGEST_PORT, INGEST_TOKEN } from "./env"

const events = resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures/events")

test("the store holds the demo tree's events", async ({ request }) => {
  const names = readdirSync(events).filter((n) => n.endsWith(".json") && n !== "index.json")
  for (const name of names) {
    const response = await request.post(`http://127.0.0.1:${API_INGEST_PORT}/events`, {
      headers: { authorization: `Bearer ${INGEST_TOKEN}` },
      data: JSON.parse(readFileSync(join(events, name), "utf8")),
    })
    expect([201, 409], name).toContain(response.status())
  }
  const index = await request.get(`http://127.0.0.1:${API_INGEST_PORT}/data/events/index.json`)
  expect((await index.json()).events).toHaveLength(names.length)
})
