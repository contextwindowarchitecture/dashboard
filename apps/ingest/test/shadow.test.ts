// The shadow core (ADR-0008): a candidate swapped into each full event's snapshot, both sides
// replayed through the pinned assembler, compared. Real events from the demo tree and real profiles
// from the contract's registry as candidates.

import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { validateShadowReportV1 } from "@cwa-dashboard/telemetry/validators"
import { describe, expect, it } from "vitest"

import { replay } from "../src/replay.ts"
import { shadowReport } from "../src/shadow.ts"

const TREE = resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures")
const index = JSON.parse(readFileSync(join(TREE, "events/index.json"), "utf8")) as EventsIndexV1
const event = (id: string) =>
  JSON.parse(readFileSync(join(TREE, "events", `${id}.json`), "utf8")) as AssemblyEventV1
const ids = (test: (row: EventsIndexV1["events"][number]) => boolean) =>
  index.events.filter(test).map((row) => row.event_id)

const CHAT = ids(
  (r) =>
    r.route === "support-chat" &&
    r.profile?.id === "cache-first-chat" &&
    r.redaction_mode === "full",
)
const SCRUBBED = ids((r) => r.redaction_mode === "pii_scrubbed")[0]!
const REJECTED = ids((r) => r.outcome === "rejected")[0]!
const MISSING = "01M5ZZZZZZZZZZZZZZZZZZZZZY"
const CORPUS = [...CHAT, SCRUBBED, REJECTED, MISSING]
const load = async (id: string) => (id === MISSING ? undefined : event(id))
const run = async (snapshot: unknown) => replay(snapshot)
const profile = (id: string) => REGISTRY.profiles.find((p) => p.id === id)!
const AT = "2026-10-17T12:00:00.000Z"
const shadow = (candidate: Parameters<typeof shadowReport>[1]["candidate"]) =>
  shadowReport({ name: "chat", event_ids: CORPUS }, { candidate, load, run, generatedAt: AT })

describe("shadowReport", () => {
  it("changes nothing when the candidate is what the snapshots already ran", async () => {
    const own = event(CHAT[0]!).snapshot!.profile
    const report = await shadow({ profile: own })
    expect(validateShadowReportV1(report) ? null : validateShadowReportV1.errors).toBeNull()
    expect(report.summary).toMatchObject({
      replayed: CHAT.length,
      changed: 0,
      refusals_added: 0,
      shedding_change: 0,
    })
    expect(
      report.events
        .filter((e) => e.status === "unchanged")
        .every((e) => e.baseline_parity === "match"),
    ).toBe(true)
  })

  it("skips what cannot be replayed faithfully, saying why, and a missing event", async () => {
    const report = await shadow({ profile: event(CHAT[0]!).snapshot!.profile })
    expect(report.summary.skipped).toEqual({ redacted: 1, rejected: 1, missing: 1 })
    const why = Object.fromEntries(
      report.events.filter((e) => e.status === "skipped").map((e) => [e.event_id, e.skipped]),
    )
    expect(why).toEqual({ [SCRUBBED]: "redacted", [REJECTED]: "rejected", [MISSING]: "missing" })
    expect(report.corpus).toEqual({ name: "chat", events: CORPUS.length })
  })

  it("shows a profile bound to the same route and policy moving content, with both sides", async () => {
    const report = await shadow({ profile: profile("policy-first-chat") })
    expect(validateShadowReportV1(report) ? null : validateShadowReportV1.errors).toBeNull()
    expect(report.candidate).toEqual({ profile: { id: "policy-first-chat", version: 1 } })
    expect(report.summary.changed).toBeGreaterThan(0)
    expect(report.summary.placement_changed).toBeGreaterThan(0)
    const changed = report.events.find((e) => e.status === "changed")!
    expect(changed.baseline!.included).not.toEqual(changed.candidate!.included)
  })

  it("counts a candidate the assembler rejects (R-20) apart, with the problems", async () => {
    const elsewhere = REGISTRY.profiles.find((p) => p.route !== "support-chat")!
    const report = await shadow({ profile: elsewhere })
    expect(report.summary.candidate_rejected).toBe(CHAT.length)
    const row = report.events.find((e) => e.event_id === CHAT[0])!
    expect(row.candidate!.outcome).toBe("rejected")
    expect(row.candidate!.problems!.join(" ")).toMatch(/R-20|route/)
    // A rejected side has no exclusions to compare: it is no less shedding, and moves no placement.
    expect(report.summary.shedding_change).toBe(0)
    expect(report.summary.placement_changed).toBe(0)
  })

  it("counts the shedding a candidate changes, below_threshold taking over_budget's place", async () => {
    const shed = CHAT.map(event).find((e) =>
      e.trace!.excluded.some((x) => x.reason === "over_budget"),
    )!
    const own = structuredClone(shed.snapshot!.route_policy)
    // Above any score: every knowledge item is below the threshold, so none is left to shed.
    const policy = {
      ...own,
      slots: {
        ...own.slots,
        "evidence.knowledge": { ...own.slots?.["evidence.knowledge"], min_relevance: 2 },
      },
    }
    const report = await shadowReport(
      { name: "one", event_ids: [shed.event_id] },
      { candidate: { route_policy: policy }, load, run, generatedAt: AT },
    )
    const row = report.events[0]!
    expect(row.status).toBe("changed")
    const overBudget = (side: typeof row.baseline) => side!.excluded["over_budget"] ?? 0
    expect(report.summary.shedding_change).toBe(
      overBudget(row.candidate) - overBudget(row.baseline),
    )
    expect(report.summary.shedding_change).toBeLessThan(0)
    expect(row.candidate!.excluded["below_threshold"]).toBeGreaterThan(
      row.baseline!.excluded["below_threshold"] ?? 0,
    )
  })
})
