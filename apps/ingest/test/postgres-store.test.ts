import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"

import { createPostgresStore } from "../src/postgres-store.ts"
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

// The same contract against a PostgreSQL server, when TEST_DATABASE_URL names one (its cwa_ tables
// are dropped before each test): `podman run -e POSTGRES_PASSWORD=… -p 5432:5432 postgres`.
const server = process.env["TEST_DATABASE_URL"]
if (server !== undefined && server !== "") {
  storeContract("the PostgreSQL store (a server)", async () => {
    const { default: pg } = await import("pg")
    const pool = new pg.Pool({ connectionString: server })
    await pool.query("drop table if exists cwa_events, cwa_schema")
    const store = await createPostgresStore(pool)
    return { store, done: () => pool.end() }
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
    await db.query("delete from cwa_schema where version > 2")
    const reopened = await createPostgresStore(db)
    const index = await reopened.index()
    expect(index.events.filter((row) => row.compressed_saved !== undefined).length).toBe(86)
    await db.close()
  })
})
