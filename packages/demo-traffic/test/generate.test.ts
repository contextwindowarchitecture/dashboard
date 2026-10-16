import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { SLOT_DEFAULTS } from "@cwa-dashboard/contract/data"
import {
  validateAssemblyEventV1,
  validateEventsIndexV1,
  validateFleetReportV1,
  validateSessionV1,
} from "@cwa-dashboard/telemetry/validators"
import type { AssemblyEventV1, EventsIndexV1, SessionV1 } from "@cwa-dashboard/telemetry/types"
import { beforeAll, describe, expect, it } from "vitest"

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"

import {
  differences,
  FIXTURES,
  generateTree,
  withoutMeasurements,
  writeTree,
} from "../src/generate.ts"
import { SCENARIOS } from "../src/scenarios/index.ts"

const vendor = resolve(import.meta.dirname, "../../contract/vendor/cwa")
type Validator = ((data: unknown) => boolean) & { errors?: unknown }
const valid = (validate: Validator, value: unknown, where: string) =>
  expect(validate(value) ? null : { where, errors: validate.errors }).toBeNull()

let tree: Map<string, string>
const json = <T>(path: string) => JSON.parse(tree.get(path)!) as T
let events: AssemblyEventV1[]

beforeAll(() => {
  tree = generateTree()
  events = [...tree.keys()]
    .filter((path) => path.startsWith("events/") && path !== "events/index.json")
    .map((path) => json<AssemblyEventV1>(path))
})

describe("the demo tree", () => {
  it("records every vendored case and rejection and every scenario turn, once each", () => {
    const turns = SCENARIOS.reduce((sum, scenario) => sum + scenario.turns.length, 0)
    expect(events).toHaveLength(65 + 25 + turns)
  })

  it("holds only valid documents", () => {
    for (const event of events) valid(validateAssemblyEventV1, event, event.event_id)
    valid(validateEventsIndexV1, json("events/index.json"), "index")
    valid(validateFleetReportV1, json("fleet.json"), "fleet")
    for (const path of tree.keys())
      if (path.startsWith("sessions/")) valid(validateSessionV1, json(path), path)
  })

  it("says every event is demo traffic from the TypeScript assembler", () => {
    for (const event of events) {
      expect(event.service.environment, event.event_id).toBe("demo")
      expect(event.assembler.language, event.event_id).toBe("typescript")
    }
  })

  it("carries each conformance case's expected trace, as the assembler produced it", () => {
    const comparable = (trace: unknown) => {
      const copy = structuredClone(trace) as Record<string, unknown>
      delete copy["trace_id"]
      delete copy["timings"]
      const recovery = copy["recovery"] as Record<string, unknown> | undefined
      if (recovery) delete recovery["detail"]
      return copy
    }
    const suite = events.filter(
      (event) => event.service.name === "conformance-suite" && event.trace,
    )
    expect(suite).toHaveLength(65)
    // Each case's snapshot digest names it in the trace (R-22), so events and cases pair by digest.
    const byDigest = new Map(suite.map((event) => [event.trace!.context.snapshot_digest, event]))
    expect(byDigest.size).toBe(65)
    const lock = JSON.parse(readFileSync(join(vendor, "../cwa.lock.json"), "utf8")) as {
      files: Record<string, string>
    }
    const traces = Object.keys(lock.files).filter((path) =>
      /^conformance\/cases\/[^/]+\/expected\.trace\.json$/.test(path),
    )
    expect(traces).toHaveLength(65)
    for (const path of traces) {
      const expected = JSON.parse(readFileSync(join(vendor, path), "utf8")) as {
        context: { snapshot_digest: string }
      }
      const event = byDigest.get(expected.context.snapshot_digest)
      expect(event, path).toBeDefined()
      expect(comparable(event!.trace), path).toEqual(comparable(expected))
    }
  })

  it("lists every event file in the index, newest first", () => {
    const index = json<EventsIndexV1>("events/index.json")
    expect(index.events.map((row) => row.event_id).sort()).toEqual(
      events.map((e) => e.event_id).sort(),
    )
    const times = index.events.map((row) => row.recorded_at)
    expect(times).toEqual([...times].sort().reverse())
    expect(index.generated_at).toBe(times[0])
  })

  it("sums each session turn's planes from its event's included tokens", () => {
    const sessions = [...tree.keys()]
      .filter((path) => path.startsWith("sessions/"))
      .map((path) => json<SessionV1>(path))
    expect(sessions.map((s) => s.session_id).sort()).toEqual(
      [...new Set(SCENARIOS.flatMap((s) => (s.session ? [s.session] : [])))].sort(),
    )
    const byId = new Map(events.map((event) => [event.event_id, event]))
    for (const session of sessions) {
      for (const turn of session.turns) {
        if (!turn.by_plane) continue
        const total = Object.values(turn.by_plane).reduce((a, b) => a + b, 0)
        const included = byId.get(turn.event_id)!.trace!.included
        expect(total, turn.event_id).toBe(included.reduce((sum, row) => sum + row.tokens, 0))
        for (const row of included)
          expect(Object.keys(turn.by_plane)).toContain(
            SLOT_DEFAULTS[row.slot as keyof typeof SLOT_DEFAULTS].plane,
          )
      }
    }
  })

  it("compares payload parts where the renderer delimits them, and nowhere else", () => {
    const sessions = new Map(
      [...tree.keys()]
        .filter((p) => p.startsWith("sessions/"))
        .map((p) => [json<SessionV1>(p).session_id, json<SessionV1>(p)]),
    )
    expect(sessions.get("refund-7")!.part_reuse.compared_turns).toBe(4)
    expect(sessions.get("refund-7")!.part_reuse.reused_parts).toBeGreaterThan(0)
    expect(sessions.get("fixture-c1")!.part_reuse).toEqual({
      compared_turns: 0,
      reused_parts: 0,
      parts: 0,
    })
  })

  it("is the same tree on every run, measurements aside", () => {
    const again = generateTree()
    expect([...again.keys()]).toEqual([...tree.keys()])
    for (const [path, content] of again) {
      expect(withoutMeasurements(path, content), path).toBe(
        withoutMeasurements(path, tree.get(path)!),
      )
    }
  })

  it("grows by --events, deterministically for a seed", () => {
    const larger = generateTree({ events: 30, seed: 7 })
    const count = (t: Map<string, string>) =>
      [...t.keys()].filter((p) => p.startsWith("events/") && p !== "events/index.json").length
    expect(count(larger)).toBe(events.length + 30)
    const same = generateTree({ events: 30, seed: 7 })
    expect([...same.keys()]).toEqual([...larger.keys()])
  })

  it("leaves a tree as it is when a regeneration changes only measurements", () => {
    const dir = mkdtempSync(join(tmpdir(), "cwa-demo-tree-"))
    try {
      writeTree(tree, dir)
      const first = readFileSync(join(dir, "events/index.json"), "utf8")
      expect(writeTree(generateTree(), dir)).toBe("unchanged")
      expect(readFileSync(join(dir, "events/index.json"), "utf8")).toBe(first)
      writeFileSync(join(dir, "fleet.json"), "{}\n")
      expect(writeTree(tree, dir)).toBe("written")
      expect(differences(tree, dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("is committed as generated (CI fails on a difference)", () => {
    expect(differences(tree, FIXTURES)).toEqual([])
  })
})
