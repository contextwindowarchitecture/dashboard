// The tree store (ADR-0007): the event tree, written as events arrive (dashboard-plan.md 3; D9), not
// a queue and not a database, a file writer with a lock. An event is validated against
// assembly-event v1 (which holds its snapshot and trace to the vendored schemas), written atomically
// under its id, refused if the tree already holds that id, and added to its session's file; the
// index and the fleet report are rebuilt, debounced, from what is kept in memory (each event's index
// row and fleet facts), and rows older than the window close into their day's file. Every document
// is derived by @cwa-dashboard/telemetry/derive, as the generator derives the demo tree, and read
// back from where the tree keeps it.

import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { link, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  buildSessions,
  type FleetFacts,
  fleetFacts,
  fleetReport,
  indexFromRows,
  indexRow,
  type IndexRow,
  windowRows,
} from "@cwa-dashboard/telemetry/derive"
import type {
  AssemblyEventV1,
  EventsIndexV1,
  FleetReportV1,
  SessionV1,
} from "@cwa-dashboard/telemetry/types"
import { validateAssemblyEventV1 } from "@cwa-dashboard/telemetry/validators"

import {
  DAY,
  describeProblems,
  EVENT_ID,
  type EventStore,
  fleetInputs,
  SESSION_ID,
  WINDOW,
  type WriteResult,
} from "./event-store.ts"

export type { WriteResult } from "./event-store.ts"

export interface StoreOptions {
  /** The current window: the newest `hours` of events, at most `max` (dashboard-plan.md 3). */
  readonly window?: { readonly hours: number; readonly max: number }
  /** How long a rebuild of the index waits for more events. */
  readonly debounceMs?: number
}

const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
const readJson = async <T>(path: string): Promise<T | undefined> =>
  existsSync(path) ? (JSON.parse(await readFile(path, "utf8")) as T) : undefined

/** Writes `path` by renaming a finished temporary file over it, so a reader never sees half of it. */
async function replace(path: string, value: unknown) {
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`
  await writeFile(tmp, text(value))
  await rename(tmp, path)
}

export async function createStore(root: string, options: StoreOptions = {}): Promise<EventStore> {
  const window = options.window ?? WINDOW
  const debounceMs = options.debounceMs ?? 200
  const events = join(root, "events")
  const sessions = join(root, "sessions")
  await mkdir(join(events, "index"), { recursive: true })
  await mkdir(sessions, { recursive: true })

  const existing = await readJson<EventsIndexV1>(join(events, "index.json"))
  let rows: IndexRow[] = [...(existing?.events ?? [])]
  const windows = new Map((existing?.windows ?? []).map((w) => [w.day, w]))
  // The fleet report reads a few facts of every event; they are read from the tree once.
  const facts: FleetFacts[] = []
  for (const name of await readdir(events)) {
    if (!name.endsWith(".json") || name === "index.json") continue
    const event = await readJson<AssemblyEventV1>(join(events, name))
    if (event !== undefined) facts.push(fleetFacts(event))
  }

  // One write at a time: the tree has one writer.
  let lock: Promise<unknown> = Promise.resolve()
  const serial = <T>(task: () => Promise<T>) => {
    const run = lock.then(task)
    lock = run.catch(() => undefined)
    return run
  }

  async function rebuild() {
    const generatedAt = new Date().toISOString()
    const { current, closed } = windowRows(rows, window)
    for (const [day, dayRows] of closed) {
      const path = join(events, "index", `${day}.json`)
      const before = (await readJson<EventsIndexV1>(path))?.events ?? []
      const merged = [...new Map([...before, ...dayRows].map((r) => [r.event_id, r])).values()]
      await replace(path, indexFromRows(merged, generatedAt))
      windows.set(day, { day, path: `index/${day}.json`, events: merged.length })
    }
    rows = current
    const index = indexFromRows(rows, generatedAt)
    const listed = [...windows.values()].sort((a, b) => (a.day < b.day ? 1 : -1))
    await replace(
      join(events, "index.json"),
      listed.length > 0 ? { ...index, windows: listed } : index,
    )
    await replace(join(root, "fleet.json"), fleetReport(facts, fleetInputs(generatedAt)))
  }

  // The rebuild waiting for its debounce, and what to tell whoever waits on it.
  let timer: ReturnType<typeof setTimeout> | undefined
  let waiting: Promise<void> = Promise.resolve()
  let settle: { resolve: () => void; reject: (error: unknown) => void } | undefined
  const runRebuild = () => {
    timer = undefined
    const done = settle
    settle = undefined
    return serial(rebuild).then(
      () => done?.resolve(),
      (error: unknown) => done?.reject(error),
    )
  }
  const schedule = () => {
    if (timer !== undefined) return
    waiting = new Promise<void>((resolve, reject) => (settle = { resolve, reject }))
    waiting.catch(() => undefined)
    timer = setTimeout(() => void runRebuild(), debounceMs)
  }

  async function updateSession(event: AssemblyEventV1) {
    const id = event.session!.id
    const path = join(sessions, `${id}.json`)
    const before = await readJson<SessionV1>(path)
    const turns = await Promise.all(
      (before?.turns ?? []).map(async (turn) =>
        readJson<AssemblyEventV1>(join(events, `${turn.event_id}.json`)),
      ),
    )
    const [session] = buildSessions([...turns.filter((e) => e !== undefined), event])
    if (session !== undefined) await replace(path, session)
  }

  const store: EventStore = {
    async write(candidate: unknown): Promise<WriteResult> {
      if (!validateAssemblyEventV1(candidate)) {
        return {
          ok: false,
          kind: "invalid",
          problems: describeProblems(validateAssemblyEventV1.errors),
        }
      }
      const event = candidate
      return serial(async () => {
        const path = join(events, `${event.event_id}.json`)
        const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`
        await writeFile(tmp, text(event))
        try {
          // A hard link fails when the name is taken, so two writers can never both claim an id.
          await link(tmp, path)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            return {
              ok: false,
              kind: "duplicate",
              problems: [`The tree already holds an event ${event.event_id}.`],
            } as const
          }
          throw error
        } finally {
          await unlink(tmp)
        }
        rows.push(indexRow(event))
        facts.push(fleetFacts(event))
        if (event.session !== undefined) await updateSession(event)
        schedule()
        return { ok: true, eventId: event.event_id } as const
      })
    },
    async index() {
      return (
        (await readJson<EventsIndexV1>(join(events, "index.json"))) ??
        indexFromRows([], new Date().toISOString())
      )
    },
    window: (day) =>
      DAY.test(day)
        ? readJson<EventsIndexV1>(join(events, "index", `${day}.json`))
        : Promise.resolve(undefined),
    event: (eventId) =>
      EVENT_ID.test(eventId)
        ? readJson<AssemblyEventV1>(join(events, `${eventId}.json`))
        : Promise.resolve(undefined),
    session: (sessionId) =>
      SESSION_ID.test(sessionId)
        ? readJson<SessionV1>(join(sessions, `${sessionId}.json`))
        : Promise.resolve(undefined),
    async fleet() {
      return (
        (await readJson<FleetReportV1>(join(root, "fleet.json"))) ??
        fleetReport(facts, fleetInputs(new Date().toISOString()))
      )
    },
    /** Rebuilds the index now if a rebuild is waiting, and waits for it. */
    async flush() {
      if (timer !== undefined) {
        clearTimeout(timer)
        await runRebuild()
      }
      await waiting
    },
    /** Flushes, and lets the last write finish, before the tree is let go. */
    async close() {
      await store.flush()
      await lock
    },
  }
  return store
}

export type Store = EventStore
