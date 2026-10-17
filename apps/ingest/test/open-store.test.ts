import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { openStore } from "../src/open-store.ts"

describe("openStore", () => {
  it("opens PostgreSQL in memory for pglite:memory, and a tree for EVENTS_DIR without one", async () => {
    const pg = await openStore({ DATABASE_URL: "pglite:memory" })
    expect(pg?.kind).toBe("postgres")
    expect((await pg!.store.index()).events).toEqual([])
    await pg!.store.close()

    const root = mkdtempSync(join(tmpdir(), "cwa-open-store-"))
    try {
      const tree = await openStore({ EVENTS_DIR: root })
      expect(tree?.kind).toBe("tree")
      await tree!.store.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("prefers DATABASE_URL to EVENTS_DIR, and opens nothing without either", async () => {
    const both = await openStore({ DATABASE_URL: "pglite:memory", EVENTS_DIR: "/nowhere" })
    expect(both?.kind).toBe("postgres")
    await both!.store.close()
    expect(await openStore({})).toBeUndefined()
    expect(await openStore({ DATABASE_URL: "", EVENTS_DIR: "" })).toBeUndefined()
  })

  it("keeps a pglite:<directory> database across openings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cwa-pglite-"))
    try {
      const first = await openStore({ DATABASE_URL: `pglite:${dir}` })
      const event = (await import("./store-contract.ts")).DEMO_EVENTS[0]!
      expect(await first!.store.write(event)).toMatchObject({ ok: true })
      await first!.store.close()
      const second = await openStore({ DATABASE_URL: `pglite:${dir}` })
      expect(await second!.store.event(event.event_id)).toEqual(event)
      await second!.store.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("refuses a DATABASE_URL it cannot open, naming the setting", async () => {
    await expect(openStore({ DATABASE_URL: "mysql://somewhere/db" })).rejects.toThrow(
      /DATABASE_URL/,
    )
  })
})
