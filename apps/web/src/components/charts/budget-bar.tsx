// The budget bar (STYLE.md 6, Charts; dashboard-plan.md 7.3): how an assembly spent budget.input,
// plane by plane, with the compressed share at half strength, the rendering overhead, the margin's
// limit and the output reserve beyond the bar's end. An image named by its title and its summary,
// with the same numbers in a table beneath. It computes nothing the assembler did not decide.

import { MODEL } from "@cwa-dashboard/contract/data"
import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import { useId } from "react"

import { type PlaneKey, planeTotals } from "../../features/traces/model/inspector"
import { formatCount, formatTokens } from "../../lib/format"
import { budgetBar, type SegmentKey } from "./budget-bar-geometry"

const PLANE_KEYS: readonly PlaneKey[] = ["gov", "state", "evid", "inter"]
const planeName = (key: PlaneKey) =>
  MODEL.planes.find((plane) => plane.id.startsWith(key))?.name ?? key

export function BudgetBar({
  event,
  ghosts = [],
}: {
  readonly event: AssemblyEventV1
  /** Segments to draw at no width, so a choreography can collapse them (the sandbox's settle). */
  readonly ghosts?: readonly SegmentKey[]
}) {
  const id = useId()
  const trace = event.trace!
  const budget = event.snapshot!.budget
  const totals = planeTotals(trace)
  const bar = budgetBar({
    budget,
    byPlane: totals.byPlane,
    compressedByPlane: totals.compressedByPlane,
    overhead: totals.overhead,
    inputTokens: trace.result?.input_tokens,
  })
  const compressed = Object.values(totals.compressedByPlane).reduce((a, b) => a + b, 0)
  const summary = bar.refused
    ? `The assembly refused: nothing was rendered against a budget of ${formatTokens(budget.input)}; ${formatTokens(budget.reserved_output)} reserved for output.`
    : [
        `${formatCount(bar.used)} of ${formatCount(budget.input)} tokens used`,
        `${formatTokens(compressed)} as summaries`,
        `${formatTokens(totals.overhead)} of rendering overhead`,
        bar.overBudget ? "over the budget" : `${formatTokens(bar.free)} free`,
        `${formatTokens(budget.reserved_output)} reserved for output`,
      ].join("; ") + "."
  const reserve = bar.reservedPercent
  return (
    <figure data-slot="budget" aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`} data-label="">
        Budget · tokens of budget.input
      </figcaption>
      <div role="img" aria-labelledby={`${id}-title ${id}-summary`} data-slot="budget-track">
        <div data-slot="budget-bar" style={{ flexBasis: `${(100 / (100 + reserve)) * 100}%` }}>
          {bar.segments.map((segment) => (
            <span
              key={segment.key}
              data-segment={segment.key}
              style={{ flexBasis: `${segment.percent}%` }}
            />
          ))}
          {ghosts.map((key) => (
            <span
              key={`ghost-${key}`}
              aria-hidden="true"
              data-segment={key}
              data-ghost=""
              style={{ flexBasis: "0%" }}
            />
          ))}
          {bar.marginPercent !== undefined ? (
            <span aria-hidden="true" data-slot="budget-margin">
              <span style={{ flexBasis: `${bar.marginPercent}%` }} />
            </span>
          ) : null}
        </div>
        {reserve > 0 ? (
          <div
            data-slot="budget-reserve"
            style={{ flexBasis: `${(reserve / (100 + reserve)) * 100}%` }}
          />
        ) : null}
      </div>
      <p id={`${id}-summary`} data-slot="chart-summary">
        {summary}
      </p>
      <table aria-label="Budget by plane" data-slot="chart-table">
        <thead>
          <tr>
            <th scope="col">Plane</th>
            <th scope="col" data-numeric="">
              Tokens
            </th>
            <th scope="col" data-numeric="">
              As summaries
            </th>
          </tr>
        </thead>
        <tbody>
          {PLANE_KEYS.map((key) => (
            <tr key={key}>
              <th scope="row">{planeName(key)}</th>
              <td data-numeric="">{formatCount(totals.byPlane[key])}</td>
              <td data-numeric="">{formatCount(totals.compressedByPlane[key])}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Rendering overhead</th>
            <td data-numeric="">{formatCount(totals.overhead)}</td>
            <td data-numeric="" />
          </tr>
          <tr>
            <th scope="row">Budget</th>
            <td data-numeric="">{formatCount(budget.input)}</td>
            <td data-numeric="" />
          </tr>
        </tbody>
      </table>
    </figure>
  )
}
