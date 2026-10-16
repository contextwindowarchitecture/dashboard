// Settle the replay (STYLE.md 7, Choreographies): where each of the replay's budget bar segments
// starts, the width it had in the recorded assembly or nothing, and the recorded segments the replay
// no longer has, drawn as ghosts that collapse. Widths come from the budget bar's own geometry over
// each assembly's trace; nothing is computed that the assembler did not decide.

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"

import { budgetBar, type SegmentKey } from "../../../components/charts/budget-bar-geometry"
import { planeTotals } from "../../traces/model/inspector"

export interface Settle {
  /** Each segment's starting width, as a share of the bar, the replay's and the ghosts'. */
  readonly from: Partial<Record<SegmentKey, number>>
  /** Segments the recording had and the replay does not, which collapse to nothing. */
  readonly ghosts: readonly SegmentKey[]
}

type Assembly = Pick<AssemblyEventV1, "snapshot" | "trace">

function widths(assembly: Assembly): Map<SegmentKey, number> {
  const { trace, snapshot } = assembly
  if (trace === undefined || snapshot === undefined) return new Map()
  const totals = planeTotals(trace)
  const bar = budgetBar({
    budget: snapshot.budget,
    byPlane: totals.byPlane,
    compressedByPlane: totals.compressedByPlane,
    overhead: totals.overhead,
    inputTokens: trace.result?.input_tokens,
  })
  return new Map(bar.segments.map((segment) => [segment.key, segment.percent]))
}

/** The settle from the recorded assembly to the replay's; undefined when nothing was recorded. */
export function settle(recorded: Assembly, replayed: Assembly): Settle | undefined {
  if (recorded.trace === undefined || recorded.snapshot === undefined) return undefined
  const before = widths(recorded)
  const after = widths(replayed)
  const from: Partial<Record<SegmentKey, number>> = {}
  for (const key of after.keys()) from[key] = before.get(key) ?? 0
  const ghosts = [...before.keys()].filter((key) => !after.has(key))
  for (const key of ghosts) from[key] = before.get(key)!
  return { from, ghosts }
}
