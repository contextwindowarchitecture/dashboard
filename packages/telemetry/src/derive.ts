// The documents derived from assembly events: the index the stream reads, the sessions, and each
// service's row of the fleet report. The generator writes them for the demo tree and the ingest
// service rebuilds them as events arrive, so both derive them here, one way. Everything is read from
// the events and the contract; nothing is estimated, and what an event cannot say is left out.

import { REASONS, SLOT_DEFAULTS } from "@cwa-dashboard/contract/data"
import { IMPLEMENTATIONS } from "@cwa-dashboard/contract/implementations"

import type {
  AssemblyEventV1,
  EventsIndexV1,
  FleetReportV1,
  SessionV1,
  SourcesReportV1,
} from "../generated/types.ts"
import { profileDigest, routePolicyDigest } from "./registry-digest.ts"

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
          route_policy_sha256: routePolicyDigest(snapshot.route_policy),
          profile_sha256: profileDigest(snapshot.profile),
          budget_input: snapshot.budget.input,
          compressed_count: trace?.compressed.length ?? 0,
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

const newestFirst = (a: IndexRow, b: IndexRow) =>
  a.recorded_at < b.recorded_at
    ? 1
    : a.recorded_at > b.recorded_at
      ? -1
      : a.event_id < b.event_id
        ? 1
        : -1

/** The index of a window's rows, newest first, with the facet counts over them. */
export function indexFromRows(rows: readonly IndexRow[], generatedAt: string): EventsIndexV1 {
  const ordered = [...rows].sort(newestFirst)
  const reasonsOf = (row: IndexRow) =>
    new Set([...row.reason_codes, ...(row.refused_reason ? [row.refused_reason] : [])])
  return {
    $schema: "cwa-dashboard/events-index/v1",
    generated_at: generatedAt,
    window: {
      from: ordered.at(-1)?.recorded_at ?? generatedAt,
      to: ordered[0]?.recorded_at ?? generatedAt,
    },
    events: ordered,
    facets: {
      outcome: count(ordered.map((row) => row.outcome)),
      language: count(ordered.map((row) => row.language)),
      route: count(ordered.flatMap((row) => (row.route ? [row.route] : []))),
      reason: count(ordered.flatMap((row) => [...reasonsOf(row)])),
      service: count(ordered.map((row) => row.service)),
    },
  }
}

/** The index of a window's events, newest first, with the facet counts over them. */
export function buildIndex(events: readonly AssemblyEventV1[], generatedAt: string): EventsIndexV1 {
  return indexFromRows(events.map(indexRow), generatedAt)
}

/**
 * The current window and the closed ones (dashboard-plan.md 3): the rows within `hours` of the
 * newest, at most `max` of them, stay current; every other row closes into its UTC day, newest day
 * first.
 */
export function windowRows(
  rows: readonly IndexRow[],
  { hours, max }: { readonly hours: number; readonly max: number },
): { current: IndexRow[]; closed: Map<string, IndexRow[]> } {
  const ordered = [...rows].sort(newestFirst)
  const newest = ordered[0]
  const since = newest === undefined ? 0 : Date.parse(newest.recorded_at) - hours * 3_600_000
  const current: IndexRow[] = []
  const closed = new Map<string, IndexRow[]>()
  for (const row of ordered) {
    if (current.length < max && Date.parse(row.recorded_at) >= since) {
      current.push(row)
      continue
    }
    // The UTC day, whatever offset the wrapper wrote the instant with.
    const day = new Date(row.recorded_at).toISOString().slice(0, 10)
    closed.set(day, [...(closed.get(day) ?? []), row])
  }
  return { current, closed }
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
    budget_input: event.snapshot!.budget.input,
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

/** The dashboard's contract files and the locks the writer knows, each by path with its SHA-256. */
export interface ContractFiles {
  readonly files: Readonly<Record<string, string>>
  /** By the SHA-256 of the lock's bytes, as events carry it. */
  readonly knownLocks: Readonly<Record<string, Readonly<Record<string, string>>>>
}

function compareFiles(lockSha256: string, contract: ContractFiles | undefined) {
  const pinned = contract?.knownLocks[lockSha256]
  if (pinned === undefined) return undefined
  const paths = Object.keys(pinned).sort()
  return {
    pinned: paths.length,
    differing: paths.filter((path) => contract!.files[path] !== pinned[path]),
  }
}

/** What the fleet report reads of an event: enough to keep for every event a store holds. */
export type FleetFacts = Pick<
  AssemblyEventV1,
  "service" | "recorded_at" | "assembler" | "contract" | "timings_ms"
> & { readonly snapshot?: { readonly route_policy: { readonly route: string } } }

/** An event's fleet facts and nothing else. */
export function fleetFacts(event: AssemblyEventV1): FleetFacts {
  return {
    service: event.service,
    recorded_at: event.recorded_at,
    assembler: event.assembler,
    contract: event.contract,
    timings_ms: event.timings_ms,
    ...(event.snapshot
      ? { snapshot: { route_policy: { route: event.snapshot.route_policy.route } } }
      : {}),
  }
}

/** Each service seen in the events: its assembler, contract lock, routes and measured latency. */
export function serviceRows(events: readonly FleetFacts[], contract?: ContractFiles): ServiceRow[] {
  const byService = new Map<string, FleetFacts[]>()
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
        contract_commit: latest.contract.commit,
        contract_lock_sha256: latest.contract.lock_sha256,
        ...(() => {
          const files = compareFiles(latest.contract.lock_sha256, contract)
          return files === undefined ? {} : { contract_files: files }
        })(),
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

/** What the fleet report needs besides the events, each known to its writer only. */
export interface FleetInputs {
  readonly generatedAt: string
  /** The specification repository and commit the dashboard's contract lock pins. */
  readonly contract: { readonly repository: string; readonly commit: string }
  /** The dashboard's contract files, and the assembler locks the writer can compare with them. */
  readonly contractFiles: ContractFiles
  /** The TypeScript assembler's tokenizer and renderer ids, which only its build exports. */
  readonly typescriptTables?: {
    readonly tokenizers: readonly string[]
    readonly renderers: readonly string[]
  }
}

/**
 * The fleet report: every implementation's published conformance run, from the vendored reports,
 * and every service the events name, from the events. The generator, the tree store and the
 * PostgreSQL store build it here, one way.
 */
export function fleetReport(events: readonly FleetFacts[], inputs: FleetInputs): FleetReportV1 {
  return {
    $schema: "cwa-dashboard/fleet-report/v1",
    generated_at: inputs.generatedAt,
    contract: { repository: inputs.contract.repository, commit: inputs.contract.commit },
    implementations: IMPLEMENTATIONS.map((implementation) => ({
      language: implementation.id as FleetReportV1["implementations"][number]["language"],
      name: implementation.report.implementation.name,
      version: implementation.report.implementation.version,
      source: {
        repository: implementation.source.repository,
        commit: implementation.source.commit,
        dirty: implementation.source.dirty,
      },
      report: implementation.report,
      // Known only where the implementation says: the built TypeScript assembler exports its tables.
      ...(implementation.id === "typescript" && inputs.typescriptTables !== undefined
        ? {
            tokenizers: [...inputs.typescriptTables.tokenizers].sort(),
            renderers: [...inputs.typescriptTables.renderers].sort(),
          }
        : {}),
    })),
    services: serviceRows(events, inputs.contractFiles),
  }
}

// --- the sources report ------------------------------------------------------------------------

type SourceRow = SourcesReportV1["producers"][number]
type Excluded = SourceRow["excluded"][number]

/** One event's counts per producer: enough to keep for every event a store holds. */
export interface SourceFacts {
  readonly recorded_at: string
  /** The producers of an assembled or refused event, with what became of their items. */
  readonly producers: readonly Omit<SourceRow, "events" | "rejected_events">[]
  /** The producers of a snapshot rejected before assembly. */
  readonly rejected: readonly { readonly id: string; readonly kind: string }[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// A batch's producer as it names itself, when the batch is well formed enough to.
function producerOfBatch(batch: unknown) {
  if (!isObject(batch) || !isObject(batch["producer"])) return undefined
  const { id, kind } = batch["producer"]
  return typeof id === "string" && typeof kind === "string" ? { id, kind } : undefined
}

/**
 * An event's source facts. Each item belongs to the batch that holds it (the first, if two hold the
 * same id), or that reports excluding it; a candidate with a blank id is recorded as
 * "{producer}#invalid-{n}" (conformance/README.md).
 */
export function sourceFacts(event: AssemblyEventV1): SourceFacts {
  if (event.trace === undefined || event.snapshot === undefined) {
    const batches = isObject(event.rejection?.snapshot) ? event.rejection!.snapshot["batches"] : []
    const seen = new Map<string, { id: string; kind: string }>()
    for (const batch of Array.isArray(batches) ? batches : []) {
      const producer = producerOfBatch(batch)
      if (producer !== undefined) seen.set(`${producer.id} ${producer.kind}`, producer)
    }
    return { recorded_at: event.recorded_at, producers: [], rejected: [...seen.values()] }
  }
  type Counts = {
    id: string
    kind: string
    submitted: number
    admitted: Set<string>
    compressed: Set<string>
    tokens: number
    excluded: Map<string, number>
  }
  const counts = new Map<string, Counts>()
  const byItem = new Map<string, Counts>()
  const reported = new Map<string, Counts>()
  const byProducerId = new Map<string, Counts>()
  for (const batch of event.snapshot.batches) {
    const producer = producerOfBatch(batch)!
    const key = `${producer.id} ${producer.kind}`
    const entry = counts.get(key) ?? {
      ...producer,
      submitted: 0,
      admitted: new Set<string>(),
      compressed: new Set<string>(),
      tokens: 0,
      excluded: new Map<string, number>(),
    }
    counts.set(key, entry)
    byProducerId.set(producer.id, entry)
    for (const item of batch.items) {
      entry.submitted += 1
      const id = isObject(item) ? item["id"] : undefined
      if (typeof id === "string" && !byItem.has(id)) byItem.set(id, entry)
    }
    for (const row of batch.excluded) reported.set(row.item_id, entry)
  }
  const ownerOf = (itemId: string) =>
    byItem.get(itemId) ??
    reported.get(itemId) ??
    (itemId.includes("#invalid-")
      ? byProducerId.get(itemId.slice(0, itemId.lastIndexOf("#invalid-")))
      : undefined)
  for (const occurrence of event.trace.included) {
    const owner = ownerOf(occurrence.item_id)
    if (owner === undefined) continue
    owner.admitted.add(occurrence.item_id)
    owner.tokens += occurrence.tokens
  }
  for (const row of event.trace.compressed) ownerOf(row.item_id)?.compressed.add(row.item_id)
  for (const row of event.trace.excluded) {
    const owner = ownerOf(row.item_id)
    if (owner === undefined) continue
    const key = `${row.reason}\u0000${row.stage}`
    owner.excluded.set(key, (owner.excluded.get(key) ?? 0) + 1)
  }
  return {
    recorded_at: event.recorded_at,
    producers: [...counts.values()].map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      submitted: entry.submitted,
      admitted: entry.admitted.size,
      compressed: entry.compressed.size,
      included_tokens: entry.tokens,
      excluded: [...entry.excluded].map(([key, items]) => {
        const [reason, stage] = key.split("\u0000") as [string, Excluded["stage"]]
        return { reason, stage, items }
      }),
    })),
    rejected: [],
  }
}

/** The sources report over the given events' facts: the current window's, as the index's. */
export function sourcesFromFacts(
  facts: readonly SourceFacts[],
  generatedAt: string,
): SourcesReportV1 {
  const rows = new Map<string, SourceRow & { excludedBy: Map<string, number> }>()
  const row = (id: string, kind: string) => {
    const key = `${id} ${kind}`
    const existing = rows.get(key)
    if (existing !== undefined) return existing
    const created = {
      id,
      kind,
      events: 0,
      submitted: 0,
      admitted: 0,
      compressed: 0,
      included_tokens: 0,
      excluded: [],
      rejected_events: 0,
      excludedBy: new Map<string, number>(),
    }
    rows.set(key, created)
    return created
  }
  for (const fact of facts) {
    for (const producer of fact.producers) {
      const target = row(producer.id, producer.kind)
      target.events += 1
      target.submitted += producer.submitted
      target.admitted += producer.admitted
      target.compressed += producer.compressed
      target.included_tokens += producer.included_tokens
      for (const { reason, stage, items } of producer.excluded) {
        const key = `${reason}\u0000${stage}`
        target.excludedBy.set(key, (target.excludedBy.get(key) ?? 0) + items)
      }
    }
    for (const producer of fact.rejected) row(producer.id, producer.kind).rejected_events += 1
  }
  const times = facts.map((fact) => fact.recorded_at).sort()
  const stageRank = (stage: string) => (stage === "producer" ? 0 : 1)
  return {
    $schema: "cwa-dashboard/sources-report/v1",
    generated_at: generatedAt,
    window: {
      from: times[0] ?? generatedAt,
      to: times.at(-1) ?? generatedAt,
      events: facts.length,
    },
    producers: [...rows.values()]
      .sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0,
      )
      .map(({ excludedBy, ...rest }) => ({
        ...rest,
        excluded: [...excludedBy]
          .map(([key, items]) => {
            const [reason, stage] = key.split("\u0000") as [string, Excluded["stage"]]
            return { reason, stage, items }
          })
          .sort(
            (a, b) => rank(a.reason) - rank(b.reason) || stageRank(a.stage) - stageRank(b.stage),
          ),
      })),
  }
}

/** The sources report over the given events: the current window's, as the index's. */
export function sourcesReport(
  events: readonly AssemblyEventV1[],
  generatedAt: string,
): SourcesReportV1 {
  return sourcesFromFacts(events.map(sourceFacts), generatedAt)
}
