import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { createStore } from "../src/store.ts"
import { storeContract } from "./store-contract.ts"

const FIRST = readdirSync(
  join(import.meta.dirname, "../../../packages/demo-traffic/fixtures/events"),
).find((name) => name.endsWith(".json") && name !== "index.json")!

storeContract("the tree store", async () => {
  const root = mkdtempSync(join(tmpdir(), "cwa-tree-store-"))
  const store = await createStore(root, { debounceMs: 1 })
  return {
    store,
    done: async () => {
      await store.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
})

describe("the tree store's files", () => {
  it("keeps fleet.json and sources.json current, so a posted event reaches both pages", async () => {
    const root = mkdtempSync(join(tmpdir(), "cwa-tree-store-"))
    const store = await createStore(root, { debounceMs: 1 })
    try {
      const event = JSON.parse(
        readFileSync(
          join(import.meta.dirname, "../../../packages/demo-traffic/fixtures/events", FIRST),
          "utf8",
        ),
      )
      await store.write({ ...event, service: { name: "posted-service", environment: "demo" } })
      await store.flush()
      const onDisk = JSON.parse(readFileSync(join(root, "fleet.json"), "utf8"))
      expect(onDisk.services.map((s: { name: string }) => s.name)).toEqual(["posted-service"])
      expect(onDisk).toEqual(await store.fleet())
      const sources = JSON.parse(readFileSync(join(root, "sources.json"), "utf8"))
      expect(sources.producers.length).toBeGreaterThan(0)
      expect(sources).toEqual(await store.sources())
    } finally {
      await store.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("a tree written before the index rows' compression saving", () => {
  it("gets it on start, for the current window's rows", async () => {
    const { cpSync, writeFileSync } = await import("node:fs")
    const root = mkdtempSync(join(tmpdir(), "cwa-tree-store-"))
    cpSync(join(import.meta.dirname, "../../../packages/demo-traffic/fixtures"), root, {
      recursive: true,
    })
    const indexPath = join(root, "events/index.json")
    const old = JSON.parse(readFileSync(indexPath, "utf8"))
    for (const row of old.events) delete row.compressed_saved
    writeFileSync(indexPath, JSON.stringify(old))
    const store = await createStore(root, { debounceMs: 1 })
    try {
      await store.flush()
      const rows = (await store.index()).events
      expect(rows.filter((row) => row.compressed_saved !== undefined).length).toBe(86)
    } finally {
      await store.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
