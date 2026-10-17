// The contract every EventStore keeps (ADR-0007): it takes the events the demo tree holds and then
// serves exactly the documents the tree holds, the index, each event, each session, each closed
// day and the fleet report, generated times aside. The tree store and the PostgreSQL store each run
// this suite, so the web app reads the same documents whichever one a deployment uses.

import { createHash } from "node:crypto"
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

/**
 * One demo session's events again for another tenant, as that tenant's wrapper would have recorded
 * them: the same calls, each with a new id (the time kept, the rest derived from the old id and the
 * tenant) and the tenant named.
 */
export function inTenant(events: readonly AssemblyEventV1[], tenant: string): AssemblyEventV1[] {
  const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  return events.map((event) => {
    const digest = createHash("sha256").update(`${tenant}/${event.event_id}`).digest()
    const tail = [...digest.subarray(0, 16)].map((byte) => CROCKFORD[byte % 32]).join("")
    return { ...structuredClone(event), event_id: event.event_id.slice(0, 10) + tail, tenant }
  })
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

    it("keeps a corpus under its name, never overwriting it, and lists it", async () => {
      const { store, done } = await open()
      try {
        const corpus = {
          $schema: "cwa-dashboard/corpus/v1" as const,
          name: "chat-baseline",
          created_at: "2026-10-17T12:00:00.000Z",
          events: [{ event_id: DEMO_EVENTS[0]!.event_id }],
        }
        expect(await store.saveCorpus(corpus)).toBe("saved")
        expect(await store.saveCorpus({ ...corpus, events: [] })).toBe("exists")
        expect(await store.corpus("chat-baseline")).toEqual(corpus)
        expect(await store.corpora()).toEqual([
          { name: "chat-baseline", created_at: corpus.created_at, events: 1 },
        ])
        expect(await store.corpus("nothing-here")).toBeUndefined()
        expect(await store.corpus("../events/index")).toBeUndefined()
      } finally {
        await done()
      }
    })

    describe("tenants (ADR-0012)", () => {
      const SESSION = DEMO_EVENTS.filter((e) => e.session?.id === "refund-7")
      const NORTHWIND = inTenant(SESSION, "northwind")

      it("keeps another tenant's events out of every document of the default's, and the reverse", async () => {
        const { store, done } = await open()
        try {
          await writeAll(store, [...DEMO_EVENTS, ...NORTHWIND])
          const theirs = store.forTenant("northwind")
          await theirs.flush()
          const ours = new Set((await store.index()).events.map((row) => row.event_id))
          const north = new Set((await theirs.index()).events.map((row) => row.event_id))
          expect(north).toEqual(new Set(NORTHWIND.map((e) => e.event_id)))
          for (const event of NORTHWIND) expect(ours.has(event.event_id)).toBe(false)
          expect(ours.size).toBe(DEMO_EVENTS.length)
          // An event is found under its own tenant only.
          expect(await theirs.event(NORTHWIND[0]!.event_id)).toEqual(NORTHWIND[0])
          expect(await store.event(NORTHWIND[0]!.event_id)).toBeUndefined()
          expect(await theirs.event(SESSION[0]!.event_id)).toBeUndefined()
          // The same session id in two tenants is two sessions.
          expect((await theirs.session("refund-7"))!.turns.map((t) => t.event_id)).toEqual(
            NORTHWIND.map((e) => e.event_id),
          )
          expect((await store.session("refund-7"))!.turns.map((t) => t.event_id)).toEqual(
            SESSION.map((e) => e.event_id),
          )
          // The derived documents count their own tenant's events.
          expect((await theirs.sources()).window.events).toBe(NORTHWIND.length)
          const services = (await theirs.fleet()).services.map((x) => x.name)
          expect(services).toEqual([...new Set(NORTHWIND.map((e) => e.service.name))])
        } finally {
          await done()
        }
      })

      it("lists its tenants and their events, the default first", async () => {
        const { store, done } = await open()
        try {
          expect(await store.tenants()).toEqual([])
          await writeAll(store, [
            ...SESSION,
            ...NORTHWIND,
            { ...inTenant([SESSION[0]!], "acme")[0]! },
          ])
          await store.forTenant("northwind").flush()
          await store.forTenant("acme").flush()
          expect(await store.tenants()).toEqual([
            { tenant: "default", events: SESSION.length },
            { tenant: "acme", events: 1 },
            { tenant: "northwind", events: NORTHWIND.length },
          ])
        } finally {
          await done()
        }
      })

      it("takes an event naming the default tenant as the default's", async () => {
        const { store, done } = await open()
        try {
          const named = { ...inTenant([SESSION[0]!], "default")[0]! }
          await writeAll(store, [named])
          expect(await store.event(named.event_id)).toEqual(named)
        } finally {
          await done()
        }
      })

      it("keeps each tenant's corpora apart, a name free in each", async () => {
        const { store, done } = await open()
        try {
          await writeAll(store, [...SESSION, ...NORTHWIND])
          const corpus = (tenant: string, events: readonly AssemblyEventV1[]) => ({
            $schema: "cwa-dashboard/corpus/v1" as const,
            name: "chat",
            ...(tenant === "default" ? {} : { tenant }),
            created_at: "2026-10-17T12:00:00.000Z",
            events: events.map((e) => ({ event_id: e.event_id })),
          })
          expect(await store.saveCorpus(corpus("default", SESSION))).toBe("saved")
          expect(
            await store.forTenant("northwind").saveCorpus(corpus("northwind", NORTHWIND)),
          ).toBe("saved")
          expect((await store.corpus("chat"))!.events.map((e) => e.event_id)).toEqual(
            SESSION.map((e) => e.event_id),
          )
          expect(
            (await store.forTenant("northwind").corpus("chat"))!.events.map((e) => e.event_id),
          ).toEqual(NORTHWIND.map((e) => e.event_id))
          expect(await store.forTenant("acme").corpora()).toEqual([])
        } finally {
          await done()
        }
      })
    })
  })
}
