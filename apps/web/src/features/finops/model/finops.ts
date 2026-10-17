// FinOps (dashboard-plan.md DP-11): what the window's assembled events cost and what compression
// saved, per route, from the index. Tokens are the traces' own counts; money only where config.json
// prices a route (`prices.per_million_input_tokens.<route>`), never a figure written here. A refused
// or rejected call reaches no model, so only assembled events count.

import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"

import type { Prices } from "../../../data/config"

export interface FinopsRow {
  readonly route: string
  readonly events: number
  readonly input_tokens: number
  /** Tokens compression saved, over the events whose row says. */
  readonly saved: number
  /** How many of the events' rows say what compression saved; an older index's rows do not. */
  readonly saved_known: number
  readonly price?: number
  readonly cost?: number
  readonly saved_worth?: number
}

const perMillion = (tokens: number, price: number) => (tokens * price) / 1_000_000

export function finopsRows(index: EventsIndexV1, prices?: Prices) {
  const byRoute = new Map<
    string,
    { events: number; input_tokens: number; saved: number; saved_known: number }
  >()
  for (const row of index.events) {
    if (row.outcome !== "assembled" || row.route === undefined) continue
    const entry = byRoute.get(row.route) ?? { events: 0, input_tokens: 0, saved: 0, saved_known: 0 }
    entry.events += 1
    entry.input_tokens += row.input_tokens ?? 0
    if (row.compressed_saved !== undefined) {
      entry.saved += row.compressed_saved
      entry.saved_known += 1
    }
    byRoute.set(row.route, entry)
  }
  const routes: FinopsRow[] = [...byRoute]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([route, entry]) => {
      const price = prices?.per_million_input_tokens[route]
      return {
        route,
        ...entry,
        ...(price === undefined
          ? {}
          : {
              price,
              cost: perMillion(entry.input_tokens, price),
              saved_worth: perMillion(entry.saved, price),
            }),
      }
    })
  const sum = (key: "events" | "input_tokens" | "saved" | "saved_known") =>
    routes.reduce((n, route) => n + route[key], 0)
  const priced = routes.length > 0 && routes.every((route) => route.cost !== undefined)
  const total = {
    events: sum("events"),
    input_tokens: sum("input_tokens"),
    saved: sum("saved"),
    saved_known: sum("saved_known"),
    ...(priced
      ? {
          cost: routes.reduce((n, route) => n + route.cost!, 0),
          saved_worth: routes.reduce((n, route) => n + route.saved_worth!, 0),
        }
      : {}),
  }
  return { routes, total, currency: prices?.currency }
}
