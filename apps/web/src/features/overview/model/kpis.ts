// The overview's numbers (dashboard-plan.md 7.1), from the index's rows and nothing else. Rates are
// over the events that reached fitting (assembled or refused); with none, a rate is undefined and
// the page says "Not available", never 0.

import { REASONS } from "@cwa-dashboard/contract/data"
import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"

type Row = EventsIndexV1["events"][number]

const KIND = new Map<string, string>(REASONS.map((reason) => [reason.code, reason.kind]))
const kindOf = (code: string) =>
  KIND.get(code.startsWith("missing_field:") ? "missing_field:<name>" : code)
const TOP = 6

export interface CodeCount {
  readonly code: string
  /** Events whose trace records the code. */
  readonly events: number
}

export interface Kpis {
  readonly events: number
  readonly assembled: number
  readonly refused: number
  readonly rejected: number
  readonly refusalRate: number | undefined
  readonly sheddingRate: number | undefined
  readonly compressionRate: number | undefined
  readonly refusalsByCode: CodeCount[]
  readonly exclusionsByCode: {
    readonly top: CodeCount[]
    readonly otherCodes: number
    readonly otherEvents: number
  }
}

const byCount = (counts: Map<string, number>): CodeCount[] =>
  [...counts]
    .map(([code, events]) => ({ code, events }))
    .sort((a, b) => b.events - a.events || (a.code < b.code ? -1 : 1))

export function kpis(rows: readonly Row[]): Kpis {
  const of = (outcome: Row["outcome"]) => rows.filter((row) => row.outcome === outcome).length
  const fitted = rows.filter((row) => row.outcome !== "rejected")
  const rate = (n: number) => (fitted.length === 0 ? undefined : n / fitted.length)
  const refusals = new Map<string, number>()
  const exclusions = new Map<string, number>()
  for (const row of rows) {
    if (row.refused_reason)
      refusals.set(row.refused_reason, (refusals.get(row.refused_reason) ?? 0) + 1)
    for (const code of row.reason_codes) {
      if (kindOf(code) === "exclusion") exclusions.set(code, (exclusions.get(code) ?? 0) + 1)
    }
  }
  const ranked = byCount(exclusions)
  const rest = ranked.slice(TOP)
  return {
    events: rows.length,
    assembled: of("assembled"),
    refused: of("refused"),
    rejected: of("rejected"),
    refusalRate: rate(of("refused")),
    sheddingRate: rate(fitted.filter((row) => row.reason_codes.includes("over_budget")).length),
    compressionRate: rate(fitted.filter((row) => (row.compressed_count ?? 0) > 0).length),
    refusalsByCode: byCount(refusals),
    exclusionsByCode: {
      top: ranked.slice(0, TOP),
      otherCodes: rest.length,
      otherEvents: rows.filter((row) =>
        row.reason_codes.some((code) => rest.some((r) => r.code === code)),
      ).length,
    },
  }
}
