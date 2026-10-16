// The budget bar's geometry (STYLE.md 6, Charts; dashboard-plan.md 8): where each plane's tokens,
// their compressed share and the rendering overhead fall along budget.input, where the margin's
// limit is, and how far reserved_output reaches beyond the bar. Pure, and safe on any input: a
// refusal draws nothing, tokens over the budget are clamped to the bar and flagged, a zero budget
// divides by nothing, and a value that is not a finite, non-negative number counts as none.

import type { PlaneKey } from "../../features/traces/model/inspector"

const PLANES: readonly PlaneKey[] = ["gov", "state", "evid", "inter"]
const count = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0

export interface BudgetBarInput {
  readonly budget: {
    readonly input: number
    readonly reserved_output: number
    readonly margin_percent?: number
  }
  readonly byPlane: Record<PlaneKey, number>
  /** Of each plane's tokens, those of occurrences stepped down to a variant. */
  readonly compressedByPlane: Record<PlaneKey, number>
  /** The payload's tokens beyond its items'; undefined with no payload. */
  readonly overhead: number | undefined
  /** trace.result.input_tokens; undefined for a refusal. */
  readonly inputTokens: number | undefined
}

export type SegmentKey = PlaneKey | `${PlaneKey}-compressed` | "overhead"

export interface Segment {
  readonly key: SegmentKey
  readonly tokens: number
  /** The share of the bar's width, 0 to 100. */
  readonly percent: number
}

export interface BudgetBar {
  readonly segments: Segment[]
  readonly refused: boolean
  readonly used: number | undefined
  readonly free: number | undefined
  readonly overBudget: boolean
  /** Where the margin's limit falls, as a share of the bar; undefined without a margin. */
  readonly marginPercent: number | undefined
  /** How far reserved_output reaches beyond the bar's end, as a share of the bar's width. */
  readonly reservedPercent: number
}

export function budgetBar(input: BudgetBarInput): BudgetBar {
  const budget = count(input.budget.input)
  const reservedPercent = budget > 0 ? (count(input.budget.reserved_output) / budget) * 100 : 0
  const margin = count(input.budget.margin_percent)
  const marginPercent =
    input.budget.margin_percent === undefined ? undefined : (100 * 100) / (100 + margin)
  if (input.inputTokens === undefined) {
    return {
      segments: [],
      refused: true,
      used: undefined,
      free: undefined,
      overBudget: false,
      marginPercent,
      reservedPercent,
    }
  }
  const parts: { key: SegmentKey; tokens: number }[] = []
  for (const plane of PLANES) {
    const all = count(input.byPlane[plane])
    const compressed = Math.min(all, count(input.compressedByPlane[plane]))
    parts.push({ key: plane, tokens: all - compressed })
    parts.push({ key: `${plane}-compressed`, tokens: compressed })
  }
  parts.push({ key: "overhead", tokens: count(input.overhead) })
  const used = count(input.inputTokens)
  const drawn = parts.reduce((sum, part) => sum + part.tokens, 0)
  // Over the budget, the bar stands for what was drawn, so its segments still fill it exactly.
  const overBudget = used > budget
  const scale = overBudget || budget === 0 ? Math.max(drawn, 1) : budget
  return {
    segments: parts
      .filter((part) => part.tokens > 0)
      .map((part) => ({ ...part, percent: (part.tokens / scale) * 100 })),
    refused: false,
    used,
    free: Math.max(0, budget - used),
    overBudget,
    marginPercent,
    reservedPercent,
  }
}
