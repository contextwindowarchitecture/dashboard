// The latency chart's geometry (dashboard-plan.md 7.7, 8): one row per service, its wrapper's P50,
// P95 and P99 as dots on a log axis whose domain is the whole decades that cover every value, with a
// tick at each decade. Pure and finite on any input: no services, unmeasured ones (a row, no dots),
// one value, and a value a log axis cannot place (at or below zero), drawn at the axis's start and
// flagged.

import { scaleLog } from "d3-scale"

export const LATENCY_MARGIN = { top: 24, right: 16, bottom: 28, left: 168 } as const

export type Percentile = "p50" | "p95" | "p99"
const PERCENTILES: readonly Percentile[] = ["p50", "p95", "p99"]

export interface LatencyInput {
  readonly name: string
  readonly latency: { samples: number; p50: number; p95: number; p99: number } | undefined
}

export interface LatencyDot {
  readonly key: Percentile
  readonly value: number
  readonly x: number
  /** The value is not positive, so it is drawn at the axis's start. */
  readonly clamped: boolean
}

export interface LatencyRow {
  readonly name: string
  readonly samples: number
  /** The row's centre line. */
  readonly y: number
  readonly dots: readonly LatencyDot[] | undefined
}

const placeable = (value: number) => Number.isFinite(value) && value > 0

export function latencyGeometry(
  rows: readonly LatencyInput[],
  size: { readonly width: number; readonly rowHeight: number },
) {
  const M = LATENCY_MARGIN
  const values = rows.flatMap((row) =>
    row.latency ? PERCENTILES.map((key) => row.latency![key]).filter(placeable) : [],
  )
  const lo = values.length > 0 ? Math.min(...values) : 1
  const hi = values.length > 0 ? Math.max(...values) : 10
  const from = 10 ** Math.floor(Math.log10(lo))
  const to = Math.max(10 ** Math.ceil(Math.log10(hi)), from * 10)
  const domain: [number, number] = [from, to]
  const right = Math.max(M.left + 1, size.width - M.right)
  const x = scaleLog().domain(domain).range([M.left, right])
  const decades = Math.round(Math.log10(to / from))
  const ticks = Array.from({ length: decades + 1 }, (_, i) => {
    // Rounded to the decade's own precision, so 0.1 * 10 ** -1 reads 0.01, not 0.010000000000000002.
    const value = Number((from * 10 ** i).toPrecision(1))
    return { value, x: x(value) }
  })
  return {
    domain: [ticks[0]!.value, ticks.at(-1)!.value] as [number, number],
    ticks,
    height: M.top + rows.length * size.rowHeight + M.bottom,
    rows: rows.map((row, i): LatencyRow => ({
      name: row.name,
      samples: row.latency?.samples ?? 0,
      y: M.top + i * size.rowHeight + size.rowHeight / 2,
      dots: row.latency
        ? PERCENTILES.map((key) => {
            const value = row.latency![key]
            const clamped = !placeable(value)
            return { key, value, clamped, x: clamped ? M.left : x(value) }
          })
        : undefined,
    })),
  }
}
