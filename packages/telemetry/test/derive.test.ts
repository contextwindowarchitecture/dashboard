import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { REASONS, SLOT_DEFAULTS } from "@cwa-dashboard/contract/data"
import { describe, expect, it } from "vitest"

import { buildIndex, buildSessions, indexRow, percentile, serviceRows } from "../src/derive.ts"
import { profileDigest, routePolicyDigest } from "../src/registry-digest.ts"
import type { AssemblyEventV1 } from "../generated/types.ts"
import { validateEventsIndexV1, validateSessionV1 } from "../generated/validators.js"

const vendor = resolve(import.meta.dirname, "../../contract/vendor/cwa")
const read = (path: string): unknown => JSON.parse(readFileSync(join(vendor, path), "utf8"))
const cases = readdirSync(join(vendor, "conformance/cases")).sort()

// Events built from the vendored cases' snapshots and expected traces; the envelope is written here.
let n = 0
function event(id: string, overrides: Partial<AssemblyEventV1> = {}): AssemblyEventV1 {
  n += 1
  const snapshot = read(`conformance/cases/${id}/snapshot.json`) as AssemblyEventV1["snapshot"]
  const trace = read(`conformance/cases/${id}/expected.trace.json`) as NonNullable<
    AssemblyEventV1["trace"]
  >
  const base = {
    $schema: "cwa-dashboard/assembly-event/v1" as const,
    event_id: `01JA2B3C4D5E6F7G8H9JKM${String(n).padStart(4, "0")}`,
    recorded_at: `2026-10-15T09:${String(n % 60).padStart(2, "0")}:00.000Z`,
    service: { name: "svc", environment: "demo" },
    assembler: {
      language: "typescript" as const,
      name: "@contextwindowarchitecture/assembler",
      version: "0.0.1",
    },
    contract: {
      repository: "contextwindowarchitecture/contextwindowarchitecture",
      commit: "c".repeat(40),
      lock_sha256: "d".repeat(64),
    },
    redaction_mode: "full" as const,
    timings_ms: { total: n },
  }
  const shaped = trace.refused.bool
    ? { ...base, outcome: "refused" as const, snapshot, trace }
    : {
        ...base,
        outcome: "assembled" as const,
        snapshot,
        trace,
        payload: { hash: trace.result!.hash, bytes: 100 },
      }
  return { ...shaped, ...overrides } as AssemblyEventV1
}

function rejected(id: string, overrides: Partial<AssemblyEventV1> = {}): AssemblyEventV1 {
  n += 1
  return {
    ...event("fixture-three-slot"),
    outcome: "rejected",
    snapshot: undefined,
    trace: undefined,
    payload: undefined,
    rejection: {
      problems: ["/budget is required", "/x is invalid"],
      snapshot: read(`conformance/rejections/${id}/snapshot.json`) as Record<string, unknown>,
    },
    ...overrides,
  } as AssemblyEventV1
}

describe("indexRow", () => {
  it("lists an assembled event's route, profile, tokens and reason codes in reasons.json order", () => {
    const e = event("admission-reasons")
    const row = indexRow(e)
    const order = REASONS.map((reason) => reason.code as string)
    const rank = (code: string) =>
      order.indexOf(code.startsWith("missing_field:") ? "missing_field:<name>" : code)
    expect(row).toMatchObject({
      event_id: e.event_id,
      outcome: "assembled",
      route: e.snapshot!.route_policy.route,
      route_policy_version: e.snapshot!.route_policy.version,
      profile: { id: e.snapshot!.profile.id, version: e.snapshot!.profile.version },
      input_tokens: e.trace!.result!.input_tokens,
      budget_input: e.snapshot!.budget.input,
      compressed_count: e.trace!.compressed.length,
      route_policy_sha256: routePolicyDigest(e.snapshot!.route_policy),
      profile_sha256: profileDigest(e.snapshot!.profile),
      total_ms: e.timings_ms.total,
      language: "typescript",
      redaction_mode: "full",
    })
    expect(row.reason_codes).toEqual(
      [...new Set(e.trace!.excluded.map((r) => r.reason))].sort(
        (a, b) => rank(a) - rank(b) || (a < b ? -1 : 1),
      ),
    )
    expect(row.reason_codes.length).toBeGreaterThan(5)
  })

  it("names a refusal's code and a rejection's problem count, and nothing it cannot know", () => {
    const refusal = indexRow(event("protected-over-budget"))
    expect(refusal.refused_reason).toBe("protected_content_over_budget")
    expect(refusal.input_tokens).toBeUndefined()
    const rejection = indexRow(rejected("schema-missing-budget"))
    expect(rejection).toMatchObject({ outcome: "rejected", problem_count: 2, reason_codes: [] })
    expect(rejection.route).toBeUndefined()
    expect(rejection.budget_input).toBeUndefined()
    expect(rejection.route_policy_sha256).toBeUndefined()
  })
})

describe("buildIndex", () => {
  it("lists the events newest first with facets that recount them, and validates", () => {
    const events = [
      event("fixture-three-slot"),
      event("protected-over-budget"),
      rejected("schema-missing-budget"),
      event("admission-reasons"),
    ]
    const index = buildIndex(events, "2026-10-15T23:59:59.000Z")
    expect(validateEventsIndexV1(index) ? null : validateEventsIndexV1.errors).toBeNull()
    const times = index.events.map((row) => row.recorded_at)
    expect(times).toEqual([...times].sort().reverse())
    expect(index.facets.outcome).toEqual({ assembled: 2, refused: 1, rejected: 1 })
    expect(index.facets.language).toEqual({ typescript: 4 })
    const reasonCount = Object.fromEntries(
      [
        ...new Set(
          index.events.flatMap((row) => [
            ...row.reason_codes,
            ...(row.refused_reason ? [row.refused_reason] : []),
          ]),
        ),
      ].map((code) => [
        code,
        index.events.filter((row) => row.reason_codes.includes(code) || row.refused_reason === code)
          .length,
      ]),
    )
    expect(index.facets.reason).toEqual(reasonCount)
    expect(index.window).toEqual({ from: times.at(-1), to: times[0] })
  })
})

describe("buildSessions", () => {
  const planes = (slot: string) => SLOT_DEFAULTS[slot as keyof typeof SLOT_DEFAULTS].plane

  it("orders turns, sums each plane's included tokens and counts compressions and budget omissions", () => {
    const turns = [
      event("budget-variant-choice", { session: { id: "s1", turn_index: 1 } }),
      event("budget-droppable-order", { session: { id: "s1", turn_index: 0 } }),
      event("protected-over-budget", { session: { id: "s1", turn_index: 2 } }),
    ]
    const [session] = buildSessions(turns)
    expect(validateSessionV1(session) ? null : validateSessionV1.errors).toBeNull()
    expect(session!.turns.map((t) => t.turn_index)).toEqual([0, 1, 2])
    for (const row of session!.turns) {
      const source = turns.find((t) => t.event_id === row.event_id)!
      const sums = { gov: 0, state: 0, evid: 0, inter: 0 } as Record<string, number>
      for (const inc of source.trace!.included) sums[planes(inc.slot)]! += inc.tokens
      expect(row.by_plane).toEqual(sums)
      expect(row.budget_input).toBe(source.snapshot!.budget.input)
      expect(row.compressed_count).toBe(source.trace!.compressed.length)
      expect(row.over_budget_count).toBe(
        source.trace!.excluded.filter((r) => r.reason === "over_budget").length,
      )
    }
    expect(session!.turns[2]).toMatchObject({
      outcome: "refused",
      refused_reason: "protected_content_over_budget",
      by_plane: { gov: 0, state: 0, evid: 0, inter: 0 },
    })
    expect(session!.route).toBe(turns[1]!.snapshot!.route_policy.route)
  })

  it("counts the leading parts each assembled turn shares with the previous assembled turn", () => {
    const part = (id: string, sha: string) => ({
      section: "content" as const,
      id,
      sha256: sha.repeat(64),
      bytes: 10,
    })
    const withParts = (turn: number, parts: ReturnType<typeof part>[]) => {
      const e = event("fixture-three-slot", { session: { id: "s2", turn_index: turn } })
      return { ...e, payload: { ...e.payload!, parts } } as AssemblyEventV1
    }
    const [session] = buildSessions([
      withParts(0, [part("a", "1"), part("b", "2"), part("q1", "3")]),
      event("protected-over-budget", { session: { id: "s2", turn_index: 1 } }),
      withParts(2, [part("a", "1"), part("b", "2"), part("h1", "4"), part("q2", "5")]),
      withParts(3, [part("a", "1"), part("b", "9"), part("q3", "6")]),
    ])
    expect(session!.turns.map((t) => [t.parts, t.reused_parts])).toEqual([
      [3, undefined],
      [undefined, undefined],
      [4, 2],
      [3, 1],
    ])
    expect(session!.part_reuse).toEqual({ compared_turns: 2, reused_parts: 3, parts: 7 })
    expect(validateSessionV1(session) ? null : validateSessionV1.errors).toBeNull()
  })

  it("compares nothing for turns whose payload has no parts", () => {
    const [session] = buildSessions([
      event("fixture-three-slot", { session: { id: "s3", turn_index: 0 } }),
      event("fixture-three-slot", { session: { id: "s3", turn_index: 1 } }),
    ])
    expect(session!.part_reuse).toEqual({ compared_turns: 0, reused_parts: 0, parts: 0 })
  })

  it("leaves out events with no session, and a session with no assembled or refused turn", () => {
    expect(
      buildSessions([
        event("fixture-three-slot"),
        rejected("schema-missing-budget", { session: { id: "s4", turn_index: 0 } }),
      ]),
    ).toEqual([])
  })
})

describe("serviceRows' contract files", () => {
  const ours = {
    "schema/a.json": "1".repeat(64),
    "contract/b.json": "2".repeat(64),
    "x.json": "9".repeat(64),
  }
  const known = (files: Record<string, string>) => ({
    files: ours,
    knownLocks: { ["d".repeat(64)]: files },
  })

  it("counts the files a known lock pins and names those that differ from the dashboard's or it lacks", () => {
    const events = [event("fixture-three-slot", { service: { name: "a" } })]
    expect(
      serviceRows(
        events,
        known({ "schema/a.json": "1".repeat(64), "contract/b.json": "2".repeat(64) }),
      )[0]!.contract_files,
    ).toEqual({
      pinned: 2,
      differing: [],
    })
    expect(
      serviceRows(
        events,
        known({
          "schema/a.json": "1".repeat(64),
          "contract/b.json": "3".repeat(64),
          "new.json": "4".repeat(64),
        }),
      )[0]!.contract_files,
    ).toEqual({ pinned: 3, differing: ["contract/b.json", "new.json"] })
  })

  it("leaves out what it cannot know: a lock it has not seen", () => {
    const events = [event("fixture-three-slot", { service: { name: "a" } })]
    expect(serviceRows(events, { files: ours, knownLocks: {} })[0]!.contract_files).toBeUndefined()
    expect(serviceRows(events)[0]!.contract_files).toBeUndefined()
  })
})

describe("latency", () => {
  it("takes nearest-rank percentiles", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(sorted, 50)).toBe(5)
    expect(percentile(sorted, 95)).toBe(10)
    expect(percentile([7], 99)).toBe(7)
  })

  it("summarises each service from its events, with routes and the sample count", () => {
    const events = [
      event("fixture-three-slot", { service: { name: "a" }, timings_ms: { total: 2 } }),
      event("messages-render", { service: { name: "a" }, timings_ms: { total: 4 } }),
      event("protected-over-budget", { service: { name: "b" }, timings_ms: { total: 9 } }),
    ]
    const rows = serviceRows(events)
    expect(rows.map((row) => row.name)).toEqual(["a", "b"])
    expect(rows[0]).toMatchObject({
      language: "typescript",
      assembler_version: "0.0.1",
      contract_commit: "c".repeat(40),
      contract_lock_sha256: "d".repeat(64),
      routes: [
        ...new Set([
          events[0]!.snapshot!.route_policy.route,
          events[1]!.snapshot!.route_policy.route,
        ]),
      ].sort(),
      latency_ms: { samples: 2, p50: 2, p95: 4, p99: 4 },
    })
  })
})

it("covers every vendored case without throwing", () => {
  const index = buildIndex(
    cases.map((id) => event(id)),
    "2026-10-15T23:59:59.000Z",
  )
  expect(index.events).toHaveLength(65)
})
