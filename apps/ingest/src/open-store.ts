// Opens the event store the environment names (ADR-0007): DATABASE_URL for PostgreSQL, a server's
// `postgres://` URL through a node-postgres pool, or `pglite:memory` / `pglite:<directory>` for
// PostgreSQL in WebAssembly, with no server, for a local run; otherwise EVENTS_DIR for the tree;
// otherwise none, and the service only replays.

import type { EventStore } from "./event-store.ts"
import { createPostgresStore } from "./postgres-store.ts"
import { createStore } from "./store.ts"

export interface OpenedStore {
  readonly kind: "postgres" | "tree"
  readonly store: EventStore
}

export async function openStore(
  env: Readonly<Record<string, string | undefined>>,
): Promise<OpenedStore | undefined> {
  const url = env["DATABASE_URL"]
  if (url !== undefined && url !== "") {
    if (url.startsWith("pglite:")) {
      const { PGlite } = await import("@electric-sql/pglite")
      const location = url.slice("pglite:".length)
      const db = location === "memory" ? new PGlite() : new PGlite(location)
      return { kind: "postgres", store: await createPostgresStore(db, { end: () => db.close() }) }
    }
    if (/^postgres(ql)?:\/\//.test(url)) {
      const { default: pg } = await import("pg")
      const pool = new pg.Pool({ connectionString: url })
      return { kind: "postgres", store: await createPostgresStore(pool, { end: () => pool.end() }) }
    }
    throw new Error("DATABASE_URL must be postgres://…, pglite:memory or pglite:<directory>")
  }
  const dir = env["EVENTS_DIR"]
  if (dir !== undefined && dir !== "") return { kind: "tree", store: await createStore(dir) }
  return undefined
}
