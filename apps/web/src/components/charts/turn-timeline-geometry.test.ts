import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { SessionV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { sessionModel } from "../../features/sessions/model/session"
import { FIXTURES_DIR } from "../../test/fixture-fetch"
import { TIMELINE_MARGIN as M, turnTimeline } from "./turn-timeline-geometry"

const load = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "sessions", `${id}.json`), "utf8")) as SessionV1
const SIZE = { width: 600, height: 240 }
const baseline = SIZE.height - M.bottom

type Turn = SessionV1["turns"][number]
const turn = (turn_index: number, extra: Partial<Turn> = {}): Turn =>
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
const session = (turns: Turn[]) =>
  sessionModel({ ...load("refund-7"), turns, part_reuse: load("refund-7").part_reuse })

describe("turnTimeline", () => {
  it("bands the turns in order across the plot, one bar each, none overlapping", () => {
    const g = turnTimeline(sessionModel(load("refund-7")), SIZE)
    expect(g.bars.map((b) => b.turn)).toEqual([0, 1, 2, 3, 4])
    for (const [i, bar] of g.bars.entries()) {
      expect(bar.x).toBeGreaterThanOrEqual(M.left)
      expect(bar.x + bar.width).toBeLessThanOrEqual(SIZE.width - M.right)
      expect(bar.width).toBeCloseTo(g.bars[0]!.width)
      if (i > 0) expect(bar.x).toBeGreaterThan(g.bars[i - 1]!.x + g.bars[i - 1]!.width)
    }
  })

  it("stacks each plane and the overhead from the baseline, in proportion to their tokens", () => {
    const model = sessionModel(load("refund-7"))
    const g = turnTimeline(model, SIZE)
    for (const [i, bar] of g.bars.entries()) {
      const t = model.turns[i]!
      expect(bar.segments.map((s) => s.key)).toEqual(
        ["gov", "state", "evid", "inter", "overhead"].filter((key) =>
          key === "overhead" ? t.overhead! > 0 : t.byPlane![key as "gov"] > 0,
        ),
      )
      let y = baseline
      for (const segment of bar.segments) {
        expect(segment.y + segment.height).toBeCloseTo(y)
        y = segment.y
      }
      const perToken = bar.segments[0]!.height / bar.segments[0]!.tokens
      for (const segment of bar.segments)
        expect(segment.height / segment.tokens).toBeCloseTo(perToken)
      expect(baseline - y).toBeCloseTo(perToken * t.inputTokens!)
    }
  })

  it("draws one budget rule for a session whose budget never changes", () => {
    const g = turnTimeline(sessionModel(load("refund-7")), SIZE)
    expect(g.budget?.tokens).toBe(720)
    for (const bar of g.bars) expect(bar.budgetY).toBeCloseTo(g.budget!.y)
    const tops = g.bars.map((b) => Math.min(...b.segments.map((s) => s.y)))
    expect(Math.min(...tops)).toBeGreaterThan(g.budget!.y)
  })

  it("marks each bar's own budget when the budget changes between turns", () => {
    const g = turnTimeline(session([turn(0), turn(1, { budget_input: 400 })]), SIZE)
    expect(g.budget).toBeUndefined()
    expect(g.bars[1]!.budgetY).toBeLessThan(g.bars[0]!.budgetY!)
  })

  it("draws a refusal as a full bar to its budget, with no segments", () => {
    const g = turnTimeline(sessionModel(load("intake-12")), SIZE)
    const refused = g.bars[2]!
    expect(refused.kind).toBe("refused")
    expect(refused.segments).toEqual([])
    expect(refused.y).toBeCloseTo(refused.budgetY!)
    expect(refused.y + refused.height).toBeCloseTo(baseline)
  })

  it("leaves a rejected turn's place empty", () => {
    const g = turnTimeline(sessionModel(load("fixture-c1")), SIZE)
    expect(g.bars[1]).toMatchObject({ kind: "rejected", segments: [], height: 0 })
    expect(g.bars[1]!.budgetY).toBeUndefined()
  })

  it("keeps a turn over its budget inside the plot, above the rule, and flags it", () => {
    const g = turnTimeline(
      session([
        turn(0),
        turn(1, { input_tokens: 300, by_plane: { gov: 100, state: 50, evid: 100, inter: 50 } }),
      ]),
      SIZE,
    )
    const over = g.bars[1]!
    expect(over.overBudget).toBe(true)
    expect(g.bars[0]!.overBudget).toBe(false)
    expect(over.y).toBeLessThan(g.budget!.y)
    expect(over.y).toBeGreaterThanOrEqual(M.top)
  })

  it("puts each first's marker over its turn's bar", () => {
    const model = sessionModel(load("refund-7"))
    const g = turnTimeline(model, SIZE)
    expect(g.markers.map((m) => [m.kind, m.turn])).toEqual([
      ["overBudget", 3],
      ["compressed", 4],
    ])
    for (const marker of g.markers) {
      const bar = g.bars.find((b) => b.turn === marker.turn)!
      expect(marker.x).toBeCloseTo(bar.x + bar.width / 2)
    }
  })

  it("ticks the token axis from zero, every tick inside the plot", () => {
    const g = turnTimeline(sessionModel(load("refund-7")), SIZE)
    expect(g.yTicks[0]).toMatchObject({ value: 0, y: baseline })
    for (const tick of g.yTicks) {
      expect(tick.y).toBeGreaterThanOrEqual(M.top)
      expect(tick.y).toBeLessThanOrEqual(baseline)
    }
  })

  it("orders bars by turn whatever order the turns arrived in", () => {
    const model = session([turn(0), turn(1), turn(2)])
    const g = turnTimeline({ ...model, turns: [...model.turns].reverse() }, SIZE)
    expect(g.bars.map((b) => b.turn)).toEqual([0, 1, 2])
    expect(g.bars[0]!.x).toBeLessThan(g.bars[2]!.x)
  })

  it("is finite with no turns, a zero budget, or tokens that are not numbers", () => {
    const finite = (g: ReturnType<typeof turnTimeline>) =>
      JSON.stringify(g, (_, v) => {
        if (typeof v === "number") expect(Number.isFinite(v)).toBe(true)
        return v
      })
    expect(turnTimeline({ turns: [], firsts: {} }, SIZE).bars).toEqual([])
    finite(turnTimeline({ turns: [], firsts: {} }, SIZE))
    const zero = turnTimeline(
      session([
        turn(0, {
          budget_input: 0,
          input_tokens: 0,
          by_plane: { gov: 0, state: 0, evid: 0, inter: 0 },
        }),
      ]),
      SIZE,
    )
    finite(zero)
    expect(zero.yTicks[0]).toMatchObject({ value: 0, y: baseline })
    const bad = session([turn(0)])
    const broken = {
      ...bad,
      turns: [
        {
          ...bad.turns[0]!,
          inputTokens: Number.NaN,
          byPlane: { gov: Number.POSITIVE_INFINITY, state: -5, evid: 1, inter: 1 },
        },
      ],
    }
    finite(turnTimeline(broken, SIZE))
    finite(turnTimeline(sessionModel(load("refund-7")), { width: 0, height: 0 }))
  })
})
