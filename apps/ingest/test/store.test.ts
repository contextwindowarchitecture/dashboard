import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import type { AssemblyEventV1, EventsIndexV1, SessionV1 } from "@cwa-dashboard/telemetry/types"
import { validateEventsIndexV1, validateSessionV1 } from "@cwa-dashboard/telemetry/validators"
import { afterEach, describe, expect, it } from "vitest"

import { createStore, type Store } from "../src/store.ts"

const fixtures = resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures")
const readJson = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T
const demoIndex = readJson<EventsIndexV1>(join(fixtures, "events/index.json"))
const refund = readJson<SessionV1>(join(fixtures, "sessions/refund-7.json"))
const template = readJson<AssemblyEventV1>(
  join(fixtures, "events", `${refund.turns.at(-1)!.event_id}.json`),
)
const newest = demoIndex.events[0]!.recorded_at

const dirs: string[] = []
const stores: Store[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const open = async (dir: string, options?: Parameters<typeof createStore>[1]) => {
  const store = await createStore(dir, options)
  stores.push(store)
  return store
}
function tree(seed = true) {
  const dir = mkdtempSync(join(tmpdir(), "cwa-ingest-"))
  dirs.push(dir)
  if (seed) cpSync(fixtures, dir, { recursive: true })
  return dir
}

// A ULID-shaped id, unique per n, sorting after the demo's.
const id = (n: number) => `01MZ${String(n).padStart(22, "0")}`
const at = (offsetSeconds: number) =>
  new Date(Date.parse(newest) + offsetSeconds * 1000).toISOString()
const event = (n: number, extra: Partial<AssemblyEventV1> = {}): AssemblyEventV1 =>
  ({
    ...structuredClone(template),
    event_id: id(n),
    recorded_at: at(n),
    session: undefined,
    ...extra,
  }) as AssemblyEventV1
const index = (dir: string) => readJson<EventsIndexV1>(join(dir, "events/index.json"))
const valid = (ok: boolean, errors: unknown) => expect(ok ? null : errors).toBeNull()

describe("the event store", () => {
  it("writes a valid event into the tree and lists it first in the index", async () => {
    const dir = tree()
    const store = await open(dir)
    expect(await store.write(event(1))).toEqual({ ok: true, eventId: id(1) })
    await store.flush()
    expect(readJson(join(dir, "events", `${id(1)}.json`))).toEqual(event(1))
    const written = index(dir)
    valid(validateEventsIndexV1(written), validateEventsIndexV1.errors)
    expect(written.events[0]!.event_id).toBe(id(1))
    expect(written.events).toHaveLength(demoIndex.events.length + 1)
    expect(written.facets.outcome["assembled"]).toBe(
      (demoIndex.facets.outcome["assembled"] ?? 0) + 1,
    )
  })

  it("refuses an event that is not one, saying what is wrong, and writes nothing", async () => {
    const dir = tree()
    const store = await open(dir)
    const { outcome: _outcome, ...missing } = event(2)
    const result = await store.write(missing)
    expect(result).toMatchObject({ ok: false, kind: "invalid" })
    if (!result.ok) expect(result.problems.join(" ")).toContain("outcome")
    expect(existsSync(join(dir, "events", `${id(2)}.json`))).toBe(false)
  })

  it("refuses an event whose id the tree already holds", async () => {
    const store = await open(tree())
    const existing = { ...event(3), event_id: demoIndex.events[0]!.event_id }
    expect(await store.write(existing)).toMatchObject({ ok: false, kind: "duplicate" })
  })

  it("adds a session's new turn to its session file", async () => {
    const dir = tree()
    const store = await open(dir)
    const turn = event(4, { session: { id: "refund-7", turn_index: refund.turns.length } })
    expect((await store.write(turn)).ok).toBe(true)
    const session = readJson<SessionV1>(join(dir, "sessions/refund-7.json"))
    valid(validateSessionV1(session), validateSessionV1.errors)
    expect(session.turns.map((t) => t.event_id)).toEqual([
      ...refund.turns.map((t) => t.event_id),
      id(4),
    ])
  })

  it("keeps every event of posts that arrive together, and an index that validates", async () => {
    const dir = tree()
    const store = await open(dir)
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.write(event(10 + i))),
    )
    expect(results.every((r) => r.ok)).toBe(true)
    await store.flush()
    const written = index(dir)
    valid(validateEventsIndexV1(written), validateEventsIndexV1.errors)
    for (let i = 0; i < 20; i += 1)
      expect(written.events.map((r) => r.event_id)).toContain(id(10 + i))
    expect(readdirSync(join(dir, "events")).filter((name) => name.includes(".tmp"))).toEqual([])
  })

  it("loses no turn when turns of one session arrive together", async () => {
    const dir = tree()
    const store = await open(dir)
    const turns = Array.from({ length: 6 }, (_, i) =>
      event(40 + i, { session: { id: "refund-7", turn_index: refund.turns.length + i } }),
    )
    await Promise.all(turns.map((turn) => store.write(turn)))
    const session = readJson<SessionV1>(join(dir, "sessions/refund-7.json"))
    expect(session.turns).toHaveLength(refund.turns.length + turns.length)
  })

  it("closes the rows older than the window into their days, and lists the closed windows", async () => {
    const dir = tree()
    const store = await open(dir, { window: { hours: 24, max: 20_000 } })
    await store.write(event(3 * 86_400))
    await store.flush()
    const written = index(dir)
    valid(validateEventsIndexV1(written), validateEventsIndexV1.errors)
    expect(written.events.map((r) => r.event_id)).toEqual([id(3 * 86_400)])
    const days = [...new Set(demoIndex.events.map((r) => r.recorded_at.slice(0, 10)))]
    expect(written.windows!.map((w) => w.day).sort()).toEqual(days.sort())
    let closed = 0
    for (const window of written.windows!) {
      const day = readJson<EventsIndexV1>(join(dir, "events", window.path))
      valid(validateEventsIndexV1(day), validateEventsIndexV1.errors)
      expect(day.events).toHaveLength(window.events)
      closed += window.events
    }
    expect(closed).toBe(demoIndex.events.length)
  })

  it("starts a tree from nothing", async () => {
    const dir = tree(false)
    const store = await open(dir)
    expect((await store.write(event(5))).ok).toBe(true)
    await store.flush()
    expect(index(dir).events.map((r) => r.event_id)).toEqual([id(5)])
  })
})
