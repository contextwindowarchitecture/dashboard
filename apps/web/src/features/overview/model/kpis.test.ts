import { readFileSync } from "node:fs"
import { join } from "node:path"

import { REASONS } from "@cwa-dashboard/contract/data"
import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { kpis } from "./kpis"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const rows = index.events

describe("kpis", () => {
  it("counts the window's events by outcome", () => {
    const k = kpis(rows)
    expect(k.events).toBe(rows.length)
    expect(k.assembled + k.refused + k.rejected).toBe(rows.length)
    expect(k.refused).toBe(index.facets.outcome["refused"])
  })

  it("rates refusals, shedding and compression over the events that reached fitting", () => {
    const k = kpis(rows)
    const fitted = rows.filter((row) => row.outcome !== "rejected")
    expect(k.refusalRate).toBeCloseTo(k.refused / fitted.length, 10)
    expect(k.sheddingRate).toBeCloseTo(
      fitted.filter((row) => row.reason_codes.includes("over_budget")).length / fitted.length,
      10,
    )
    expect(k.compressionRate).toBeCloseTo(
      fitted.filter((row) => (row.compressed_count ?? 0) > 0).length / fitted.length,
      10,
    )
  })

  it("breaks refusals down by code", () => {
    const k = kpis(rows)
    expect(k.refusalsByCode.reduce((sum, entry) => sum + entry.events, 0)).toBe(k.refused)
    for (const entry of k.refusalsByCode)
      expect(REASONS.find((r) => r.code === entry.code)?.kind).toBe("refusal")
  })

  it("lists the six exclusion codes most events record, and the rest together", () => {
    const k = kpis(rows)
    expect(k.exclusionsByCode.top.length).toBeLessThanOrEqual(6)
    for (const entry of k.exclusionsByCode.top) {
      expect(REASONS.find((r) => r.code === entry.code)?.kind).toBe("exclusion")
      expect(entry.events).toBe(rows.filter((row) => row.reason_codes.includes(entry.code)).length)
    }
    const counts = k.exclusionsByCode.top.map((entry) => entry.events)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    expect(k.exclusionsByCode.otherCodes).toBeGreaterThanOrEqual(0)
  })

  it("has no rate for an empty window, never 0", () => {
    const k = kpis([])
    expect(k.refusalRate).toBeUndefined()
    expect(k.sheddingRate).toBeUndefined()
    expect(k.compressionRate).toBeUndefined()
  })
})
