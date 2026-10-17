// Opens the event store the environment names (ADR-0007): DATABASE_URL for PostgreSQL, a server's
// `postgres://` URL through a node-postgres pool, or `pglite:memory` / `pglite:<directory>` for
// PostgreSQL in WebAssembly, with no server, for a local run; otherwise EVENTS_DIR for the tree;
// otherwise none, and the service only replays.

import { isAbsolute, relative, resolve, sep } from "node:path"

import type { EventStore } from "./event-store.ts"
import { createPostgresStore } from "./postgres-store.ts"
import { createStore } from "./store.ts"
import { type BodyVault, directoryVault } from "./vault.ts"

export interface OpenedStore {
  readonly kind: "postgres" | "tree"
  readonly store: EventStore
  /** The PostgreSQL store's own vault (ADR-0009); a tree has none. */
  readonly vault?: BodyVault
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
      const store = await createPostgresStore(db, { end: () => db.close() })
      return { kind: "postgres", store, vault: store.vault }
    }
    if (/^postgres(ql)?:\/\//.test(url)) {
      const { default: pg } = await import("pg")
      const pool = new pg.Pool({ connectionString: url })
      const store = await createPostgresStore(pool, { end: () => pool.end() })
      return { kind: "postgres", store, vault: store.vault }
    }
    throw new Error("DATABASE_URL must be postgres://…, pglite:memory or pglite:<directory>")
  }
  const dir = env["EVENTS_DIR"]
  if (dir !== undefined && dir !== "") return { kind: "tree", store: await createStore(dir) }
  return undefined
}

/**
 * The vault the environment names (ADR-0009): the PostgreSQL store's, with DATABASE_URL; else
 * VAULT_DIR, refused inside EVENTS_DIR, which the web server serves under /data/ without a token;
 * else none.
 */
export function openVault(
  env: Readonly<Record<string, string | undefined>>,
  opened: OpenedStore | undefined,
): BodyVault | undefined {
  const dir = env["VAULT_DIR"]
  const hasDir = dir !== undefined && dir !== ""
  if (opened?.vault !== undefined) {
    if (hasDir)
      throw new Error("Set one vault: DATABASE_URL keeps bodies itself, so leave VAULT_DIR unset.")
    return opened.vault
  }
  if (!hasDir) return undefined
  const tree = env["EVENTS_DIR"]
  if (tree !== undefined && tree !== "") {
    const within = relative(resolve(tree), resolve(dir))
    if (
      within === "" ||
      (within !== ".." && !within.startsWith(`..${sep}`) && !isAbsolute(within))
    ) {
      throw new Error(
        "VAULT_DIR must be outside EVENTS_DIR: the web server serves the tree without a token.",
      )
    }
  }
  return directoryVault(dir)
}
