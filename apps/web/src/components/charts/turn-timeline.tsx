// The turn timeline (STYLE.md 6, Charts; dashboard-plan.md 7.4, 8): a session's turns as stacked
// bars by plane and rendering overhead against the budget, a refusal hatched in the accent, a
// rejected turn's place empty, a marker over the turn of each first, the selected turn outlined.
// An image named by its title and its summary; the turn table beneath carries every number.

import { useId } from "react"

import {
  firstInflection,
  FIRST_WORDS,
  type SessionModel,
} from "../../features/sessions/model/session"
import { formatCount, formatTokens } from "../../lib/format"
import { TIMELINE_MARGIN, turnTimeline } from "./turn-timeline-geometry"
import { useWidth } from "./use-width"

const HEIGHT = 240

function timelineSummary(model: SessionModel) {
  const counts = { assembled: 0, refused: 0, rejected: 0 }
  for (const turn of model.turns) counts[turn.outcome] += 1
  const outcomes = (["assembled", "refused", "rejected"] as const)
    .filter((outcome) => counts[outcome] > 0)
    .map((outcome) => `${formatCount(counts[outcome])} ${outcome}`)
    .join(", ")
  const budgets = [
    ...new Set(model.turns.flatMap((t) => (t.budget === undefined ? [] : [t.budget]))),
  ]
  const budget =
    budgets.length === 1
      ? `a budget of ${formatTokens(budgets[0])}`
      : budgets.length === 0
        ? "no budget recorded"
        : "a budget that changed between turns"
  const firsts = (Object.entries(model.firsts) as [keyof typeof FIRST_WORDS, number][])
    .sort((a, b) => a[1] - b[1])
    .map(([kind, turn]) => `first ${FIRST_WORDS[kind]} at turn ${turn}`)
  const turns = `${formatCount(model.turns.length)} ${model.turns.length === 1 ? "turn" : "turns"}`
  return (
    [`${turns} (${outcomes}) against ${budget}`, ...firsts].join("; ") +
    (firstInflection(model.firsts) ? "." : "; nothing compressed, omitted or refused.")
  )
}

export function TurnTimeline({
  model,
  selected,
  reached,
}: {
  readonly model: SessionModel
  readonly selected: number | undefined
  /** While a session is played: the turn reached, after which nothing is drawn yet. */
  readonly reached?: number | undefined
}) {
  const id = useId()
  const [ref, width] = useWidth<HTMLDivElement>(640)
  const g = turnTimeline(model, { width, height: HEIGHT })
  const shown = (turn: number) => reached === undefined || turn <= reached
  const bars = g.bars.filter((bar) => shown(bar.turn))
  const markers = g.markers.filter((marker) => shown(marker.turn))
  const M = TIMELINE_MARGIN
  return (
    <figure data-slot="turn-timeline" aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`} data-label="">
        Turns · tokens per turn against budget.input
      </figcaption>
      <div ref={ref} data-slot="chart-frame">
        <svg
          role="img"
          aria-labelledby={`${id}-title ${id}-summary`}
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
        >
          <defs>
            <pattern
              id={`${id}-hatch`}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <path d="M0 0V6" data-slot="hatch-line" />
            </pattern>
          </defs>
          <g aria-hidden="true" data-slot="axis">
            {g.yTicks.map((tick) => (
              <g key={tick.value}>
                <line x1={M.left} x2={width - M.right} y1={tick.y} y2={tick.y} />
                <text x={M.left - 6} y={tick.y} dy="0.32em" textAnchor="end">
                  {formatCount(tick.value)}
                </text>
              </g>
            ))}
          </g>
          <g aria-hidden="true">
            {bars.map((bar) => (
              <g key={bar.turn} data-turn={bar.turn} data-kind={bar.kind}>
                {bar.kind === "refused" ? (
                  <rect
                    x={bar.x}
                    y={bar.y}
                    width={bar.width}
                    height={bar.height}
                    fill={`url(#${id}-hatch)`}
                    data-refused=""
                  />
                ) : null}
                {bar.segments.map((segment) => (
                  <rect
                    key={segment.key}
                    data-segment={segment.key}
                    x={bar.x}
                    y={segment.y}
                    width={bar.width}
                    height={segment.height}
                  />
                ))}
                {g.budget === undefined && bar.budgetY !== undefined ? (
                  <line
                    data-slot="budget-rule"
                    x1={bar.x - 3}
                    x2={bar.x + bar.width + 3}
                    y1={bar.budgetY}
                    y2={bar.budgetY}
                  />
                ) : null}
                {bar.turn === selected ? (
                  <rect
                    data-slot="selected-mark"
                    x={bar.x - 3}
                    y={M.top - 4}
                    width={bar.width + 6}
                    height={g.baseline - M.top + 4}
                  />
                ) : null}
                <text
                  data-slot="axis-label"
                  x={bar.x + bar.width / 2}
                  y={g.baseline + 16}
                  textAnchor="middle"
                >
                  {bar.turn}
                </text>
              </g>
            ))}
          </g>
          {g.budget ? (
            <g aria-hidden="true">
              <line
                data-slot="budget-rule"
                x1={M.left}
                x2={width - M.right}
                y1={g.budget.y}
                y2={g.budget.y}
              />
              <text data-slot="axis-label" x={width - M.right} y={g.budget.y - 4} textAnchor="end">
                budget {formatCount(g.budget.tokens)}
              </text>
            </g>
          ) : null}
          <g aria-hidden="true">
            {markers.map((marker) => (
              <g key={marker.kind} data-marker={marker.kind} data-marker-turn={marker.turn}>
                <path d={`M${marker.x - 4} ${M.top - 12}h8l-4 6z`} />
              </g>
            ))}
          </g>
        </svg>
      </div>
      {markers.length > 0 ? (
        <ul data-slot="chart-legend" aria-label="Markers">
          {markers.map((marker) => (
            <li key={marker.kind} data-marker={marker.kind}>
              <svg aria-hidden="true" width="10" height="8" viewBox="0 0 10 8">
                <path d="M1 1h8l-4 6z" />
              </svg>{" "}
              first {FIRST_WORDS[marker.kind]} · turn {marker.turn}
            </li>
          ))}
        </ul>
      ) : null}
      <p id={`${id}-summary`} data-slot="chart-summary">
        {timelineSummary(model)}
      </p>
    </figure>
  )
}
