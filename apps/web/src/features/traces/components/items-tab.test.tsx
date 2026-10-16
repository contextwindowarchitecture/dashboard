import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { formatInstant } from "../../../lib/format"
import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"
import { joinItems } from "../model/inspector"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const load = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "events", `${id}.json`), "utf8")) as AssemblyEventV1
const bySession = (session: string, turn: number) =>
  index.events.find((row) => row.session?.id === session && row.session.turn_index === turn)!
    .event_id

const FULL = bySession("refund-7", 4)
const SCRUBBED = bySession("intake-12", 0)
const DIGESTED = bySession("agent-run-412", 1)

async function rowsOf(id: string) {
  renderApp(`/traces/${id}`)
  const list = await screen.findByRole("list", { name: "Included items" })
  return within(list).getAllByRole("listitem")
}

describe("the Items tab", () => {
  // R-DASH-1: every item's metadata, in every redaction mode.
  for (const [mode, id] of [
    ["full", FULL],
    ["pii_scrubbed", SCRUBBED],
    ["digest_only", DIGESTED],
  ] as const) {
    it(`shows every item's metadata under ${mode}`, async () => {
      const event = load(id)
      expect(event.redaction_mode).toBe(mode)
      const items = await rowsOf(id)
      const joined = joinItems(event)
      expect(items).toHaveLength(joined.length)
      joined.forEach((row, i) => {
        const item = items[i]!
        const where = `${mode} ${row.item_id}`
        expect(item, where).toHaveTextContent(row.item_id)
        expect(item, where).toHaveTextContent(row.slot)
        expect(item, where).toHaveTextContent(
          `included · ${row.tokens.toLocaleString("en-US")} token`,
        )
        expect(item, where).toHaveTextContent(`${row.producer.id} · ${row.producer.kind}`)
        for (const value of [
          row.authority,
          row.trust,
          row.tier!.tier,
          row.lineage!.value,
          row.injection_risk!.value,
          row.source,
          row.source_version,
        ]) {
          expect(item, `${where} ${value}`).toHaveTextContent(value!)
        }
        expect(item, where).toHaveTextContent(formatInstant(row.freshness))
        if (row.expires) expect(item, where).toHaveTextContent(formatInstant(row.expires))
        if (row.relevance !== undefined)
          expect(item, where).toHaveTextContent(String(row.relevance))
      })
    })
  }

  it("says where an effective tier and a defaulted field came from", async () => {
    const items = await rowsOf(FULL)
    const joined = joinItems(load(FULL))
    const i = joined.findIndex((row) => row.lineage?.defaulted)
    expect(i).toBeGreaterThanOrEqual(0)
    expect(items[i]).toHaveTextContent(`lineage ${joined[i]!.lineage!.value} (default)`)
    expect(items[0]).toHaveTextContent(
      `tier ${joined[0]!.tier!.tier} (${joined[0]!.tier!.source === "item" ? "item" : joined[0]!.tier!.source === "route" ? "route" : "slot default"})`,
    )
  })

  it("shows a compressed occurrence's step-down", async () => {
    const event = load(FULL)
    const compressed = event.trace!.compressed[0]!
    const items = await rowsOf(FULL)
    const item = items.find((li) => li.textContent?.includes(compressed.item_id))!
    expect(item).toHaveTextContent(`compressed ${compressed.from} → ${compressed.to}`)
    expect(item).toHaveTextContent(compressed.method)
  })

  it("shows a full body as the producer emitted it", async () => {
    const items = await rowsOf(FULL)
    const joined = joinItems(load(FULL))
    const body = joined[0]!.body
    if (body.form !== "text") throw new Error("expected text")
    expect(within(items[0]!).getByText(/^body ·/)).toBeInTheDocument()
    expect(items[0]).toHaveTextContent(body.text.slice(0, 40))
  })

  it("shows a scrubbed body as scrubbed at source, with the original's digest", async () => {
    const items = await rowsOf(SCRUBBED)
    const body = joinItems(load(SCRUBBED))[0]!.body
    if (body.form !== "scrubbed") throw new Error("expected scrubbed")
    expect(items[0]).toHaveTextContent("body scrubbed at source · pii_scrubbed")
    expect(items[0]).toHaveTextContent(body.content_sha256)
  })

  // R-DASH-2: a redacted body names the mode, the digest and the counts, and the setting that reveals it.
  it("shows a digested body as its digest and counts, naming the wrapper setting that reveals it", async () => {
    const event = load(DIGESTED)
    const items = await rowsOf(DIGESTED)
    const body = joinItems(event)[0]!.body
    if (body.form !== "digest") throw new Error("expected digest")
    expect(items[0]).toHaveTextContent("body redacted · digest_only")
    expect(items[0]).toHaveTextContent(body.content_sha256)
    for (const [tokenizer, count] of Object.entries(body.token_counts)) {
      expect(items[0]).toHaveTextContent(tokenizer)
      expect(items[0]).toHaveTextContent(String(count))
    }
    expect(items[0]).toHaveTextContent(
      `routes.${event.snapshot!.route_policy.route}.redaction_mode`,
    )
  })
})
