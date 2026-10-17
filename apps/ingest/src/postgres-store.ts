// The PostgreSQL store (ADR-0007): events in one table, every document derived on read with the
// same derivations the tree store and the generator use, so a deployment that switches stores
// serves the same documents. Each row keeps the event, its index row and its fleet facts as JSON
// text, exactly as written: jsonb would reorder keys and refuse a NUL inside a body, and no query
// here reads into them. The recording time, the session and the turn are columns for the queries.
//
// It needs only `query(text, params)`, which node-postgres's Pool and PGlite both provide.

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
import type { AssemblyEventV1, CorpusV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { validateAssemblyEventV1 } from "@cwa-dashboard/telemetry/validators"

import {
  CORPUS_NAME,
  DAY,
  DEFAULT_TENANT,
  describeProblems,
  EVENT_ID,
  type EventStore,
  fleetInputs,
  SESSION_ID,
  TENANT,
  WINDOW,
} from "./event-store.ts"
import {
  IDLE_MS,
  type Identity,
  type Login,
  LOGIN_MS,
  MAX_MS,
  type SessionStore,
} from "./sessions.ts"
import type { BodyVault, MediaType } from "./vault.ts"

export interface Queryable {
  query<Row>(text: string, params?: unknown[]): Promise<{ rows: Row[] }>
}

/**
 * The schema, one migration per entry, applied in order and recorded in cwa_schema: SQL statements,
 * or a function for a step SQL cannot take (deriving a column from the events with the derivations).
 */
const MIGRATIONS: (string | ((db: Queryable) => Promise<void>))[] = [
  `create table cwa_events (
     event_id text primary key,
     recorded_at timestamptz not null,
     session_id text,
     turn_index integer,
     event text not null,
     index_row text not null,
     facts text not null
   );
   create index cwa_events_order on cwa_events (recorded_at desc, event_id desc);
   create index cwa_events_session on cwa_events (session_id, turn_index)`,
  // 2: each event's source facts, for the sources report, derived for the events already held.
  async (db) => {
    await db.query("alter table cwa_events add column source_facts text")
    const { rows } = await db.query<{ event_id: string; event: string }>(
      "select event_id, event from cwa_events",
    )
    for (const row of rows) {
      await db.query("update cwa_events set source_facts = $1 where event_id = $2", [
        JSON.stringify(sourceFacts(JSON.parse(row.event) as AssemblyEventV1)),
        row.event_id,
      ])
    }
  },
  // 3: the index rows again, now that they carry the compression saving.
  async (db) => {
    const { rows } = await db.query<{ event_id: string; event: string }>(
      "select event_id, event from cwa_events",
    )
    for (const row of rows) {
      await db.query("update cwa_events set index_row = $1 where event_id = $2", [
        JSON.stringify(indexRow(JSON.parse(row.event) as AssemblyEventV1)),
        row.event_id,
      ])
    }
  },
  // 4: the corpora shadow regression replays (ADR-0008), each frozen under its name.
  `create table cwa_corpora (
     name text primary key,
     created_at timestamptz not null,
     corpus text not null
   )`,
  // 5: the bodies routes opted into the vault keep out of their events (ADR-0009), by digest.
  `create table cwa_bodies (
     sha256 text primary key,
     media_type text not null,
     body bytea not null,
     stored_at timestamptz not null default now()
   )`,
  // 6: sign-in (ADR-0010): logins in flight and sessions, each by the SHA-256 of its cookie's id.
  `create table cwa_logins (
     id_hash text primary key,
     login text not null,
     expires_at timestamptz not null
   );
   create table cwa_sessions (
     id_hash text primary key,
     identity text not null,
     created_at timestamptz not null,
     last_seen timestamptz not null,
     expires_at timestamptz not null
   )`,
  // 7: tenants (ADR-0012): every event and corpus belongs to one, the default when it names none.
  `alter table cwa_events add column tenant text not null default 'default';
   create index cwa_events_tenant_order on cwa_events (tenant, recorded_at desc, event_id desc);
   alter table cwa_corpora add column tenant text not null default 'default';
   alter table cwa_corpora drop constraint cwa_corpora_pkey;
   alter table cwa_corpora add primary key (tenant, name)`,
]

async function migrate(db: Queryable) {
  await db.query("create table if not exists cwa_schema (version integer primary key)")
  const { rows } = await db.query<{ version: number }>(
    "select coalesce(max(version), 0) as version from cwa_schema",
  )
  for (let version = Number(rows[0]!.version) + 1; version <= MIGRATIONS.length; version += 1) {
    const migration = MIGRATIONS[version - 1]!
    if (typeof migration === "function") await migration(db)
    else for (const statement of migration.split(";")) await db.query(statement)
    await db.query("insert into cwa_schema (version) values ($1)", [version])
  }
}

const UTC_DAY = "to_char(recorded_at at time zone 'UTC', 'YYYY-MM-DD')"
const parse = <T>(rows: { value: string }[]) => rows.map((row) => JSON.parse(row.value) as T)

export interface PostgresStoreOptions {
  readonly window?: { readonly hours: number; readonly max: number }
  /** Called by close(): the pool or database the caller handed over, to end. */
  readonly end?: () => Promise<void>
}

/** The store, and the vault and the sessions it keeps in the same database. */
export type PostgresStore = EventStore & {
  readonly vault: BodyVault
  readonly sessions: SessionStore
}

export async function createPostgresStore(
  db: Queryable,
  options: PostgresStoreOptions = {},
): Promise<PostgresStore> {
  const window = options.window ?? WINDOW
  await migrate(db)

  /** The current window's rows, and the oldest of them, which every closed row comes before. */
  async function current(tenant: string): Promise<{ rows: IndexRow[]; oldest?: IndexRow }> {
    const newest = await db.query<{ recorded_at: Date }>(
      "select recorded_at from cwa_events where tenant = $1 order by recorded_at desc, event_id desc limit 1",
      [tenant],
    )
    if (newest.rows.length === 0) return { rows: [] }
    const since = new Date(newest.rows[0]!.recorded_at.getTime() - window.hours * 3_600_000)
    const candidates = parse<IndexRow>(
      (
        await db.query<{ value: string }>(
          `select index_row as value from cwa_events where recorded_at >= $1 and tenant = $3
           order by recorded_at desc, event_id desc limit $2`,
          [since.toISOString(), window.max, tenant],
        )
      ).rows,
    )
    const rows = windowRows(candidates, window).current
    return { rows, ...(rows.length === 0 ? {} : { oldest: rows.at(-1)! }) }
  }

  // Rows the window has let go: those after its oldest row in newest-first order.
  const BEFORE = "(recorded_at, event_id) < ($1::timestamptz, $2::text)"

  // One tenant's view (ADR-0012): every query below is scoped to it; a write goes to the event's own.
  const views = new Map<string, EventStore>()
  function scoped(tenant: string): EventStore {
    if (!TENANT.test(tenant)) throw new Error(`${JSON.stringify(tenant)} names no tenant`)
    const known = views.get(tenant)
    if (known !== undefined) return known
    const view: EventStore = {
      async write(candidate) {
        if (!validateAssemblyEventV1(candidate)) {
          return {
            ok: false,
            kind: "invalid",
            problems: describeProblems(validateAssemblyEventV1.errors),
          }
        }
        const event = candidate as AssemblyEventV1
        const { rows } = await db.query<{ event_id: string }>(
          `insert into cwa_events
           (event_id, recorded_at, session_id, turn_index, event, index_row, facts, source_facts, tenant)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (event_id) do nothing returning event_id`,
          [
            event.event_id,
            event.recorded_at,
            event.session?.id ?? null,
            event.session?.turn_index ?? null,
            JSON.stringify(event),
            JSON.stringify(indexRow(event)),
            JSON.stringify(fleetFacts(event)),
            JSON.stringify(sourceFacts(event)),
            event.tenant ?? DEFAULT_TENANT,
          ],
        )
        if (rows.length === 0) {
          return {
            ok: false,
            kind: "duplicate",
            problems: [`The store already holds an event ${event.event_id}.`],
          }
        }
        return { ok: true, eventId: event.event_id }
      },

      async index() {
        const generatedAt = new Date().toISOString()
        const { rows, oldest } = await current(tenant)
        const index = indexFromRows(rows, generatedAt)
        if (oldest === undefined) return index
        const days = await db.query<{ day: string; events: string | number }>(
          `select ${UTC_DAY} as day, count(*) as events from cwa_events where ${BEFORE} and tenant = $3
         group by day order by day desc`,
          [oldest.recorded_at, oldest.event_id, tenant],
        )
        if (days.rows.length === 0) return index
        const windows: NonNullable<EventsIndexV1["windows"]> = days.rows.map((row) => ({
          day: row.day,
          path: `index/${row.day}.json`,
          events: Number(row.events),
        }))
        return { ...index, windows }
      },

      async window(day) {
        if (!DAY.test(day)) return undefined
        const { oldest } = await current(tenant)
        if (oldest === undefined) return undefined
        const rows = parse<IndexRow>(
          (
            await db.query<{ value: string }>(
              `select index_row as value from cwa_events
             where ${BEFORE} and ${UTC_DAY} = $3 and tenant = $4`,
              [oldest.recorded_at, oldest.event_id, day, tenant],
            )
          ).rows,
        )
        return rows.length === 0 ? undefined : indexFromRows(rows, new Date().toISOString())
      },

      async event(eventId) {
        if (!EVENT_ID.test(eventId)) return undefined
        const { rows } = await db.query<{ value: string }>(
          "select event as value from cwa_events where event_id = $1 and tenant = $2",
          [eventId, tenant],
        )
        return parse<AssemblyEventV1>(rows)[0]
      },

      async session(sessionId) {
        if (!SESSION_ID.test(sessionId)) return undefined
        const { rows } = await db.query<{ value: string }>(
          "select event as value from cwa_events where session_id = $1 and tenant = $2",
          [sessionId, tenant],
        )
        return rows.length === 0 ? undefined : buildSessions(parse<AssemblyEventV1>(rows))[0]
      },

      async fleet() {
        const { rows } = await db.query<{ value: string }>(
          "select facts as value from cwa_events where tenant = $1",
          [tenant],
        )
        return fleetReport(parse<FleetFacts>(rows), fleetInputs(new Date().toISOString()))
      },

      async sources() {
        const { rows } = await current(tenant)
        const facts = parse<SourceFacts>(
          (
            await db.query<{ value: string }>(
              "select source_facts as value from cwa_events where event_id = any($1) and tenant = $2",
              [rows.map((row) => row.event_id), tenant],
            )
          ).rows,
        )
        return sourcesFromFacts(facts, new Date().toISOString())
      },

      async saveCorpus(corpus) {
        const { rows } = await db.query<{ name: string }>(
          `insert into cwa_corpora (name, created_at, corpus, tenant) values ($1, $2, $3, $4)
         on conflict (tenant, name) do nothing returning name`,
          [corpus.name, corpus.created_at, JSON.stringify(corpus), tenant],
        )
        return rows.length === 0 ? "exists" : "saved"
      },
      async corpus(name) {
        if (!CORPUS_NAME.test(name)) return undefined
        const { rows } = await db.query<{ value: string }>(
          "select corpus as value from cwa_corpora where name = $1 and tenant = $2",
          [name, tenant],
        )
        return parse<CorpusV1>(rows)[0]
      },
      async corpora() {
        const { rows } = await db.query<{ value: string }>(
          "select corpus as value from cwa_corpora where tenant = $1 order by name",
          [tenant],
        )
        return parse<CorpusV1>(rows).map((c) => ({
          name: c.name,
          created_at: c.created_at,
          events: c.events.length,
        }))
      },

      forTenant: (other) => scoped(other),
      tenants,
      // Every document is derived when it is read, so there is nothing to bring up to date.
      flush: async () => undefined,
      close: async () => options.end?.(),
    }
    views.set(tenant, view)
    return view
  }

  async function tenants() {
    const { rows } = await db.query<{ tenant: string; events: string | number }>(
      "select tenant, count(*) as events from cwa_events group by tenant",
    )
    return rows
      .map((row) => ({ tenant: row.tenant, events: Number(row.events) }))
      .sort((a, b) =>
        a.tenant === DEFAULT_TENANT
          ? -1
          : b.tenant === DEFAULT_TENANT
            ? 1
            : a.tenant.localeCompare(b.tenant),
      )
  }

  const store = scoped(DEFAULT_TENANT)
  const vault: BodyVault = {
    async put(sha256, deposit) {
      const { rows } = await db.query<{ sha256: string }>(
        `insert into cwa_bodies (sha256, media_type, body) values ($1, $2, $3)
         on conflict (sha256) do nothing returning sha256`,
        [sha256, deposit.mediaType, Buffer.from(deposit.bytes)],
      )
      return rows.length === 1 ? "stored" : "held"
    },
    async get(sha256) {
      const { rows } = await db.query<{ media_type: MediaType; body: Uint8Array }>(
        "select media_type, body from cwa_bodies where sha256 = $1",
        [sha256],
      )
      const row = rows[0]
      return row === undefined
        ? undefined
        : { bytes: new Uint8Array(row.body), mediaType: row.media_type }
    },
    async delete(sha256) {
      const { rows } = await db.query<{ sha256: string }>(
        "delete from cwa_bodies where sha256 = $1 returning sha256",
        [sha256],
      )
      return rows.length === 1
    },
  }

  const sessions: SessionStore = {
    async saveLogin(idHash, login, now) {
      await db.query("insert into cwa_logins (id_hash, login, expires_at) values ($1, $2, $3)", [
        idHash,
        JSON.stringify(login),
        new Date(now.getTime() + LOGIN_MS).toISOString(),
      ])
    },
    async takeLogin(idHash, now) {
      const { rows } = await db.query<{ login: string; expires_at: Date }>(
        "delete from cwa_logins where id_hash = $1 returning login, expires_at",
        [idHash],
      )
      const row = rows[0]
      if (row === undefined || new Date(row.expires_at).getTime() < now.getTime()) return undefined
      return JSON.parse(row.login) as Login
    },
    async createSession(idHash, identity, now) {
      await db.query(
        `insert into cwa_sessions (id_hash, identity, created_at, last_seen, expires_at)
         values ($1, $2, $3, $3, $4)`,
        [
          idHash,
          JSON.stringify(identity),
          now.toISOString(),
          new Date(now.getTime() + MAX_MS).toISOString(),
        ],
      )
    },
    async session(idHash, now) {
      // Used now, so its idle time starts again; only a session neither expired nor idle too long.
      const { rows } = await db.query<{ identity: string; created_at: Date; expires_at: Date }>(
        `update cwa_sessions set last_seen = $2
         where id_hash = $1 and expires_at > $2 and last_seen > $3
         returning identity, created_at, expires_at`,
        [idHash, now.toISOString(), new Date(now.getTime() - IDLE_MS).toISOString()],
      )
      const row = rows[0]
      if (row === undefined) return undefined
      return {
        ...(JSON.parse(row.identity) as Identity),
        createdAt: new Date(row.created_at),
        expiresAt: new Date(row.expires_at),
      }
    },
    async endSession(idHash) {
      const { rows } = await db.query<{ id_hash: string }>(
        "delete from cwa_sessions where id_hash = $1 returning id_hash",
        [idHash],
      )
      return rows.length === 1
    },
  }

  return { ...store, vault, sessions }
}
