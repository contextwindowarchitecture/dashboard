// The documents derived from assembly events: the index the stream reads, the sessions, and each
// service's row of the fleet report. The generator writes them for the demo tree and the ingest
// service rebuilds them as events arrive, so both derive them here, one way. Everything is read from
// the events and the contract; nothing is estimated, and what an event cannot say is left out.

import { REASONS, SLOT_DEFAULTS } from "@cwa-dashboard/contract/data"

import type {
  AssemblyEventV1,
  EventsIndexV1,
  FleetReportV1,
  SessionV1,
} from "../generated/types.ts"

export type IndexRow = EventsIndexV1["events"][number]
export type SessionTurn = SessionV1["turns"][number]
export type ServiceRow = FleetReportV1["services"][number]

// --- reason codes in the order R-21 ranks them ---------------------------------------------------

const RANK = new Map<string, number>(REASONS.map((reason, i) => [reason.code, i]))
const rank = (code: string) =>
  RANK.get(code.startsWith("missing_field:") ? "missing_field:<name>" : code) ?? RANK.size

/** The distinct codes, in contract/reasons.json order; codes of one rank by their text. */
export function inReasonOrder(codes: Iterable<string>): string[] {
  return [...new Set(codes)].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
}

// --- index ---------------------------------------------------------------------------------------

/** One event's row in the index. */
export function indexRow(event: AssemblyEventV1): IndexRow {
  const { snapshot, trace } = event
  return {
    event_id: event.event_id,
    recorded_at: event.recorded_at,
    service: event.service.name,
    language: event.assembler.language,
    redaction_mode: event.redaction_mode,
    ...(snapshot === undefined
      ? {}
      : {
          route: snapshot.route_policy.route,
          route_policy_version: snapshot.route_policy.version,
          profile: { id: snapshot.profile.id, version: snapshot.profile.version },
          budget_input: snapshot.budget.input,
        }),
    outcome: event.outcome,
    ...(event.outcome === "refused" && trace?.refused.reason
      ? { refused_reason: trace.refused.reason }
      : {}),
    reason_codes: inReasonOrder(trace?.excluded.map((row) => row.reason) ?? []),
    ...(event.outcome === "assembled" && trace?.result
      ? { input_tokens: trace.result.input_tokens }
      : {}),
    ...(event.rejection === undefined ? {} : { problem_count: event.rejection.problems.length }),
    ...(event.session === undefined ? {} : { session: event.session }),
    total_ms: event.timings_ms.total,
  } as IndexRow
}

const count = (values: Iterable<string>) => {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

/** The index of a window's events, newest first, with the facet counts over them. */
export function buildIndex(events: readonly AssemblyEventV1[], generatedAt: string): EventsIndexV1 {
  const rows = events
    .map(indexRow)
    .sort((a, b) =>
      a.recorded_at < b.recorded_at
        ? 1
        : a.recorded_at > b.recorded_at
          ? -1
          : a.event_id < b.event_id
            ? 1
            : -1,
    )
  const reasonsOf = (row: IndexRow) =>
    new Set([...row.reason_codes, ...(row.refused_reason ? [row.refused_reason] : [])])
  return {
    $schema: "cwa-dashboard/events-index/v1",
    generated_at: generatedAt,
    window: {
      from: rows.at(-1)?.recorded_at ?? generatedAt,
      to: rows[0]?.recorded_at ?? generatedAt,
    },
    events: rows,
    facets: {
      outcome: count(rows.map((row) => row.outcome)),
      language: count(rows.map((row) => row.language)),
      route: count(rows.flatMap((row) => (row.route ? [row.route] : []))),
      reason: count(rows.flatMap((row) => [...reasonsOf(row)])),
      service: count(rows.map((row) => row.service)),
    },
  }
}

// --- sessions ------------------------------------------------------------------------------------

const PLANES = ["gov", "state", "evid", "inter"] as const
const planeOf = (slot: string) => SLOT_DEFAULTS[slot as keyof typeof SLOT_DEFAULTS]?.plane

function sessionTurn(event: AssemblyEventV1): SessionTurn {
  const index = event.session!.turn_index
  const base = { turn_index: index, event_id: event.event_id, outcome: event.outcome }
  const { trace } = event
  if (event.outcome === "rejected" || trace === undefined) return base as SessionTurn
  const by_plane = Object.fromEntries(PLANES.map((plane) => [plane, 0])) as Record<string, number>
  for (const row of trace.included) {
    const plane = planeOf(row.slot)
    if (plane !== undefined) by_plane[plane] = (by_plane[plane] ?? 0) + row.tokens
  }
  const parts = event.payload?.parts
  return {
    ...base,
    ...(event.outcome === "assembled" && trace.result
      ? { input_tokens: trace.result.input_tokens }
      : {}),
    by_plane,
    compressed_count: trace.compressed.length,
    over_budget_count: trace.excluded.filter((row) => row.reason === "over_budget").length,
    ...(event.outcome === "refused" && trace.refused.reason
      ? { refused_reason: trace.refused.reason }
      : {}),
    ...(event.outcome === "assembled" && parts !== undefined ? { parts: parts.length } : {}),
  } as SessionTurn
}

type Part = NonNullable<NonNullable<AssemblyEventV1["payload"]>["parts"]>[number]
const samePart = (a: Part, b: Part) =>
  a.section === b.section && a.id === b.id && a.sha256 === b.sha256

/** How many parts, from the first, the two payloads share. */
function leadingRun(previous: readonly Part[], current: readonly Part[]): number {
  let run = 0
  while (run < previous.length && run < current.length && samePart(previous[run]!, current[run]!))
    run += 1
  return run
}

/**
 * One document per session, its turns in turn order. A session needs one assembled or refused turn
 * to name its route and profile; one with only rejected turns has none and is left out, as is an
 * event outside any session.
 */
export function buildSessions(events: readonly AssemblyEventV1[]): SessionV1[] {
  const bySession = new Map<string, AssemblyEventV1[]>()
  for (const event of events) {
    if (event.session === undefined) continue
    const list = bySession.get(event.session.id) ?? []
    list.push(event)
    bySession.set(event.session.id, list)
  }
  const sessions: SessionV1[] = []
  for (const [id, list] of [...bySession].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const ordered = [...list].sort((a, b) => a.session!.turn_index - b.session!.turn_index)
    const named = ordered.find((event) => event.snapshot !== undefined)
    if (named === undefined) continue
    const turns: SessionTurn[] = []
    const reuse = { compared_turns: 0, reused_parts: 0, parts: 0 }
    let previous: readonly Part[] | undefined
    for (const event of ordered) {
      const row = sessionTurn(event)
      const parts = event.outcome === "assembled" ? event.payload?.parts : undefined
      if (event.outcome === "assembled") {
        if (parts !== undefined && previous !== undefined) {
          const reused = leadingRun(previous, parts)
          ;(row as { reused_parts?: number }).reused_parts = reused
          reuse.compared_turns += 1
          reuse.reused_parts += reused
          reuse.parts += parts.length
        }
        // The next turn is compared with this assembled one, whether or not it had parts.
        previous = parts
      }
      turns.push(row)
    }
    sessions.push({
      $schema: "cwa-dashboard/session/v1",
      session_id: id,
      route: named.snapshot!.route_policy.route,
      service: named.service.name,
      profile: { id: named.snapshot!.profile.id, version: named.snapshot!.profile.version },
      turns,
      part_reuse: reuse,
    })
  }
  return sessions
}

// --- the fleet's services ------------------------------------------------------------------------

/** The nearest-rank percentile of an ascending list: the smallest value with p% at or below it. */
export function percentile(sorted: readonly number[], p: number): number {
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.min(index, sorted.length - 1)]!
}

/** Each service seen in the events: its assembler, contract lock, routes and measured latency. */
export function serviceRows(events: readonly AssemblyEventV1[]): ServiceRow[] {
  const byService = new Map<string, AssemblyEventV1[]>()
  for (const event of events) {
    const list = byService.get(event.service.name) ?? []
    list.push(event)
    byService.set(event.service.name, list)
  }
  return [...byService]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, list]) => {
      const latest = [...list].sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1))[0]!
      const timings = list.map((event) => event.timings_ms.total).sort((a, b) => a - b)
      const routes = [
        ...new Set(
          list.flatMap((event) => (event.snapshot ? [event.snapshot.route_policy.route] : [])),
        ),
      ].sort()
      return {
        name,
        language: latest.assembler.language,
        assembler_version: latest.assembler.version,
        contract_lock_sha256: latest.contract.lock_sha256,
        routes,
        latency_ms:
          timings.length === 0
            ? { samples: 0 }
            : {
                samples: timings.length,
                p50: percentile(timings, 50),
                p95: percentile(timings, 95),
                p99: percentile(timings, 99),
              },
      }
    })
}
