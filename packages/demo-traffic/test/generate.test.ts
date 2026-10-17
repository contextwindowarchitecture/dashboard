import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { BUILT_ASSEMBLER, BUILT_CONTRACT_FILES } from "@cwa-dashboard/assembler"
import { SLOT_DEFAULTS } from "@cwa-dashboard/contract/data"
import {
  validateAssemblyEventV1,
  validateEventsIndexV1,
  validateFleetReportV1,
  validateSessionV1,
} from "@cwa-dashboard/telemetry/validators"
import type {
  AssemblyEventV1,
  EventsIndexV1,
  FleetReportV1,
  SessionV1,
} from "@cwa-dashboard/telemetry/types"
import { beforeAll, describe, expect, it } from "vitest"

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"

import {
  DEMO_VAULT_BASE,
  differences,
  FIXTURES,
  generateTree,
  generateVault,
  VAULT,
  vaultDifferences,
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

  it("compares each service's contract files with the dashboard's, the built assembler's lock being known", () => {
    const fleet = json<{ services: { contract_lock_sha256: string; contract_files?: unknown }[] }>(
      "fleet.json",
    )
    const ours = JSON.parse(readFileSync(resolve(vendor, "../cwa.lock.json"), "utf8")) as {
      files: Record<string, string>
    }
    for (const service of fleet.services) {
      expect(service.contract_lock_sha256).toBe(BUILT_ASSEMBLER.contract.lock_sha256)
      const pinned = Object.keys(BUILT_CONTRACT_FILES).sort()
      expect(service.contract_files).toEqual({
        pinned: pinned.length,
        differing: pinned.filter((path) => ours.files[path] !== BUILT_CONTRACT_FILES[path]),
      })
    }
  })

  it("keeps the current window in index.json and closes the rest into their days", () => {
    const small = generateTree({ events: 40, window: { hours: 24, max: 50 } })
    const index = JSON.parse(small.get("events/index.json")!) as EventsIndexV1
    valid(validateEventsIndexV1, index, "index")
    expect(index.events).toHaveLength(50)
    let closed = 0
    for (const window of index.windows!) {
      const day = JSON.parse(small.get(`events/${window.path}`)!) as EventsIndexV1
      valid(validateEventsIndexV1, day, window.path)
      expect(day.events).toHaveLength(window.events)
      closed += window.events
    }
    const all = [...small.keys()].filter((path) => /^events\/[0-9A-Z]{26}\.json$/.test(path)).length
    expect(index.events.length + closed).toBe(all)
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

  it("keeps the measurements of every event the previous tree holds unchanged, and so its documents", () => {
    const dir = mkdtempSync(join(tmpdir(), "cwa-demo-tree-"))
    try {
      writeTree(tree, dir)
      const again = generateTree({ previous: dir })
      for (const [path, content] of again) expect(content, path).toBe(tree.get(path))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("measures again an event whose content changed", () => {
    const dir = mkdtempSync(join(tmpdir(), "cwa-demo-tree-"))
    try {
      writeTree(tree, dir)
      const [kept, changed] = events.filter((e) => e.outcome === "assembled")
      const mark = (event: AssemblyEventV1, edit: (e: Record<string, unknown>) => void) => {
        const copy = structuredClone(event) as unknown as Record<string, unknown>
        copy["timings_ms"] = { total: 987654 }
        edit(copy)
        writeFileSync(join(dir, `events/${event.event_id}.json`), JSON.stringify(copy))
      }
      mark(kept!, () => {})
      mark(changed!, (copy) => {
        copy["redaction_mode"] = "digest_only"
      })
      const again = generateTree({ previous: dir })
      const total = (event: AssemblyEventV1) =>
        (JSON.parse(again.get(`events/${event.event_id}.json`)!) as AssemblyEventV1).timings_ms
          .total
      expect(total(kept!)).toBe(987654)
      expect(total(changed!)).not.toBe(987654)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("is committed as generated (CI fails on a difference)", () => {
    expect(differences(tree, FIXTURES)).toEqual([])
  })
})

describe("the demo vault (ADR-0009)", () => {
  const vaulted = () => events.filter((event) => event.vault !== undefined)
  const digestsOf = (event: AssemblyEventV1) =>
    JSON.stringify(event.snapshot ?? event.rejection?.snapshot).match(
      /(?<="content_sha256":")[0-9a-f]{64}/g,
    ) ?? []

  it("opts the review agent's route into the vault, and no other", () => {
    expect(vaulted().length).toBeGreaterThan(0)
    for (const event of events) {
      const review = event.service.name === "review-agent"
      expect(event.vault, event.event_id).toEqual(review ? { base: DEMO_VAULT_BASE } : undefined)
      if (review) expect(event.redaction_mode).toBe("digest_only")
    }
  })

  it("deposits every body a vaulted event's digests name, in the directory vault's layout", () => {
    const vault = generateVault()
    for (const event of vaulted()) {
      for (const digest of digestsOf(event)) {
        const path = [...vault.keys()].find((p) => p.startsWith(`${digest.slice(0, 2)}/${digest}.`))
        expect(path, digest).toBeDefined()
        expect(createHash("sha256").update(vault.get(path!)!, "utf8").digest("hex")).toBe(digest)
      }
    }
    const named = new Set(vaulted().flatMap(digestsOf))
    expect([...vault.keys()].map((p) => p.split("/")[1]!.split(".")[0])).toEqual(
      expect.arrayContaining([...named]),
    )
    expect(vault.size).toBe(named.size)
  })

  it("is kept beside the tree, never in what the web server serves, and committed as generated", () => {
    expect(VAULT.startsWith(`${FIXTURES}/`)).toBe(false)
    expect(vaultDifferences(generateVault(), VAULT)).toEqual([])
  })
})

describe("the demo's second tenant (ADR-0012)", () => {
  const under = (prefix: string) => [...tree.keys()].filter((path) => path.startsWith(prefix))

  it("replays the refund session for northwind's own service, under tenants/northwind/", () => {
    const index = json<EventsIndexV1>("tenants/northwind/events/index.json")
    expect(index.events.length).toBe(SCENARIOS.find((s) => s.id === "refund-session")!.turns.length)
    for (const row of index.events) {
      const event = json<AssemblyEventV1>(`tenants/northwind/events/${row.event_id}.json`)
      valid(validateAssemblyEventV1, event, row.event_id)
      expect(event.tenant).toBe("northwind")
      expect(event.service.name).toBe("northwind-support")
    }
    expect(under("tenants/northwind/sessions/")).toEqual([
      "tenants/northwind/sessions/refund-7.json",
    ])
    for (const doc of ["fleet.json", "sources.json"])
      expect(tree.has(`tenants/northwind/${doc}`)).toBe(true)
  })

  it("keeps the default tenant's documents free of northwind's events", () => {
    for (const event of events) expect(event.tenant, event.event_id).toBeUndefined()
    const fleet = json<FleetReportV1>("fleet.json")
    expect(fleet.services.map((s) => s.name)).not.toContain("northwind-support")
  })

  it("lists both tenants in tenants.json", () => {
    const northwind = json<EventsIndexV1>("tenants/northwind/events/index.json").events.length
    expect(json<unknown>("tenants.json")).toEqual({
      $schema: "cwa-dashboard/tenants/v1",
      tenants: [
        { tenant: "default", events: events.length },
        { tenant: "northwind", events: northwind },
      ],
    })
  })
})
