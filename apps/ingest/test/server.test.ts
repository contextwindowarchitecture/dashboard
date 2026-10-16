import { createHash } from "node:crypto"
import { request as httpRequest } from "node:http"
import { readFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { join, resolve } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { replay } from "../src/replay.ts"
import { ReplayTimeoutError, type Runner } from "../src/runner.ts"
import { createIngestServer } from "../src/server.ts"

const cases = resolve(
  import.meta.dirname,
  "../../../packages/contract/vendor/cwa/conformance/cases",
)
const snapshotOf = (id: string) => readFileSync(join(cases, id, "snapshot.json"), "utf8")

// The replay core in-process: the server's behaviour without a worker in the way.
const inProcess: Runner = { run: async (snapshot) => replay(snapshot), close: async () => {} }

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})

async function start(options: Partial<Parameters<typeof createIngestServer>[0]> = {}) {
  const server = createIngestServer({
    runner: inProcess,
    maxBodyBytes: 4 * 1024 * 1024,
    maxQueue: 8,
    ...options,
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  close = () => new Promise((done) => server.close(() => done()))
  const { port } = server.address() as AddressInfo
  return (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}`, init)
}
const post = (body: string, type = "application/json") => ({
  method: "POST",
  headers: { "content-type": type },
  body,
})

describe("the ingest service", () => {
  it("answers its health check", async () => {
    const call = await start()
    const response = await call("/healthz")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it("lists the published tokenizers and renderers, required or not, and whether it provides each", async () => {
    const call = await start()
    const body = (await (await call("/replay/components")).json()) as {
      tokenizers: { id: string; required: boolean; provided: boolean }[]
      renderers: { id: string; required: boolean; provided: boolean }[]
    }
    expect(body.tokenizers).toContainEqual({
      id: "estimate-utf8/v1",
      required: true,
      provided: true,
    })
    expect(body.renderers).toContainEqual({
      id: "cwa-message-blocks/v1",
      required: false,
      provided: true,
    })
  })

  it("replays a snapshot to its expected payload", async () => {
    const call = await start()
    const response = await call("/replay", post(snapshotOf("messages-render")))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const body = (await response.json()) as { payload_hash: string }
    const payload = readFileSync(join(cases, "messages-render", "expected.payload.txt"))
    expect(body.payload_hash).toBe(createHash("sha256").update(payload).digest("hex"))
  })

  it("says what is wrong with a body that is not a snapshot to replay", async () => {
    const call = await start()
    const notJson = await call("/replay", post("{"))
    expect(notJson.status).toBe(400)
    expect(await notJson.json()).toMatchObject({ ok: false, kind: "invalid-json" })
    const rejected = await call("/replay", post("{}"))
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toMatchObject({ ok: false, kind: "rejected" })
    const notTyped = await call("/replay", post(snapshotOf("messages-render"), "text/plain"))
    expect(notTyped.status).toBe(415)
  })

  it("refuses a body over the limit without reading it all", async () => {
    const call = await start({ maxBodyBytes: 1024 })
    const response = await call("/replay", post(snapshotOf("admission-reasons")))
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ ok: false, kind: "too-large" })
  })

  it("stops reading a body over the limit that does not declare its length", async () => {
    const call = await start({ maxBodyBytes: 1024 })
    const port = new URL((await call("/healthz")).url).port
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/replay",
          method: "POST",
          headers: { "content-type": "application/json" },
        },
        (response) => {
          response.resume()
          resolve(response.statusCode ?? 0)
        },
      )
      request.on("error", reject)
      // No content-length: the body arrives chunked, and the limit is found while reading.
      for (let i = 0; i < 8; i += 1) request.write("x".repeat(512))
      request.end()
    })
    expect(status).toBe(413)
  })

  it("answers 504 when a replay outruns its time", async () => {
    const slow: Runner = {
      run: async () => Promise.reject(new ReplayTimeoutError(50)),
      close: async () => {},
    }
    const call = await start({ runner: slow })
    const response = await call("/replay", post(snapshotOf("messages-render")))
    expect(response.status).toBe(504)
    expect(await response.json()).toMatchObject({ ok: false, kind: "timeout" })
  })

  it("answers 503 rather than queueing without end", async () => {
    let release = () => {}
    const held = new Promise<void>((done) => (release = done))
    const holding: Runner = {
      run: async (snapshot) => {
        await held
        return replay(snapshot)
      },
      close: async () => {},
    }
    const call = await start({ runner: holding, maxQueue: 1 })
    const first = call("/replay", post(snapshotOf("messages-render")))
    await new Promise((done) => setTimeout(done, 50))
    const second = await call("/replay", post(snapshotOf("messages-render")))
    expect(second.status).toBe(503)
    release()
    expect((await first).status).toBe(200)
  })

  it("answers 404 for another path and 405 for another method", async () => {
    const call = await start()
    expect((await call("/nowhere")).status).toBe(404)
    const get = await call("/replay")
    expect(get.status).toBe(405)
    expect(get.headers.get("allow")).toBe("POST")
  })
})
