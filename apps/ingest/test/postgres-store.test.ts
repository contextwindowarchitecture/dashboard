import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"

import { createPostgresStore } from "../src/postgres-store.ts"
import { emptyServerDatabase, SERVER } from "./server-database.ts"
import { storeContract } from "./store-contract.ts"

// Real PostgreSQL, compiled to WebAssembly: a fresh database for each test.
storeContract("the PostgreSQL store (PGlite)", async () => {
  const db = new PGlite()
  const store = await createPostgresStore(db)
  return {
    store,
    done: async () => {
      await store.close()
      await db.close()
    },
  }
})

// The same contract against a PostgreSQL server, when TEST_DATABASE_URL names one (test/server-database.ts).
if (SERVER !== undefined) {
  storeContract("the PostgreSQL store (a server)", async () => {
    const pool = await emptyServerDatabase()
    const store = await createPostgresStore(pool, { end: () => pool.end() })
    return { store, done: () => store.close() }
  })
}

describe("migration 2", () => {
  it("derives the source facts of the events a version 1 database already holds", async () => {
    const { indexRow, fleetFacts } = await import("@cwa-dashboard/telemetry/derive")
    const { DEMO_EVENTS } = await import("./store-contract.ts")
    const db = new PGlite()
    // The database as version 1 left it: the table without source_facts, the events in it.
    await db.query("create table cwa_schema (version integer primary key)")
    await db.query(`create table cwa_events (event_id text primary key, recorded_at timestamptz not null,
      session_id text, turn_index integer, event text not null, index_row text not null, facts text not null)`)
    await db.query("insert into cwa_schema (version) values (1)")
    for (const event of DEMO_EVENTS) {
      await db.query(
        `insert into cwa_events (event_id, recorded_at, session_id, turn_index, event, index_row, facts)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          event.event_id,
          event.recorded_at,
          event.session?.id ?? null,
          event.session?.turn_index ?? null,
          JSON.stringify(event),
          JSON.stringify(indexRow(event)),
          JSON.stringify(fleetFacts(event)),
        ],
      )
    }
    const store = await createPostgresStore(db)
    const sources = await store.sources()
    const tree = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures/sources.json"),
        "utf8",
      ),
    )
    expect({ ...sources, generated_at: "" }).toEqual({ ...tree, generated_at: "" })
    expect(
      (await db.query<{ version: number }>("select max(version) as version from cwa_schema"))
        .rows[0]!.version,
    ).toBeGreaterThanOrEqual(2)
    await store.close()
    await db.close()
  })
})

describe("migration 3", () => {
  it("rewrites the index rows a version 2 database holds, so they carry the compression saving", async () => {
    const { DEMO_EVENTS } = await import("./store-contract.ts")
    const db = new PGlite()
    const store = await createPostgresStore(db)
    for (const event of DEMO_EVENTS) await store.write(event)
    // As version 2 left them: the rows without the saving, and the schema at 2.
    const { rows } = await db.query<{ event_id: string; index_row: string }>(
      "select event_id, index_row from cwa_events",
    )
    for (const row of rows) {
      const old = JSON.parse(row.index_row)
      delete old.compressed_saved
      await db.query("update cwa_events set index_row = $1 where event_id = $2", [
        JSON.stringify(old),
        row.event_id,
      ])
    }
    // What later migrations added does not exist at version 2.
    await db.query("drop table if exists cwa_corpora")
    await db.query("drop table if exists cwa_bodies")
    await db.query("drop table if exists cwa_logins, cwa_sessions")
    await db.query("alter table cwa_events drop column if exists tenant")
    await db.query("drop table if exists cwa_drafts")
    await db.query("delete from cwa_schema where version > 2")
    const reopened = await createPostgresStore(db)
    const index = await reopened.index()
    expect(index.events.filter((row) => row.compressed_saved !== undefined).length).toBe(86)
    await db.close()
  })
})

describe("migration 7", () => {
  it("puts the events and corpora a version 6 database holds in the default tenant", async () => {
    const { DEMO_EVENTS } = await import("./store-contract.ts")
    const db = new PGlite()
    const store = await createPostgresStore(db)
    for (const event of DEMO_EVENTS) await store.write(event)
    await store.saveCorpus({
      $schema: "cwa-dashboard/corpus/v1",
      name: "chat",
      created_at: "2026-10-17T12:00:00.000Z",
      events: [{ event_id: DEMO_EVENTS[0]!.event_id }],
    })
    // As version 6 left them: no tenant anywhere, corpora keyed by name alone.
    await db.query("alter table cwa_events drop column tenant")
    await db.query("alter table cwa_corpora drop constraint cwa_corpora_pkey")
    await db.query("alter table cwa_corpora drop column tenant")
    await db.query("alter table cwa_corpora add primary key (name)")
    await db.query("drop table cwa_drafts")
    await db.query("delete from cwa_schema where version > 6")
    const reopened = await createPostgresStore(db)
    expect(await reopened.tenants()).toEqual([{ tenant: "default", events: DEMO_EVENTS.length }])
    expect((await reopened.index()).events).toHaveLength(DEMO_EVENTS.length)
    expect(await reopened.corpus("chat")).toBeDefined()
    expect(await reopened.forTenant("northwind").corpus("chat")).toBeUndefined()
    await db.close()
  })
})

describe("migration 9", () => {
  it("keeps the drafts a version 8 database holds, in the default tenant", async () => {
    const db = new PGlite()
    const store = await createPostgresStore(db)
    const draft = {
      $schema: "cwa-dashboard/draft/v1" as const,
      id: "a1b2c3d4-0000-4000-8000-000000000001",
      kind: "profile" as const,
      started_from: null,
      route: "support-chat",
      document: {},
      updated_at: "2026-10-17T12:00:00.000Z",
    }
    await store.drafts.put("ada", "default", draft)
    // As version 8 left it: drafts by author alone.
    await db.query("drop index if exists cwa_drafts_author_tenant")
    await db.query("alter table cwa_drafts drop column tenant")
    await db.query("delete from cwa_schema where version > 8")
    const reopened = await createPostgresStore(db)
    expect(await reopened.drafts.get("ada", "default", draft.id)).toEqual(draft)
    expect(await reopened.drafts.get("ada", "northwind", draft.id)).toBeUndefined()
    await db.close()
  })
})
