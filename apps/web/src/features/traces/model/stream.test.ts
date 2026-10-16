import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import {
  DEFAULT_FILTERS,
  facetOptions,
  filterRows,
  isFiltered,
  parseFilters,
  toSearch,
} from "./stream"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const rows = index.events
const params = (query: string) => new URLSearchParams(query)

describe("parseFilters", () => {
  it("reads each filter from the URL, and the defaults from an empty one", () => {
    expect(parseFilters(params(""))).toEqual(DEFAULT_FILTERS)
    expect(
      parseFilters(
        params(
          "outcome=refused&language=typescript&route=support-chat&reason=expired&service=intake-assistant&session=intake-12&sort=oldest",
        ),
      ),
    ).toEqual({
      outcome: "refused",
      language: "typescript",
      route: "support-chat",
      reason: "expired",
      service: "intake-assistant",
      session: "intake-12",
      sort: "oldest",
    })
  })

  it("drops an invalid value to its default, leaving the others", () => {
    const filters = parseFilters(
      params("outcome=maybe&language=java&route=support-chat&sort=sideways&reason="),
    )
    expect(filters).toEqual({ ...DEFAULT_FILTERS, route: "support-chat" })
  })

  it("round-trips through the URL, leaving defaults out", () => {
    const filters = {
      ...DEFAULT_FILTERS,
      outcome: "rejected" as const,
      reason: "missing_field:relevance",
    }
    expect(toSearch(filters).toString()).toBe("outcome=rejected&reason=missing_field%3Arelevance")
    expect(parseFilters(toSearch(filters))).toEqual(filters)
    expect(toSearch(DEFAULT_FILTERS).toString()).toBe("")
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false)
    expect(isFiltered(filters)).toBe(true)
  })
})

describe("filterRows", () => {
  it("keeps every row with no filter, newest first", () => {
    const all = filterRows(rows, DEFAULT_FILTERS)
    expect(all).toHaveLength(rows.length)
    const times = all.map((row) => row.recorded_at)
    expect(times).toEqual([...times].sort().reverse())
  })

  it("filters by each field, a reason matching exclusions and refusals alike", () => {
    const by = (filters: Partial<typeof DEFAULT_FILTERS>) =>
      filterRows(rows, { ...DEFAULT_FILTERS, ...filters })
    expect(by({ outcome: "rejected" }).every((row) => row.outcome === "rejected")).toBe(true)
    expect(by({ outcome: "rejected" })).toHaveLength(index.facets.outcome["rejected"]!)
    expect(by({ route: "support-chat" })).toHaveLength(index.facets.route["support-chat"]!)
    expect(by({ service: "intake-assistant" })).toHaveLength(
      index.facets.service["intake-assistant"]!,
    )
    expect(by({ reason: "evidence_required" })).toHaveLength(
      index.facets.reason["evidence_required"]!,
    )
    expect(by({ reason: "expired" })).toHaveLength(index.facets.reason["expired"]!)
    expect(
      by({ session: "intake-12" })
        .map((row) => row.session?.turn_index)
        .sort(),
    ).toEqual([0, 1, 2])
    expect(by({ language: "go" })).toEqual([])
  })

  it("sorts oldest first when asked", () => {
    const times = filterRows(rows, { ...DEFAULT_FILTERS, sort: "oldest" }).map(
      (row) => row.recorded_at,
    )
    expect(times).toEqual([...times].sort())
  })
})

describe("facetOptions", () => {
  it("offers each value the index counted, most frequent first, then by name", () => {
    const options = facetOptions(index.facets.outcome)
    expect(options.map((option) => option.value)).toEqual(
      ["assembled", "refused", "rejected"].sort(
        (a, b) => index.facets.outcome[b]! - index.facets.outcome[a]! || (a < b ? -1 : 1),
      ),
    )
    expect(options[0]!.count).toBe(index.facets.outcome[options[0]!.value])
  })
})
