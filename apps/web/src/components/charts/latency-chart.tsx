// Service latency (dashboard-plan.md 7.7, 8): each service's P50, P95 and P99 on a log axis, as its
// wrapper measured them around the whole assemble() call, with n beside each row. An image named by
// its title and summary; the services table above carries every number.

import { useId } from "react"

import { formatCount, formatMs } from "../../lib/format"
import {
  LATENCY_MARGIN,
  latencyGeometry,
  type LatencyInput,
  type Percentile,
} from "./latency-geometry"
import { useWidth } from "./use-width"

const ROW = 28
const SHAPE: Record<Percentile, (x: number, y: number) => React.JSX.Element> = {
  p50: (x, y) => <circle cx={x} cy={y} r={4} />,
  p95: (x, y) => <rect x={x - 4} y={y - 4} width={8} height={8} />,
  p99: (x, y) => <polygon points={`${x},${y - 5} ${x + 5},${y} ${x},${y + 5} ${x - 5},${y}`} />,
}

export function LatencyChart({ rows }: { readonly rows: readonly LatencyInput[] }) {
  const id = useId()
  const [ref, width] = useWidth<HTMLDivElement>(640)
  const g = latencyGeometry(rows, { width, rowHeight: ROW })
  const measured = rows.filter((row) => row.latency !== undefined)
  const slowest = [...measured].sort((a, b) => b.latency!.p99 - a.latency!.p99)[0]
  const summary =
    measured.length === 0
      ? "No service measured a call in this report."
      : `${formatCount(measured.length)} of ${formatCount(rows.length)} services measured; the slowest P99 is ${slowest!.name} at ${formatMs(slowest!.latency!.p99)}. These are the wrappers' measurements around assemble(), not the model's.`
  const M = LATENCY_MARGIN
  return (
    <figure data-slot="latency-chart" aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`} data-label="">
        Latency · P50, P95 and P99 per service, ms on a log axis
      </figcaption>
      <div ref={ref} data-slot="chart-frame">
        <svg
          role="img"
          aria-labelledby={`${id}-title ${id}-summary`}
          width={width}
          height={g.height}
          viewBox={`0 0 ${width} ${g.height}`}
        >
          <g aria-hidden="true" data-slot="axis">
            {g.ticks.map((tick) => (
              <g key={tick.value}>
                <line x1={tick.x} x2={tick.x} y1={M.top - 8} y2={g.height - M.bottom} />
                <text x={tick.x} y={g.height - M.bottom + 16} textAnchor="middle">
                  {formatMs(tick.value)}
                </text>
              </g>
            ))}
          </g>
          <g aria-hidden="true">
            {g.rows.map((row) => (
              <g key={row.name} data-service={row.name}>
                <text x={M.left - 10} y={row.y} dy="0.32em" textAnchor="end">
                  {row.name} · n {formatCount(row.samples)}
                </text>
                {row.dots ? (
                  <>
                    <line
                      data-slot="latency-span"
                      x1={row.dots[0]!.x}
                      x2={row.dots[2]!.x}
                      y1={row.y}
                      y2={row.y}
                    />
                    {row.dots.map((dot) => (
                      <g
                        key={dot.key}
                        data-percentile={dot.key}
                        data-clamped={dot.clamped ? "" : undefined}
                      >
                        {SHAPE[dot.key](dot.x, row.y)}
                      </g>
                    ))}
                  </>
                ) : (
                  <text x={M.left} y={row.y} dy="0.32em">
                    not measured
                  </text>
                )}
              </g>
            ))}
          </g>
        </svg>
      </div>
      <ul data-slot="chart-legend" aria-label="Percentiles">
        {(["p50", "p95", "p99"] as const).map((key) => (
          <li key={key} data-percentile={key}>
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
              {SHAPE[key](6, 6)}
            </svg>{" "}
            {key.toUpperCase()}
          </li>
        ))}
      </ul>
      <p id={`${id}-summary`} data-slot="chart-summary">
        {summary}
      </p>
    </figure>
  )
}
