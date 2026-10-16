import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { EventsIndexV1, SessionV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { sessionModel } from "./session"
import { sessionRows } from "./sessions-list"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const documents = readdirSync(join(FIXTURES_DIR, "sessions")).map(
  (name) => JSON.parse(readFileSync(join(FIXTURES_DIR, "sessions", name), "utf8")) as SessionV1,
)

describe("sessionRows", () => {
  it("gives one row to each session the index holds, and none to an event outside a session", () => {
    const rows = sessionRows(index.events)
    const ids = new Set(index.events.flatMap((row) => (row.session ? [row.session.id] : [])))
    expect(rows.map((row) => row.id).sort()).toEqual([...ids].sort())
    for (const row of rows) {
      const events = index.events.filter((e) => e.session?.id === row.id)
      expect(row.turns).toBe(events.length)
    }
  })

  it("lists the most recently recorded session first", () => {
    const rows = sessionRows(index.events)
    const last = rows.map((row) => row.lastRecorded)
    expect(last).toEqual([...last].sort().reverse())
  })

  it("orders each session's outcomes by turn, and counts them", () => {
    for (const row of sessionRows(index.events)) {
      const document = documents.find((d) => d.session_id === row.id)
      if (document === undefined) continue
      expect(row.outcomes).toEqual(document.turns.map((t) => t.outcome))
      expect(row.counts.assembled + row.counts.refused + row.counts.rejected).toBe(row.turns)
    }
  })

  it("finds the same firsts in the index as the session documents hold", () => {
    for (const document of documents) {
      const row = sessionRows(index.events).find((r) => r.id === document.session_id)!
      expect(row.firsts, document.session_id).toEqual(sessionModel(document).firsts)
    }
  })

  it("names the session's route and service from its turns, a rejected turn's absent route aside", () => {
    for (const document of documents) {
      const row = sessionRows(index.events).find((r) => r.id === document.session_id)!
      expect(row.route).toBe(document.route)
      expect(row.service).toBe(document.service)
    }
  })

  it("counts only over_budget as a budget omission, not the refusals named after the budget", () => {
    const refused = index.events.find(
      (row) => row.refused_reason === "protected_content_over_budget",
    )!
    const [row] = sessionRows([{ ...refused, session: { id: "s", turn_index: 0 } }])
    expect(row!.firsts).toEqual({ refusal: 0 })
    const omitted = { ...refused, outcome: "assembled" as const, reason_codes: ["over_budget"] }
    expect(sessionRows([{ ...omitted, session: { id: "s", turn_index: 0 } }])[0]!.firsts).toEqual({
      overBudget: 0,
    })
  })

  it("has no rows for an index with no sessions", () => {
    expect(sessionRows(index.events.filter((row) => row.session === undefined))).toEqual([])
  })
})
