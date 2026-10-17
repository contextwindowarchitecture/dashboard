import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { openStore, openVault } from "../src/open-store.ts"
import { TEXT_TYPE } from "../src/vault.ts"

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

describe("openVault", () => {
  const bytes = new TextEncoder().encode("a body")
  const sha = "8f6b4e7b1c1bb4f3b2bb2a3d5e1b1b7a0f2b4e3c1d6a7b8c9d0e1f2a3b4c5d6e"

  it("keeps bodies in the PostgreSQL store's own database", async () => {
    const opened = await openStore({ DATABASE_URL: "pglite:memory" })
    const vault = openVault({ DATABASE_URL: "pglite:memory" }, opened)
    expect(await vault!.put(sha, { bytes, mediaType: TEXT_TYPE })).toBe("stored")
    expect((await opened!.store.event("0".repeat(26))) ?? null).toBeNull()
    await opened!.store.close()
  })

  it("keeps bodies in VAULT_DIR beside a tree, never inside the tree the web server serves", async () => {
    const root = mkdtempSync(join(tmpdir(), "cwa-open-vault-"))
    try {
      const env = { EVENTS_DIR: join(root, "tree"), VAULT_DIR: join(root, "vault") }
      const vault = openVault(env, undefined)
      expect(await vault!.put(sha, { bytes, mediaType: TEXT_TYPE })).toBe("stored")
      // The tree's parent holds the tree, but nothing the web server serves.
      expect(
        openVault({ EVENTS_DIR: join(root, "tree"), VAULT_DIR: root }, undefined),
      ).toBeDefined()
      for (const inside of [
        join(root, "tree"),
        join(root, "tree", "vault"),
        join(root, "tree", "..x"),
      ]) {
        expect(() =>
          openVault({ EVENTS_DIR: join(root, "tree"), VAULT_DIR: inside }, undefined),
        ).toThrow(/outside EVENTS_DIR/)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("opens no vault without either, and refuses both at once", async () => {
    expect(openVault({}, undefined)).toBeUndefined()
    const opened = await openStore({ DATABASE_URL: "pglite:memory" })
    expect(() => openVault({ DATABASE_URL: "pglite:memory", VAULT_DIR: "/tmp/v" }, opened)).toThrow(
      /one vault/,
    )
    await opened!.store.close()
  })
})
