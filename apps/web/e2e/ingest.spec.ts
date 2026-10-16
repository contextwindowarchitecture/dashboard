// DP-6, done when an event posted to the ingest service appears in the stream: a demo event, given
// a new id and the newest time, posted with the token, then found in the stream and the inspector.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import { INGEST_PORT, INGEST_TOKEN } from "./env"

const fixtures = resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures")
const index = JSON.parse(readFileSync(resolve(fixtures, "events/index.json"), "utf8")) as {
  events: { event_id: string; recorded_at: string; outcome: string }[]
}
const source = index.events.find((row) => row.outcome === "assembled")!
const event = {
  ...(JSON.parse(
    readFileSync(resolve(fixtures, "events", `${source.event_id}.json`), "utf8"),
  ) as Record<string, unknown>),
  event_id: "01MZZZZZZZZZZZZZZZZZZZZZZZ",
  recorded_at: new Date(Date.parse(index.events[0]!.recorded_at) + 60_000).toISOString(),
  session: undefined,
}

test("an event posted to the ingest service appears in the stream", async ({ page, request }) => {
  const refused = await request.post(`http://127.0.0.1:${INGEST_PORT}/events`, { data: event })
  expect(refused.status()).toBe(401)
  const posted = await request.post(`http://127.0.0.1:${INGEST_PORT}/events`, {
    data: event,
    headers: { authorization: `Bearer ${INGEST_TOKEN}` },
  })
  expect(posted.status()).toBe(201)
  // The index is rebuilt a moment after a write.
  await expect
    .poll(async () => {
      await page.goto("/traces")
      return page.getByRole("table", { name: "Trace stream" }).getByRole("row").nth(1).textContent()
    })
    .toContain(event.event_id)
  await page.getByRole("link", { name: event.event_id }).click()
  await expect(page.getByRole("region", { name: "Outcome" })).toContainText("assembled")
})
