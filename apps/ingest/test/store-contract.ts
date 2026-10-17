// The contract every EventStore keeps (ADR-0007): it takes the events the demo tree holds and then
// serves exactly the documents the tree holds, the index, each event, each session, each closed
// day and the fleet report, generated times aside. The tree store and the PostgreSQL store each run
// this suite, so the web app reads the same documents whichever one a deployment uses.

import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import type {
  AssemblyEventV1,
  EventsIndexV1,
  FleetReportV1,
  SessionV1,
  SourcesReportV1,
} from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import type { EventStore } from "../src/event-store.ts"

const TREE = resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures")
const read = <T>(path: string) => JSON.parse(readFileSync(join(TREE, path), "utf8")) as T
export const DEMO_EVENTS = readdirSync(join(TREE, "events"))
  .filter((name) => name.endsWith(".json") && name !== "index.json")
  .map((name) => read<AssemblyEventV1>(`events/${name}`))
const SESSIONS = readdirSync(join(TREE, "sessions")).map((name) => name.replace(/\.json$/, ""))

/** A document with its generated time set aside. */
const generatedAside = <T extends { generated_at: string }>(document: T | undefined) =>
  document === undefined ? undefined : { ...document, generated_at: "" }

export interface StoreFixture {
  readonly store: EventStore
  readonly done: () => Promise<void>
}

async function writeAll(store: EventStore, events: readonly AssemblyEventV1[]) {
  for (const event of events) {
    const result = await store.write(event)
    expect(result, event.event_id).toEqual({ ok: true, eventId: event.event_id })
  }
  await store.flush()
}

export function storeContract(name: string, open: () => Promise<StoreFixture>) {
  describe(`${name}: the EventStore contract`, () => {
    it("serves the demo tree's documents once it holds the demo tree's events", async () => {
      const { store, done } = await open()
      try {
        await writeAll(store, DEMO_EVENTS)
        expect(generatedAside(await store.index())).toEqual(
          generatedAside(read<EventsIndexV1>("events/index.json")),
        )
        for (const event of DEMO_EVENTS) expect(await store.event(event.event_id)).toEqual(event)
        for (const id of SESSIONS) {
          expect(await store.session(id), id).toEqual(read<SessionV1>(`sessions/${id}.json`))
        }
        expect(generatedAside(await store.fleet())).toEqual(
          generatedAside(read<FleetReportV1>("fleet.json")),
        )
        expect(generatedAside(await store.sources())).toEqual(
          generatedAside(read<SourcesReportV1>("sources.json")),
        )
      } finally {
        await done()
      }
    }, 60_000)

    it("closes what falls out of the window into its day, and lists the day", async () => {
      const { store, done } = await open()
      try {
        await writeAll(store, DEMO_EVENTS)
        const later = {
          ...DEMO_EVENTS.find((e) => e.session === undefined && e.outcome === "assembled")!,
          event_id: "01M5ZZZZZZZZZZZZZZZZZZZZZZ",
          recorded_at: "2026-10-17T12:00:00.000Z",
        }
        await writeAll(store, [later])
        const index = await store.index()
        expect(index.events.map((row) => row.event_id)).toEqual([later.event_id])
        expect(index.windows).toEqual([
          { day: "2026-10-15", path: "index/2026-10-15.json", events: DEMO_EVENTS.length },
        ])
        // The sources report covers the current window, as the index does: the one later event.
        expect((await store.sources()).window).toEqual({
          from: later.recorded_at,
          to: later.recorded_at,
          events: 1,
        })
        const day = await store.window("2026-10-15")
        expect(day?.events.map((row) => row.event_id).sort()).toEqual(
          read<EventsIndexV1>("events/index.json")
            .events.map((row) => row.event_id)
            .sort(),
        )
      } finally {
        await done()
      }
    }, 60_000)

    it("refuses a second event with the same id, and an invalid one, writing neither", async () => {
      const { store, done } = await open()
      try {
        const [first] = DEMO_EVENTS
        await writeAll(store, [first!])
        const again = await store.write(first)
        expect(again).toMatchObject({ ok: false, kind: "duplicate" })
        const invalid = await store.write({ ...first, event_id: "not-a-ulid" })
        expect(invalid).toMatchObject({ ok: false, kind: "invalid" })
        if (!invalid.ok) expect(invalid.problems.length).toBeGreaterThan(0)
        await store.flush()
        expect((await store.index()).events).toHaveLength(1)
      } finally {
        await done()
      }
    })

    it("has nothing for an id, a session or a day it does not hold, or one that names no document", async () => {
      const { store, done } = await open()
      try {
        await writeAll(store, [DEMO_EVENTS[0]!])
        expect(await store.event("01M5ZZZZZZZZZZZZZZZZZZZZZY")).toBeUndefined()
        expect(await store.event("../fleet")).toBeUndefined()
        expect(await store.session("no-such-session")).toBeUndefined()
        expect(await store.session("../events/index")).toBeUndefined()
        expect(await store.window("2020-01-01")).toBeUndefined()
        expect(await store.window("../index")).toBeUndefined()
      } finally {
        await done()
      }
    })
  })
}
