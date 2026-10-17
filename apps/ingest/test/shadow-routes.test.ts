// The shadow routes (ADR-0008): corpora frozen with the ingest token, read by anyone, and a shadow
// run over one, without a token but one at a time.

import { readdirSync, readFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { join, resolve } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { AssemblyEventV1, CorpusV1, ShadowReportV1 } from "@cwa-dashboard/telemetry/types"
import { validateCorpusV1, validateShadowReportV1 } from "@cwa-dashboard/telemetry/validators"
import { afterEach, describe, expect, it } from "vitest"

import { createPostgresStore } from "../src/postgres-store.ts"
import { replay } from "../src/replay.ts"
import type { Runner } from "../src/runner.ts"
import { createIngestServer } from "../src/server.ts"

const EVENTS = resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures/events")
const ALL = readdirSync(EVENTS)
  .filter((n) => n.endsWith(".json") && n !== "index.json")
  .map((n) => JSON.parse(readFileSync(join(EVENTS, n), "utf8")) as AssemblyEventV1)
const TOKEN = "shadow-token"
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function serve(runner: Runner = { run: async (s) => replay(s), close: async () => {} }) {
  const db = new PGlite()
  const store = await createPostgresStore(db)
  for (const event of ALL) await store.write(event)
  const server = createIngestServer({
    runner,
    maxBodyBytes: 4 * 1024 * 1024,
    maxQueue: 8,
    store,
    token: TOKEN,
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  cleanups.push(async () => {
    await new Promise((done) => server.close(() => done(undefined)))
    await db.close()
  })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (path: string, body: unknown, token?: string) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
  return { base, post }
}

describe("the corpus routes", () => {
  it("freeze a corpus from the window's index with the token, and serve it to anyone", async () => {
    const { base, post } = await serve()
    expect((await post("/corpora", { name: "chat", from: { route: "support-chat" } })).status).toBe(
      401,
    )
    const made = await post(
      "/corpora",
      { name: "chat", from: { route: "support-chat", outcome: "assembled" } },
      TOKEN,
    )
    expect(made.status).toBe(201)
    const corpus = (await (await fetch(`${base}/corpora/chat.json`)).json()) as CorpusV1
    expect(validateCorpusV1(corpus) ? null : validateCorpusV1.errors).toBeNull()
    const chat = ALL.filter(
      (e) => e.snapshot?.route_policy.route === "support-chat" && e.outcome === "assembled",
    )
    expect(corpus.events.map((e) => e.event_id).sort()).toEqual(chat.map((e) => e.event_id).sort())
    expect(
      corpus.events.every(
        (e: { snapshot_digest?: string }) => typeof e.snapshot_digest === "string",
      ),
    ).toBe(true)
    expect(await (await fetch(`${base}/corpora.json`)).json()).toEqual({
      corpora: [{ name: "chat", created_at: corpus.created_at, events: chat.length }],
    })
    expect(
      (await post("/corpora", { name: "chat", event_ids: [ALL[0]!.event_id] }, TOKEN)).status,
    ).toBe(409)
  })

  it("refuse a corpus that names no event, an event the store lacks, or too many", async () => {
    const { post } = await serve()
    expect(
      (await post("/corpora", { name: "Bad Name", event_ids: [ALL[0]!.event_id] }, TOKEN)).status,
    ).toBe(400)
    expect(
      (await post("/corpora", { name: "none", from: { route: "no-such-route" } }, TOKEN)).status,
    ).toBe(400)
    const missing = await post(
      "/corpora",
      { name: "gone", event_ids: ["01M5ZZZZZZZZZZZZZZZZZZZZZY"] },
      TOKEN,
    )
    expect(missing.status).toBe(400)
    expect(JSON.stringify(await missing.json())).toMatch(/01M5ZZZZZZZZZZZZZZZZZZZZZY/)
    const many = Array.from({ length: 201 }, () => ALL[0]!.event_id)
    expect((await post("/corpora", { name: "many", event_ids: many }, TOKEN)).status).toBe(400)
  })
})

describe("the shadow route", () => {
  it("runs a candidate over a corpus without a token, and answers with a valid report", async () => {
    const { post } = await serve()
    await post(
      "/corpora",
      { name: "chat", from: { route: "support-chat", outcome: "assembled" } },
      TOKEN,
    )
    const profile = REGISTRY.profiles.find((p) => p.id === "policy-first-chat")!
    const response = await post("/shadow", { corpus: "chat", candidate: { profile } })
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const report = (await response.json()) as ShadowReportV1
    expect(validateShadowReportV1(report) ? null : validateShadowReportV1.errors).toBeNull()
    expect(report.corpus.name).toBe("chat")
    expect(report.summary.changed).toBeGreaterThan(0)
  })

  it("refuses an unknown corpus, a candidate that names nothing, and a second run at once", async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((done) => (release = done))
    const slow: Runner = { run: async (s) => (await gate, replay(s)), close: async () => {} }
    const { post } = await serve(slow)
    await post("/corpora", { name: "chat", from: { route: "support-chat" } }, TOKEN)
    expect((await post("/shadow", { corpus: "nothing", candidate: { profile: {} } })).status).toBe(
      404,
    )
    expect((await post("/shadow", { corpus: "chat", candidate: {} })).status).toBe(400)
    const first = post("/shadow", { corpus: "chat", candidate: { profile: REGISTRY.profiles[0] } })
    await new Promise((done) => setTimeout(done, 50))
    expect(
      (await post("/shadow", { corpus: "chat", candidate: { profile: REGISTRY.profiles[0] } }))
        .status,
    ).toBe(503)
    release()
    expect((await first).status).toBe(200)
  })
})
