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
