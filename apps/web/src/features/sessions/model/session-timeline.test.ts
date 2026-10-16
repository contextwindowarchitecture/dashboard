import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { SessionV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { sessionModel } from "./session"
import { sessionTimeline } from "./session-timeline"

const sessions = readdirSync(join(FIXTURES_DIR, "sessions")).map(
  (name) => JSON.parse(readFileSync(join(FIXTURES_DIR, "sessions", name), "utf8")) as SessionV1,
)
const named = (id: string) => sessionModel(sessions.find((s) => s.session_id === id)!)

describe("sessionTimeline", () => {
  it("steps through every turn in order", () => {
    for (const session of sessions) {
      const model = sessionModel(session)
      expect(sessionTimeline(model).map((step) => step.turn)).toEqual(
        model.turns.map((t) => t.turn),
      )
    }
  })

  it("reveals each first at the turn it happened, and nowhere else", () => {
    const reveals = (id: string) =>
      sessionTimeline(named(id)).flatMap((step) => step.reveals.map((kind) => [step.turn, kind]))
    expect(reveals("refund-7")).toEqual([
      [3, "overBudget"],
      [4, "compressed"],
    ])
    expect(reveals("intake-12")).toEqual([[2, "refusal"]])
    expect(reveals("agent-run-412")).toEqual([])
  })

  it("has nothing to play for a session with no turns", () => {
    expect(sessionTimeline({ turns: [], firsts: {}, reuse: undefined })).toEqual([])
  })
})
