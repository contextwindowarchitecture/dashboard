// The query API's read routes (ADR-0007): the tree's documents at the tree's paths, from whichever
// store the service has. The web app reads them with the source it already has, so the last test
// reads every document through that source, from the API and from the demo tree, and requires the
// same.

import { readdirSync, readFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { join, resolve } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import { afterEach, describe, expect, it } from "vitest"

import { createFileSource } from "../../web/src/data/source.ts"
import type { EventStore } from "../src/event-store.ts"
import { createPostgresStore } from "../src/postgres-store.ts"
import { replay } from "../src/replay.ts"
import type { Runner } from "../src/runner.ts"
import { createIngestServer } from "../src/server.ts"

const TREE = resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures")
const EVENTS = readdirSync(join(TREE, "events"))
  .filter((name) => name.endsWith(".json") && name !== "index.json")
  .map((name) => JSON.parse(readFileSync(join(TREE, "events", name), "utf8")) as AssemblyEventV1)
const SESSIONS = readdirSync(join(TREE, "sessions")).map((name) => name.replace(/\.json$/, ""))
const inProcess: Runner = { run: async (snapshot) => replay(snapshot), close: async () => {} }

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function serve(store?: EventStore) {
  const server = createIngestServer({
    runner: inProcess,
    maxBodyBytes: 4 * 1024 * 1024,
    maxQueue: 8,
    ...(store === undefined ? {} : { store }),
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  cleanups.push(() => new Promise((done) => server.close(() => done())))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function demoStore() {
  const db = new PGlite()
  const store = await createPostgresStore(db)
  cleanups.push(async () => {
    await store.close()
    await db.close()
  })
  for (const event of EVENTS) await store.write(event)
  return store
}

const generatedAside = (document: unknown) =>
  typeof document === "object" && document !== null && "generated_at" in document
    ? { ...document, generated_at: "" }
    : document

describe("the read routes", () => {
  it("serve each document at the tree's path, with the tree's cache rules", async () => {
    const base = await serve(await demoStore())
    const event = EVENTS[0]!
    const answer = async (path: string) => {
      const response = await fetch(`${base}${path}`)
      return { status: response.status, cache: response.headers.get("cache-control") }
    }
    expect(await answer(`/data/events/${event.event_id}.json`)).toEqual({
      status: 200,
      cache: "public, max-age=31536000, immutable",
    })
    for (const path of [
      "/data/events/index.json",
      "/data/fleet.json",
      "/data/sources.json",
      `/data/sessions/${SESSIONS[0]}.json`,
    ]) {
      expect(await answer(path), path).toEqual({ status: 200, cache: "no-cache" })
    }
  })

  it("answer 404 for what the store does not hold or no document's path, and 405 for a write", async () => {
    const base = await serve(await demoStore())
    for (const path of [
      "/data/events/01M5ZZZZZZZZZZZZZZZZZZZZZY.json",
      "/data/sessions/no-such-session.json",
      "/data/events/index/2020-01-01.json",
      "/data/events/..%2Ffleet.json",
      "/data/elsewhere.json",
    ]) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(404)
    }
    expect((await fetch(`${base}/data/fleet.json`, { method: "POST" })).status).toBe(405)
  })

  it("answer HEAD as GET, headers without a body, as nginx does for the tree", async () => {
    const base = await serve(await demoStore())
    const head = await fetch(`${base}/data/events/${EVENTS[0]!.event_id}.json`, { method: "HEAD" })
    expect(head.status).toBe(200)
    expect(head.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
    expect(await head.text()).toBe("")
  })

  it("answer a store's failure with a 500 that names nothing of the database", async () => {
    const broken: EventStore = {
      ...(await demoStore()),
      index: async () => {
        throw new Error('relation "cwa_events" does not exist')
      },
      // The routes read a tenant's view: this one is the broken store for every tenant.
      forTenant: () => broken,
    }
    const base = await serve(broken)
    const response = await fetch(`${base}/data/events/index.json`)
    expect(response.status).toBe(500)
    const body = await response.text()
    expect(body).not.toMatch(/cwa_events|relation/)
    expect(JSON.parse(body)).toMatchObject({ ok: false, kind: "internal" })
  })

  it("say the store is not configured when there is none", async () => {
    const base = await serve()
    const response = await fetch(`${base}/data/events/index.json`)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ kind: "not-configured" })
  })

  it("give the web app's source the demo tree's documents, from PostgreSQL", async () => {
    const base = await serve(await demoStore())
    const api = createFileSource(`${base}/data`, fetch)
    const tree = createFileSource("file://tree", async (input) => {
      const path = String(input).replace("file://tree/", "")
      return new Response(readFileSync(join(TREE, path)), { status: 200 })
    })
    expect(generatedAside(await api.index())).toEqual(generatedAside(await tree.index()))
    expect(generatedAside(await api.fleet())).toEqual(generatedAside(await tree.fleet()))
    for (const id of SESSIONS) expect(await api.session(id), id).toEqual(await tree.session(id))
    for (const event of EVENTS) {
      expect(await api.event(event.event_id), event.event_id).toEqual(
        await tree.event(event.event_id),
      )
    }
  }, 60_000)
})
