import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { finopsRows } from "./finops"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const assembled = index.events.filter((row) => row.outcome === "assembled")
const PRICES = { currency: "USD", per_million_input_tokens: { "support-chat": 3 } }

describe("finopsRows", () => {
  it("sums each route's assembled events, input tokens and compression savings", () => {
    const { routes, total } = finopsRows(index)
    for (const route of routes) {
      const rows = assembled.filter((row) => row.route === route.route)
      expect(route.events, route.route).toBe(rows.length)
      expect(route.input_tokens).toBe(rows.reduce((n, row) => n + (row.input_tokens ?? 0), 0))
      expect(route.saved).toBe(rows.reduce((n, row) => n + (row.compressed_saved ?? 0), 0))
      expect(route.saved_known).toBe(
        rows.filter((row) => row.compressed_saved !== undefined).length,
      )
    }
    expect(total.events).toBe(assembled.length)
    expect(routes.map((r) => r.route)).toEqual([...routes.map((r) => r.route)].sort())
  })

  it("prices a route only where the configuration does, and never otherwise", () => {
    const unpriced = finopsRows(index)
    for (const route of unpriced.routes) {
      expect(route.cost).toBeUndefined()
      expect(route.saved_worth).toBeUndefined()
    }
    expect(unpriced.total.cost).toBeUndefined()
    const { routes, total } = finopsRows(index, PRICES)
    const chat = routes.find((r) => r.route === "support-chat")!
    expect(chat.price).toBe(3)
    expect(chat.cost).toBeCloseTo((chat.input_tokens * 3) / 1_000_000, 12)
    expect(chat.saved_worth).toBeCloseTo((chat.saved * 3) / 1_000_000, 12)
    expect(routes.find((r) => r.route !== "support-chat")!.cost).toBeUndefined()
    // A total of money is known only when every route with events is priced.
    expect(total.cost).toBeUndefined()
  })

  it("says how many events could say what compression saved, an older index's rows not counted as 0", () => {
    const older = {
      ...index,
      events: index.events.map(({ compressed_saved: _saved, ...row }) => row),
    }
    const { total } = finopsRows(older as EventsIndexV1)
    expect(total.saved_known).toBe(0)
    expect(total.saved).toBe(0)
    expect(total.events).toBe(assembled.length)
  })
})
