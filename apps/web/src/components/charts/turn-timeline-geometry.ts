// The turn timeline's geometry (STYLE.md 6, Charts; dashboard-plan.md 8): one bar per turn on a
// band scale, each assembled turn's planes and rendering overhead stacked from the baseline on a
// linear token scale, a refusal as a full bar to its budget, a rejected turn's place left empty,
// the budget as one rule when it never changes and per bar when it does, and a marker over the
// turn of each first. Pure, and finite on any input: no turns, a zero budget, a plot with no room
// and a token count that is not a finite, non-negative number all draw something sane.

import { scaleBand, scaleLinear } from "d3-scale"

import type { Firsts, Turn } from "../../features/sessions/model/session"
import type { PlaneKey } from "../../features/traces/model/inspector"

export const TIMELINE_MARGIN = { top: 16, right: 12, bottom: 28, left: 48 } as const

const PLANES: readonly PlaneKey[] = ["gov", "state", "evid", "inter"]
const count = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0

export type TimelineSegmentKey = PlaneKey | "overhead"

export interface TimelineSegment {
  readonly key: TimelineSegmentKey
  readonly tokens: number
  readonly y: number
  readonly height: number
}

export interface TimelineBar {
  readonly turn: number
  readonly kind: Turn["outcome"]
  readonly x: number
  readonly width: number
  /** The top of what is drawn, and its height down to the baseline. */
  readonly y: number
  readonly height: number
  /** Bottom up; empty for a refusal and a rejection. */
  readonly segments: readonly TimelineSegment[]
  readonly overBudget: boolean
  /** Where this turn's budget falls; undefined for a rejected turn. */
  readonly budgetY: number | undefined
}

export interface TimelineMarker {
  readonly kind: keyof Firsts
  readonly turn: number
  readonly x: number
}

export interface TurnTimeline {
  readonly bars: readonly TimelineBar[]
  readonly markers: readonly TimelineMarker[]
  /** The rule, when every turn with a budget has the same one. */
  readonly budget: { readonly tokens: number; readonly y: number } | undefined
  readonly yTicks: readonly { readonly value: number; readonly y: number }[]
  readonly baseline: number
}

const MARKER_ORDER: readonly (keyof Firsts)[] = ["compressed", "overBudget", "refusal"]

export function turnTimeline(
  model: { readonly turns: readonly Turn[]; readonly firsts: Firsts },
  size: { readonly width: number; readonly height: number },
): TurnTimeline {
  const M = TIMELINE_MARGIN
  const turns = [...model.turns].sort((a, b) => a.turn - b.turn)
  const right = Math.max(M.left, count(size.width) - M.right)
  const baseline = Math.max(M.top, count(size.height) - M.bottom)

  const stack = (turn: Turn) => {
    if (turn.outcome !== "assembled") return []
    const parts: { key: TimelineSegmentKey; tokens: number }[] = PLANES.map((key) => ({
      key,
      tokens: count(turn.byPlane?.[key]),
    }))
    parts.push({ key: "overhead", tokens: count(turn.overhead) })
    return parts.filter((part) => part.tokens > 0)
  }
  const stacks = turns.map(stack)
  const drawn = stacks.map((parts) => parts.reduce((sum, part) => sum + part.tokens, 0))
  const budgets = turns.map((turn) => (turn.budget === undefined ? undefined : count(turn.budget)))
  const top = Math.max(1, ...drawn, ...budgets.map((b) => b ?? 0))

  const x = scaleBand<number>()
    .domain(turns.map((turn) => turn.turn))
    .range([M.left, right])
    .paddingInner(0.25)
    .paddingOuter(0.15)
  const y = scaleLinear().domain([0, top]).nice().range([baseline, M.top])

  const bars = turns.map((turn, i): TimelineBar => {
    const left = x(turn.turn) ?? M.left
    const budget = budgets[i]
    const budgetY = budget === undefined ? undefined : y(budget)
    const base = { turn: turn.turn, kind: turn.outcome, x: left, width: x.bandwidth(), budgetY }
    if (turn.outcome === "refused") {
      const barTop = budgetY ?? baseline
      return { ...base, y: barTop, height: baseline - barTop, segments: [], overBudget: false }
    }
    let at = 0
    const segments = stacks[i]!.map((part) => {
      const lower = y(at)
      at += part.tokens
      const upper = y(at)
      return { ...part, y: upper, height: lower - upper }
    })
    const barTop = y(at)
    return {
      ...base,
      y: barTop,
      height: baseline - barTop,
      segments,
      overBudget: budget !== undefined && count(turn.inputTokens) > budget,
    }
  })

  const distinct = [...new Set(budgets.filter((b) => b !== undefined))]
  // By turn, and within a turn in the order the assembler would have met them.
  const markers = MARKER_ORDER.flatMap((kind) => {
    const at = model.firsts[kind]
    const bar = bars.find((b) => b.turn === at)
    return bar === undefined ? [] : [{ kind, turn: bar.turn, x: bar.x + bar.width / 2 }]
  }).sort((a, b) => a.turn - b.turn)

  return {
    bars,
    markers,
    budget: distinct.length === 1 ? { tokens: distinct[0]!, y: y(distinct[0]!) } : undefined,
    yTicks: y.ticks(4).map((value) => ({ value, y: y(value) })),
    baseline,
  }
}
