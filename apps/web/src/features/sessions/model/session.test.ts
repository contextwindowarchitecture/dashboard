import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { SessionV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { sessionModel } from "./session"

const sessions = readdirSync(join(FIXTURES_DIR, "sessions")).map(
  (name) => JSON.parse(readFileSync(join(FIXTURES_DIR, "sessions", name), "utf8")) as SessionV1,
)
const named = (id: string) => sessions.find((s) => s.session_id === id)!

type Turn = SessionV1["turns"][number]
const assembled = (turn_index: number, extra: Partial<Turn> = {}): Turn =>
  ({
    turn_index,
    event_id: `01JA2B3C4D5E6F7G8H9JKMNP${String(turn_index).padStart(2, "0")}`,
    outcome: "assembled",
    input_tokens: 100,
    budget_input: 200,
    by_plane: { gov: 40, state: 10, evid: 30, inter: 10 },
    compressed_count: 0,
    over_budget_count: 0,
    ...extra,
  }) as Turn
const of = (turns: Turn[], part_reuse = { compared_turns: 0, reused_parts: 0, parts: 0 }) =>
  ({ ...named("refund-7"), turns, part_reuse }) as SessionV1

describe("sessionModel", () => {
  it("gives every turn of every demo session its tokens by plane and its overhead", () => {
    for (const session of sessions) {
      const model = sessionModel(session)
      expect(model.turns.map((t) => t.eventId)).toEqual(session.turns.map((t) => t.event_id))
      for (const [i, turn] of model.turns.entries()) {
        const source = session.turns[i]!
        if (source.outcome !== "assembled") {
          expect(turn.overhead, source.event_id).toBeUndefined()
          continue
        }
        const items = Object.values(source.by_plane!).reduce((a, b) => a + b, 0)
        expect(turn.overhead).toBe(Math.max(0, source.input_tokens! - items))
        expect(turn.overheadNegative).toBe(source.input_tokens! < items)
      }
    }
  })

  it("clamps an overhead below zero to zero, and says so", () => {
    const [turn] = sessionModel(of([assembled(0, { input_tokens: 80 })])).turns
    expect(turn).toMatchObject({ overhead: 0, overheadNegative: true })
  })

  it("sorts turns that arrive out of order", () => {
    const model = sessionModel(of([assembled(2), assembled(0), assembled(1)]))
    expect(model.turns.map((t) => t.turn)).toEqual([0, 1, 2])
  })

  it("finds the first compression, budget omission and refusal, each by turn", () => {
    expect(sessionModel(named("refund-7")).firsts).toEqual({ compressed: 4, overBudget: 3 })
    expect(sessionModel(named("ir-3")).firsts).toEqual({ compressed: 1 })
    expect(sessionModel(named("desk-agent-12")).firsts).toEqual({ refusal: 0 })
    expect(sessionModel(named("intake-12")).firsts).toEqual({ refusal: 2 })
  })

  it("has no first of anything for one quiet turn", () => {
    const model = sessionModel(of([assembled(0)]))
    expect(model.turns).toHaveLength(1)
    expect(model.firsts).toEqual({})
  })

  it("reads part reuse as not available when no turn could be compared", () => {
    expect(sessionModel(named("fixture-c1")).reuse).toBeUndefined()
    expect(sessionModel(named("desk-agent-12")).reuse).toBeUndefined()
    expect(sessionModel(named("refund-7")).reuse).toEqual({
      comparedTurns: 4,
      reusedParts: 25,
      parts: 66,
    })
  })

  it("keeps a rejected turn as a turn with no tokens", () => {
    const rejected = sessionModel(named("fixture-c1")).turns[1]!
    expect(rejected).toMatchObject({ outcome: "rejected", turn: 1 })
    expect(rejected.byPlane).toBeUndefined()
    expect(rejected.inputTokens).toBeUndefined()
    expect(rejected.budget).toBeUndefined()
  })
})
