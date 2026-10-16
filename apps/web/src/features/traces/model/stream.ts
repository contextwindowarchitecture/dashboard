// The trace stream's model (dashboard-plan.md 7.2): its filters as URL state, each validated on its
// own so an invalid value falls back to its default without disturbing the others, and the rows they
// keep. Pure: the page, and later the worker, share it.

import { IMPLEMENTATION_INDEX } from "@cwa-dashboard/contract/data"
import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { z } from "zod"

export type IndexRow = EventsIndexV1["events"][number]

const nonblank = z.string().trim().min(1)
const FIELDS = {
  outcome: z.enum(["assembled", "refused", "rejected"]),
  language: z.enum(IMPLEMENTATION_INDEX.map((entry) => entry.id) as [string, ...string[]]),
  route: nonblank,
  reason: nonblank,
  service: nonblank,
  session: nonblank,
  sort: z.enum(["newest", "oldest"]),
}

export interface StreamFilters {
  readonly outcome?: IndexRow["outcome"]
  readonly language?: string
  readonly route?: string
  readonly reason?: string
  readonly service?: string
  readonly session?: string
  readonly sort: "newest" | "oldest"
}

export const DEFAULT_FILTERS: StreamFilters = { sort: "newest" }
const KEYS = Object.keys(FIELDS) as (keyof typeof FIELDS)[]

export function parseFilters(search: URLSearchParams): StreamFilters {
  const filters: Record<string, unknown> = { ...DEFAULT_FILTERS }
  for (const key of KEYS) {
    const raw = search.get(key)
    if (raw === null) continue
    const parsed = FIELDS[key].safeParse(raw)
    if (parsed.success) filters[key] = parsed.data
  }
  return filters as unknown as StreamFilters
}

export function toSearch(filters: StreamFilters): URLSearchParams {
  const search = new URLSearchParams()
  for (const key of KEYS) {
    const value = filters[key]
    if (value !== undefined && value !== DEFAULT_FILTERS[key as keyof StreamFilters])
      search.set(key, value)
  }
  return search
}

export const isFiltered = (filters: StreamFilters) =>
  KEYS.some((key) => key !== "sort" && filters[key] !== undefined)

export function filterRows(rows: readonly IndexRow[], filters: StreamFilters): IndexRow[] {
  const kept = rows.filter(
    (row) =>
      (filters.outcome === undefined || row.outcome === filters.outcome) &&
      (filters.language === undefined || row.language === filters.language) &&
      (filters.route === undefined || row.route === filters.route) &&
      (filters.service === undefined || row.service === filters.service) &&
      (filters.session === undefined || row.session?.id === filters.session) &&
      (filters.reason === undefined ||
        row.reason_codes.includes(filters.reason) ||
        row.refused_reason === filters.reason),
  )
  const direction = filters.sort === "oldest" ? 1 : -1
  return kept.sort((a, b) =>
    a.recorded_at < b.recorded_at ? -direction : a.recorded_at > b.recorded_at ? direction : 0,
  )
}

export interface FacetOption {
  readonly value: string
  readonly count: number
}

/** A facet's values with their counts, most frequent first, then by name. */
export function facetOptions(counts: Readonly<Record<string, number | undefined>>): FacetOption[] {
  return Object.entries(counts)
    .flatMap(([value, count]) => (count === undefined ? [] : [{ value, count }]))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1))
}
