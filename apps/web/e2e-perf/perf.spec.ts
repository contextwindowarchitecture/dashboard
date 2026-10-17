// The budgets of dashboard-plan.md 11, measured over a generated tree at the window's cap: the
// stream answers a filter change within 100 ms, a 200-item snapshot replays within 500 ms, and the
// longest pages render and fit a phone's width. Each measurement is printed beside its budget.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { expect, test } from "@playwright/test"

import { PERF_TREE } from "../e2e/env"
import { expectNoSidewaysScroll, measureFilterChange } from "./measure"

interface Batch {
  producer: { id: string }
  items: unknown[]
}
interface Event {
  event_id: string
  snapshot: { batches: Batch[] }
  trace: { included: unknown[]; excluded: unknown[] }
}

const read = <T>(path: string) => JSON.parse(readFileSync(join(PERF_TREE, path), "utf8")) as T

/** The long trace (packages/demo-traffic/src/long.ts): the only call with an input budget of 40,000. */
function wideEvent(): Event {
  const index = read<{ events: { event_id: string; budget_input?: number }[] }>("events/index.json")
  const row = index.events.find((r) => r.budget_input === 40_000)
  if (row === undefined) throw new Error("the perf tree has no long trace; generate it with --long")
  return read<Event>(`events/${row.event_id}.json`)
}

test("the stream at 20,000 rows answers a filter change within 100 ms", async ({ page }) => {
  const started = Date.now()
  await page.goto("/traces")
  const table = page.getByRole("table", { name: "Trace stream" })
  await table.getByRole("row").nth(1).waitFor()
  const firstRender = Date.now() - started
  await expect(table).toHaveAttribute("aria-rowcount", "20001")
  const filter = await measureFilterChange(page)
  console.log(
    `stream: first render ${firstRender} ms; filter change ${Math.round(filter)} ms (budget 100 ms)`,
  )
  expect(filter).toBeLessThan(100)
})

test("a trace of more than 400 rows opens in the inspector and fits a phone's width", async ({
  page,
}) => {
  const wide = wideEvent()
  const rows = wide.trace.included.length + wide.trace.excluded.length
  expect(rows).toBeGreaterThan(400)
  const started = Date.now()
  await page.goto(`/traces/${wide.event_id}`)
  await page.getByRole("list", { name: "Included items" }).getByRole("listitem").first().waitFor()
  console.log(`inspector: ${rows} rows in ${Date.now() - started} ms`)
  await expectNoSidewaysScroll(page)
})

test("a 60-turn session draws its timeline and fits a phone's width", async ({ page }) => {
  const started = Date.now()
  await page.goto("/sessions/long-60")
  const chart = page.getByRole("img", { name: /60 turns/ })
  await chart.waitFor()
  console.log(`session: 60 turns in ${Date.now() - started} ms`)
  await expect(chart.locator("[data-turn]")).toHaveCount(60)
  await expectNoSidewaysScroll(page)
})

test("a 200-item snapshot replays through the service within 500 ms", async ({ page }) => {
  // The long trace's snapshot cut to 200 items: its retrieved chunks trimmed, every other batch kept.
  const snapshot = structuredClone(wideEvent().snapshot)
  const corpus = snapshot.batches.find((b) => b.producer.id === "policy-corpus")!
  const others = snapshot.batches.reduce((n, b) => n + b.items.length, 0) - corpus.items.length
  corpus.items = corpus.items.slice(0, 200 - others)
  expect(snapshot.batches.reduce((n, b) => n + b.items.length, 0)).toBe(200)
  await page.goto("/sandbox")
  await page.getByRole("textbox", { name: "Snapshot JSON" }).fill(JSON.stringify(snapshot))
  const result = page.getByRole("region", { name: "Replay result" })
  const started = Date.now()
  await page.getByRole("button", { name: "Replay" }).click()
  await result.getByText("No recorded event to compare with").waitFor()
  const roundTrip = Date.now() - started
  console.log(`sandbox: 200 items replayed in ${roundTrip} ms (budget 500 ms)`)
  expect(roundTrip).toBeLessThan(500)
})
