import { describe, expect, it } from "vitest"

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { SLOT_DEFAULTS } from "@cwa-dashboard/contract/data"
import { IMPLEMENTATIONS } from "@cwa-dashboard/contract/implementations"

import {
  validateEventsIndexV1,
  validateFleetReportV1,
  validateSessionV1,
} from "../generated/validators.js"

// The documents the generator and the ingest service derive from events (dashboard-plan.md 3). The
// examples are minimal and their values follow the vendored cases; the generator's tests check that
// real derived documents validate and agree with their events.

type Doc = Record<string, unknown>
type Validator = ((data: unknown) => boolean) & { errors?: unknown }
const clone = <T>(value: T): T => structuredClone(value)

function expectValid(validate: Validator, doc: unknown) {
  const ok = validate(doc)
  expect(ok ? null : validate.errors).toBeNull()
}

function expectEachRequired(validate: Validator, doc: Doc, fields: string[]) {
  for (const field of fields) {
    const copy = clone(doc)
    delete copy[field]
    expect(validate(copy), field).toBe(false)
  }
}

// --- events-index --------------------------------------------------------------------------------

const assembledRow = {
  event_id: "01JA2B3C4D5E6F7G8H9JKMNPQS",
  recorded_at: "2026-10-15T09:31:00.000Z",
  service: "refund-assistant",
  language: "typescript",
  redaction_mode: "full",
  route: "contract-fixture",
  route_policy_version: "fixture/v1",
  profile: { id: "fixture-three-slot", version: 1 },
  outcome: "assembled",
  reason_codes: ["below_threshold"],
  input_tokens: 34,
  budget_input: 64,
  session: { id: "refund-7", turn_index: 2 },
  total_ms: 3.2,
}
const rejectedRow = {
  event_id: "01JA2B3C4D5E6F7G8H9JKMNPQR",
  recorded_at: "2026-10-15T09:30:00.000Z",
  service: "refund-assistant",
  language: "typescript",
  redaction_mode: "full",
  outcome: "rejected",
  reason_codes: [],
  problem_count: 1,
  total_ms: 0.4,
}
const index = {
  $schema: "cwa-dashboard/events-index/v1",
  generated_at: "2026-10-15T09:32:00.000Z",
  window: { from: "2026-10-14T09:32:00.000Z", to: "2026-10-15T09:32:00.000Z" },
  events: [assembledRow, rejectedRow],
  facets: {
    outcome: { assembled: 1, rejected: 1 },
    language: { typescript: 2 },
    route: { "contract-fixture": 1 },
    reason: { below_threshold: 1 },
    service: { "refund-assistant": 2 },
  },
  windows: [{ day: "2026-10-14", path: "index/2026-10-14.json", events: 120 }],
}

describe("events-index v1", () => {
  it("accepts an index of an assembled and a rejected event", () => {
    expectValid(validateEventsIndexV1, index)
    expectValid(validateEventsIndexV1, {
      ...index,
      events: [],
      facets: { outcome: {}, language: {}, route: {}, reason: {}, service: {} },
    })
  })

  it("requires its fields and each row's", () => {
    expectEachRequired(validateEventsIndexV1, index, [
      "$schema",
      "generated_at",
      "window",
      "events",
      "facets",
    ])
    for (const field of [
      "event_id",
      "recorded_at",
      "service",
      "language",
      "redaction_mode",
      "outcome",
      "reason_codes",
      "total_ms",
    ]) {
      const row: Doc = clone(assembledRow)
      delete row[field]
      expect(validateEventsIndexV1({ ...index, events: [row] }), field).toBe(false)
    }
  })

  it("requires the route, profile and budget of an event that was assembled or refused", () => {
    for (const field of ["route", "route_policy_version", "profile", "budget_input"]) {
      const row: Doc = clone(assembledRow)
      delete row[field]
      expect(validateEventsIndexV1({ ...index, events: [row] }), field).toBe(false)
    }
  })

  it("names a refusal's code, an assembly's tokens and a rejection's problem count", () => {
    const refused = { ...assembledRow, outcome: "refused", input_tokens: undefined }
    expect(validateEventsIndexV1({ ...index, events: [refused] })).toBe(false)
    expectValid(validateEventsIndexV1, {
      ...index,
      events: [{ ...refused, refused_reason: "evidence_required" }],
    })
    expect(
      validateEventsIndexV1({ ...index, events: [{ ...assembledRow, input_tokens: undefined }] }),
    ).toBe(false)
    expect(
      validateEventsIndexV1({ ...index, events: [{ ...rejectedRow, problem_count: undefined }] }),
    ).toBe(false)
  })

  it("counts facets as non-negative integers", () => {
    const facets = { ...index.facets, reason: { below_threshold: -1 } }
    expect(validateEventsIndexV1({ ...index, facets })).toBe(false)
  })
})

// --- session -------------------------------------------------------------------------------------

const session = {
  $schema: "cwa-dashboard/session/v1",
  session_id: "refund-7",
  route: "refund",
  service: "refund-assistant",
  profile: { id: "policy-first-chat", version: 1 },
  turns: [
    {
      turn_index: 0,
      event_id: "01JA2B3C4D5E6F7G8H9JKMNPQR",
      outcome: "assembled",
      input_tokens: 812,
      by_plane: { gov: 420, state: 60, evid: 210, inter: 90 },
      compressed_count: 0,
      over_budget_count: 0,
      parts: 5,
    },
    {
      turn_index: 1,
      event_id: "01JA2B3C4D5E6F7G8H9JKMNPQS",
      outcome: "refused",
      by_plane: { gov: 0, state: 0, evid: 0, inter: 0 },
      compressed_count: 0,
      over_budget_count: 2,
      refused_reason: "evidence_required",
    },
    { turn_index: 2, event_id: "01JA2B3C4D5E6F7G8H9JKMNPQT", outcome: "rejected" },
  ],
  part_reuse: { compared_turns: 0, reused_parts: 0, parts: 0 },
}

describe("session v1", () => {
  it("accepts a session of an assembled, a refused and a rejected turn", () => {
    expectValid(validateSessionV1, session)
  })

  it("requires its fields", () => {
    expectEachRequired(validateSessionV1, session, [
      "$schema",
      "session_id",
      "route",
      "service",
      "profile",
      "turns",
      "part_reuse",
    ])
  })

  it("requires the tokens by plane of a turn that was assembled or refused", () => {
    for (const index of [0, 1]) {
      const copy = clone(session)
      delete (copy.turns[index] as Doc)["by_plane"]
      expect(validateSessionV1(copy), String(index)).toBe(false)
    }
    const copy = clone(session)
    delete (copy.turns[0]!.by_plane as Doc)["evid"]
    expect(validateSessionV1(copy)).toBe(false)
  })

  it("names a refusal's code and an assembly's input tokens", () => {
    const noReason = clone(session)
    delete (noReason.turns[1] as Doc)["refused_reason"]
    expect(validateSessionV1(noReason)).toBe(false)
    const noTokens = clone(session)
    delete (noTokens.turns[0] as Doc)["input_tokens"]
    expect(validateSessionV1(noTokens)).toBe(false)
  })

  it("names the planes as contract/slot-defaults.json does, and no others", () => {
    const schema = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../schemas/session.v1.schema.json"), "utf8"),
    ) as { $defs: { turn: { properties: { by_plane: { required: string[] } } } } }
    const planes = [...new Set(Object.values(SLOT_DEFAULTS).map((slot) => slot.plane))]
    expect(schema.$defs.turn.properties.by_plane.required.sort()).toEqual(planes.sort())
  })

  it("records part reuse only beside a part count, and never a negative one", () => {
    const reused = clone(session)
    ;(reused.turns[0] as Doc)["reused_parts"] = 3
    expectValid(validateSessionV1, reused)
    const withoutCount = clone(session)
    delete (withoutCount.turns[0] as Doc)["parts"]
    ;(withoutCount.turns[0] as Doc)["reused_parts"] = 3
    expect(validateSessionV1(withoutCount)).toBe(false)
    expect(
      validateSessionV1({
        ...session,
        part_reuse: { compared_turns: 1, reused_parts: -1, parts: 4 },
      }),
    ).toBe(false)
    const refusedWithParts = clone(session)
    ;(refusedWithParts.turns[1] as Doc)["parts"] = 2
    expect(validateSessionV1(refusedWithParts)).toBe(false)
  })
})

// --- fleet-report --------------------------------------------------------------------------------

const typescript = IMPLEMENTATIONS.find((implementation) => implementation.id === "typescript")!
const fleet = {
  $schema: "cwa-dashboard/fleet-report/v1",
  generated_at: "2026-10-15T09:32:00.000Z",
  contract: {
    repository: "contextwindowarchitecture/contextwindowarchitecture",
    commit: "16de4be6e4c9f1d0a7b2c3d4e5f60718293a4b5c",
  },
  implementations: [
    {
      language: "typescript",
      name: typescript.report.implementation.name,
      version: typescript.report.implementation.version,
      source: {
        repository: typescript.source.repository,
        commit: typescript.source.commit,
        dirty: typescript.source.dirty,
      },
      report: typescript.report,
      tokenizers: ["fixture-whitespace/v1", "estimate-utf8/v1"],
    },
  ],
  services: [
    {
      name: "refund-assistant",
      language: "typescript",
      assembler_version: "0.0.1",
      contract_lock_sha256: "a".repeat(64),
      routes: ["refund"],
      latency_ms: { samples: 3, p50: 2.1, p95: 3.9, p99: 4.0 },
    },
    {
      name: "intake",
      language: "go",
      assembler_version: "0.0.1",
      contract_lock_sha256: "b".repeat(64),
      routes: ["clinical-intake"],
      latency_ms: { samples: 0 },
    },
  ],
}

describe("fleet-report v1", () => {
  it("accepts a fleet whose implementation carries its published report", () => {
    expectValid(validateFleetReportV1, fleet)
  })

  it("requires its fields", () => {
    expectEachRequired(validateFleetReportV1, fleet, [
      "$schema",
      "generated_at",
      "contract",
      "implementations",
      "services",
    ])
  })

  it("holds an implementation's report to the published schema", () => {
    const copy = clone(fleet)
    delete (copy.implementations[0]!.report as unknown as Doc)["cases"]
    expect(validateFleetReportV1(copy)).toBe(false)
  })

  it("has percentiles only when it has samples, so nothing unmeasured reads as a number", () => {
    const missing = clone(fleet)
    missing.services[0]!.latency_ms = { samples: 3 }
    expect(validateFleetReportV1(missing)).toBe(false)
    const invented = clone(fleet)
    invented.services[1]!.latency_ms = { samples: 0, p50: 0, p95: 0, p99: 0 } as never
    expect(validateFleetReportV1(invented)).toBe(false)
  })
})
