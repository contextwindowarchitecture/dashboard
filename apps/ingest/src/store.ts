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
  type SourceFacts,
  sourceFacts,
  sourcesFromFacts,
  windowRows,
} from "@cwa-dashboard/telemetry/derive"
import type {
  AssemblyEventV1,
  CorpusV1,
  EventsIndexV1,
  FleetReportV1,
  SessionV1,
  SourcesReportV1,
} from "@cwa-dashboard/telemetry/types"
import { validateAssemblyEventV1 } from "@cwa-dashboard/telemetry/validators"

import {
  CORPUS_NAME,
  type CorpusSummary,
  DAY,
  DEFAULT_TENANT,
  describeProblems,
  EVENT_ID,
  type EventStore,
  fleetInputs,
  SESSION_ID,
  TENANT,
  type TenantSummary,
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

/**
 * The tree store (ADR-0012): the default tenant's tree at `root`, and each other tenant's, the same
 * layout, under `root/tenants/<tenant>/`, opened when first written or read. A write goes to its
 * event's tenant; `tenants.json` at the root lists them, so a static host can too.
 */
export async function createStore(root: string, options: StoreOptions = {}): Promise<EventStore> {
  const trees = new Map<string, Promise<TenantTree>>()
  const treeOf = (tenant: string): Promise<TenantTree> => {
    if (!TENANT.test(tenant)) throw new Error(`${JSON.stringify(tenant)} names no tenant`)
    let tree = trees.get(tenant)
    if (tree === undefined) {
      tree = createTree(tenant === DEFAULT_TENANT ? root : join(root, "tenants", tenant), options)
      trees.set(tenant, tree)
    }
    return tree
  }
  await treeOf(DEFAULT_TENANT)

  async function tenants(): Promise<TenantSummary[]> {
    const names = [
      DEFAULT_TENANT,
      ...(existsSync(join(root, "tenants"))
        ? (await readdir(join(root, "tenants"))).filter((n) => TENANT.test(n)).sort()
        : []),
    ]
    const list: TenantSummary[] = []
    for (const tenant of names) {
      const events = await (await treeOf(tenant)).count()
      if (events > 0) list.push({ tenant, events })
    }
    return list
  }

  // tenants.json follows the writes, rewritten after them, a moment later.
  let listing: Promise<void> = Promise.resolve()
  const relist = () => {
    listing = listing
      .then(async () =>
        replace(join(root, "tenants.json"), {
          $schema: "cwa-dashboard/tenants/v1",
          tenants: await tenants(),
        }),
      )
      .catch(() => undefined)
  }

  const views = new Map<string, EventStore>()
  function view(tenant: string): EventStore {
    const known = views.get(tenant)
    if (known !== undefined) return known
    const tree = () => treeOf(tenant)
    const made: EventStore = {
      async write(candidate) {
        if (!validateAssemblyEventV1(candidate)) {
          return {
            ok: false,
            kind: "invalid",
            problems: describeProblems(validateAssemblyEventV1.errors),
          }
        }
        const result = await (await treeOf(candidate.tenant ?? DEFAULT_TENANT)).write(candidate)
        if (result.ok) relist()
        return result
      },
      index: async () => (await tree()).index(),
      window: async (day) => (await tree()).window(day),
      event: async (eventId) => (await tree()).event(eventId),
      session: async (sessionId) => (await tree()).session(sessionId),
      fleet: async () => (await tree()).fleet(),
      sources: async () => (await tree()).sources(),
      saveCorpus: async (corpus) => (await tree()).saveCorpus(corpus),
      corpus: async (name) => (await tree()).corpus(name),
      corpora: async () => (await tree()).corpora(),
      forTenant: (other) => {
        if (!TENANT.test(other)) throw new Error(`${JSON.stringify(other)} names no tenant`)
        return view(other)
      },
      tenants,
      async flush() {
        await (await tree()).flush()
        await listing
      },
      async close() {
        for (const each of trees.values()) await (await each).close()
        await listing
      },
    }
    views.set(tenant, made)
    return made
  }
  return view(DEFAULT_TENANT)
}

/** One tenant's tree: the store's documents for it, and how many events it holds. */
type TenantTree = Omit<EventStore, "forTenant" | "tenants"> & { count(): Promise<number> }

async function createTree(root: string, options: StoreOptions): Promise<TenantTree> {
  const window = options.window ?? WINDOW
  const debounceMs = options.debounceMs ?? 200
  const events = join(root, "events")
  const sessions = join(root, "sessions")
  const corpora = join(root, "corpora")
  await mkdir(join(events, "index"), { recursive: true })
  await mkdir(sessions, { recursive: true })
  await mkdir(corpora, { recursive: true })

  const existing = await readJson<EventsIndexV1>(join(events, "index.json"))
  let rows: IndexRow[] = [...(existing?.events ?? [])]
  const windows = new Map((existing?.windows ?? []).map((w) => [w.day, w]))
  // The fleet and sources reports read a few facts of every event; they are read from the tree once.
  const facts: FleetFacts[] = []
  const sourceFactsById = new Map<string, SourceFacts>()
  const freshRows = new Map<string, IndexRow>()
  for (const name of await readdir(events)) {
    if (!name.endsWith(".json") || name === "index.json") continue
    const event = await readJson<AssemblyEventV1>(join(events, name))
    if (event === undefined) continue
    facts.push(fleetFacts(event))
    sourceFactsById.set(event.event_id, sourceFacts(event))
    freshRows.set(event.event_id, indexRow(event))
  }
  // An index written by an older store lacks fields a row now carries: the current window's rows are
  // derived again from their events, and the index rebuilt once if any changed.
  const before = JSON.stringify(rows)
  rows = rows.map((row) => freshRows.get(row.event_id) ?? row)
  const stale = JSON.stringify(rows) !== before
  // The sources report covers the current window's events, as the index does.
  const sourcesOf = (generatedAt: string) =>
    sourcesFromFacts(
      rows.flatMap((row) => {
        const fact = sourceFactsById.get(row.event_id)
        return fact === undefined ? [] : [fact]
      }),
      generatedAt,
    )

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
    await replace(join(root, "sources.json"), sourcesOf(generatedAt))
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

  if (stale) schedule()

  const store: TenantTree = {
    async count() {
      return (await readdir(events)).filter((n) => n.endsWith(".json") && n !== "index.json").length
    },
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
        sourceFactsById.set(event.event_id, sourceFacts(event))
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
    async sources() {
      return (
        (await readJson<SourcesReportV1>(join(root, "sources.json"))) ??
        sourcesOf(new Date().toISOString())
      )
    },
    async saveCorpus(corpus: CorpusV1) {
      const path = join(corpora, `${corpus.name}.json`)
      const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`
      await writeFile(tmp, text(corpus))
      try {
        // As for an event: a hard link fails when the name is taken.
        await link(tmp, path)
        return "saved" as const
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return "exists" as const
        throw error
      } finally {
        await unlink(tmp)
      }
    },
    corpus: (name) =>
      CORPUS_NAME.test(name)
        ? readJson<CorpusV1>(join(corpora, `${name}.json`))
        : Promise.resolve(undefined),
    async corpora() {
      const names = (await readdir(corpora)).filter((n) => n.endsWith(".json")).sort()
      const list: CorpusSummary[] = []
      for (const name of names) {
        const corpus = await readJson<CorpusV1>(join(corpora, name))
        if (corpus)
          list.push({
            name: corpus.name,
            created_at: corpus.created_at,
            events: corpus.events.length,
          })
      }
      return list
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
