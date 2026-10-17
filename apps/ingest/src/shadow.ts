// Shadow regression (ADR-0008): what a candidate route policy or profile would change over a frozen
// corpus. Each full event's snapshot is replayed twice through the pinned assembler, as stored and
// with the candidate swapped in, so a difference between implementations is never taken for the
// candidate's effect; the baseline's parity with the recorded payload hash is reported beside it.
// Nothing here assembles: the replays are the assembler's, and the comparison reads their traces.

import { BUILT_ASSEMBLER } from "@cwa-dashboard/assembler"
import type { AssemblyEventV1, ShadowReportV1 } from "@cwa-dashboard/telemetry/types"

import type { ReplayResult } from "./replay.ts"

/** What replaces the snapshot's own: a route policy, a profile, or both, as the contract writes them. */
export interface Candidate {
  readonly route_policy?: unknown
  readonly profile?: unknown
}

type Side = NonNullable<ShadowReportV1["events"][number]["baseline"]>
type Row = ShadowReportV1["events"][number]

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function sideOf(result: ReplayResult): Side {
  if (result.status !== 200) {
    return { outcome: "rejected", excluded: {}, included: [], problems: [...result.body.problems] }
  }
  const trace = result.body.trace as {
    refused: { bool: boolean; reason?: string | null }
    result?: { input_tokens: number } | null
    excluded: { reason: string }[]
    included: { item_id: string }[]
  }
  const excluded: Record<string, number> = {}
  for (const row of trace.excluded) excluded[row.reason] = (excluded[row.reason] ?? 0) + 1
  return {
    outcome: result.body.outcome,
    ...(trace.refused.bool && trace.refused.reason ? { refused_reason: trace.refused.reason } : {}),
    ...(trace.result ? { input_tokens: trace.result.input_tokens } : {}),
    excluded,
    included: trace.included.map((occurrence) => occurrence.item_id),
  }
}

function describeCandidate(candidate: Candidate): ShadowReportV1["candidate"] {
  const policy = isObject(candidate.route_policy) ? candidate.route_policy : undefined
  const profile = isObject(candidate.profile) ? candidate.profile : undefined
  return {
    ...(policy
      ? { route_policy: { route: String(policy["route"]), version: String(policy["version"]) } }
      : {}),
    ...(profile
      ? { profile: { id: String(profile["id"]), version: Number(profile["version"]) } }
      : {}),
  }
}

export interface ShadowInputs {
  readonly candidate: Candidate
  /** The stored event, or undefined when the store no longer holds it. */
  readonly load: (eventId: string) => Promise<AssemblyEventV1 | undefined>
  readonly run: (snapshot: unknown) => Promise<ReplayResult>
  readonly generatedAt: string
}

export async function shadowReport(
  corpus: { readonly name: string; readonly event_ids: readonly string[] },
  { candidate, load, run, generatedAt }: ShadowInputs,
): Promise<ShadowReportV1> {
  const rows: Row[] = []
  // Both sides of every replayed event, unchanged ones included, for the summary.
  const sides = new Map<string, { baseline: Side; candidate: Side }>()
  for (const eventId of corpus.event_ids) {
    const event = await load(eventId)
    if (event === undefined) {
      rows.push({ event_id: eventId, status: "skipped", skipped: "missing" })
      continue
    }
    if (event.outcome === "rejected" || event.snapshot === undefined) {
      rows.push({ event_id: eventId, status: "skipped", skipped: "rejected" })
      continue
    }
    if (event.redaction_mode !== "full") {
      rows.push({ event_id: eventId, status: "skipped", skipped: "redacted" })
      continue
    }
    const baselineResult = await run(event.snapshot)
    const swapped = {
      ...event.snapshot,
      ...(candidate.route_policy === undefined ? {} : { route_policy: candidate.route_policy }),
      ...(candidate.profile === undefined ? {} : { profile: candidate.profile }),
    }
    const baseline = sideOf(baselineResult)
    const shadow = sideOf(await run(swapped))
    const recorded = event.payload?.hash ?? null
    const replayedHash = baselineResult.status === 200 ? baselineResult.body.payload_hash : null
    const parity =
      event.outcome === "assembled"
        ? replayedHash === recorded
          ? "match"
          : "differ"
        : baseline.outcome === "refused" && baseline.refused_reason === event.trace?.refused.reason
          ? "match"
          : "differ"
    const same = JSON.stringify(baseline) === JSON.stringify(shadow)
    rows.push({
      event_id: eventId,
      status: same ? "unchanged" : "changed",
      baseline_parity: parity,
      ...(same ? {} : { baseline, candidate: shadow }),
    })
    sides.set(eventId, { baseline, candidate: shadow })
  }

  const replayed = [...sides.values()]
  // Shedding and placement compare two decisions: an event either side rejected has none to compare.
  const comparable = replayed.filter(
    (s) => s.baseline.outcome !== "rejected" && s.candidate.outcome !== "rejected",
  )
  const overBudget = (side: Side) => side.excluded["over_budget"] ?? 0
  const skipped: Record<string, number> = {}
  for (const row of rows) if (row.skipped) skipped[row.skipped] = (skipped[row.skipped] ?? 0) + 1
  return {
    $schema: "cwa-dashboard/shadow-report/v1",
    generated_at: generatedAt,
    corpus: { name: corpus.name, events: corpus.event_ids.length },
    assembler: {
      language: BUILT_ASSEMBLER.language,
      name: BUILT_ASSEMBLER.name,
      version: BUILT_ASSEMBLER.version,
    },
    candidate: describeCandidate(candidate),
    summary: {
      replayed: replayed.length,
      skipped,
      changed: rows.filter((row) => row.status === "changed").length,
      refusals_added: replayed.filter(
        (s) => s.baseline.outcome === "assembled" && s.candidate.outcome === "refused",
      ).length,
      refusals_removed: replayed.filter(
        (s) => s.baseline.outcome === "refused" && s.candidate.outcome === "assembled",
      ).length,
      candidate_rejected: replayed.filter((s) => s.candidate.outcome === "rejected").length,
      shedding_change: comparable.reduce(
        (n, s) => n + overBudget(s.candidate) - overBudget(s.baseline),
        0,
      ),
      placement_changed: comparable.filter(
        (s) =>
          s.baseline.outcome === "assembled" &&
          s.candidate.outcome === "assembled" &&
          JSON.stringify(s.baseline.included) !== JSON.stringify(s.candidate.included),
      ).length,
      baseline_differs: rows.filter((row) => row.baseline_parity === "differ").length,
    },
    events: rows,
  }
}
