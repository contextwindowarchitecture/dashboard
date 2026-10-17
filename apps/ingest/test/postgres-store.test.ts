import { PGlite } from "@electric-sql/pglite"

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
