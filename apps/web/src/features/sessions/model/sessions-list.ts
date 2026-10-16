// The sessions list (dashboard-plan.md 7.4): one row per session the index holds, with its route,
// service, turns, outcomes in turn order, the turn of each first and when it was last recorded,
// newest first. Read from the index rows alone; part reuse needs each session's document.

import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"

import type { Firsts } from "./session"

type Row = EventsIndexV1["events"][number]
type Outcome = Row["outcome"]

export interface SessionRow {
  readonly id: string
  /** The route and service its turns name; a rejected turn may name no route. */
  readonly route: string | undefined
  readonly service: string
  readonly turns: number
  readonly outcomes: readonly Outcome[]
  readonly counts: Readonly<Record<Outcome, number>>
  readonly firsts: Firsts
  readonly lastRecorded: string
}

export function sessionRows(rows: readonly Row[]): SessionRow[] {
  const bySession = new Map<string, Row[]>()
  for (const row of rows) {
    if (row.session === undefined) continue
    bySession.set(row.session.id, [...(bySession.get(row.session.id) ?? []), row])
  }
  return [...bySession]
    .map(([id, events]): SessionRow => {
      const ordered = [...events].sort((a, b) => a.session!.turn_index - b.session!.turn_index)
      const first = (test: (row: Row) => boolean) => ordered.find(test)?.session!.turn_index
      const compressed = first((r) => (r.compressed_count ?? 0) > 0)
      const overBudget = first((r) => r.reason_codes.includes("over_budget"))
      const refusal = first((r) => r.outcome === "refused")
      const counts = { assembled: 0, refused: 0, rejected: 0 }
      for (const row of ordered) counts[row.outcome] += 1
      return {
        id,
        route: ordered.find((r) => r.route !== undefined)?.route,
        service: ordered[0]!.service,
        turns: ordered.length,
        outcomes: ordered.map((r) => r.outcome),
        counts,
        firsts: {
          ...(compressed === undefined ? {} : { compressed }),
          ...(overBudget === undefined ? {} : { overBudget }),
          ...(refusal === undefined ? {} : { refusal }),
        },
        lastRecorded: ordered
          .map((r) => r.recorded_at)
          .sort()
          .at(-1)!,
      }
    })
    .sort((a, b) =>
      a.lastRecorded < b.lastRecorded ? 1 : a.lastRecorded > b.lastRecorded ? -1 : 0,
    )
}
