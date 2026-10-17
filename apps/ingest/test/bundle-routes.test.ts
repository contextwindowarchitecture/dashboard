// The compliance routes: GET /bundles/<event id>.json signs a bundle for a stored event, and
// GET /signing-key.pem serves the public key that checks it.

import { generateKeyPairSync, verify } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { join, resolve } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { canonicalJson } from "@cwa-dashboard/telemetry/canonical"
import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import { afterEach, describe, expect, it } from "vitest"

import { signingKeyFrom } from "../src/bundle.ts"
import { createPostgresStore } from "../src/postgres-store.ts"
import { replay } from "../src/replay.ts"
import type { Runner } from "../src/runner.ts"
import { createIngestServer } from "../src/server.ts"

const EVENTS = resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures/events")
const FIRST = JSON.parse(
  readFileSync(
    join(
      EVENTS,
      readdirSync(EVENTS).find((n) => n !== "index.json")!,
    ),
    "utf8",
  ),
) as AssemblyEventV1
const KEY = signingKeyFrom(
  generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
)
const inProcess: Runner = { run: async (snapshot) => replay(snapshot), close: async () => {} }

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function serve(withKey: boolean) {
  const db = new PGlite()
  const store = await createPostgresStore(db)
  await store.write(FIRST)
  const server = createIngestServer({
    runner: inProcess,
    maxBodyBytes: 4 * 1024 * 1024,
    maxQueue: 8,
    store,
    ...(withKey ? { signingKey: KEY } : {}),
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  cleanups.push(async () => {
    await new Promise((done) => server.close(() => done(undefined)))
    await db.close()
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe("the compliance routes", () => {
  it("sign a bundle for a stored event that the served key verifies, never cached", async () => {
    const base = await serve(true)
    const response = await fetch(`${base}/bundles/${FIRST.event_id}.json`)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const { signature, ...unsigned } = (await response.json()) as {
      signature: { value: string }
      event: { event_id: string }
    }
    const pem = await (await fetch(`${base}/signing-key.pem`)).text()
    expect(pem).toBe(KEY.publicPem)
    expect(
      verify(
        null,
        Buffer.from(canonicalJson(unsigned)),
        pem,
        Buffer.from(signature.value, "base64"),
      ),
    ).toBe(true)
    expect(unsigned.event.event_id).toBe(FIRST.event_id)
  })

  it("answer 404 for an event the store does not hold, or an id that names none", async () => {
    const base = await serve(true)
    expect((await fetch(`${base}/bundles/01M5ZZZZZZZZZZZZZZZZZZZZZY.json`)).status).toBe(404)
    expect((await fetch(`${base}/bundles/..%2Ffleet.json`)).status).toBe(404)
  })

  it("say there is no signing key, rather than sign with none", async () => {
    const base = await serve(false)
    for (const path of [`/bundles/${FIRST.event_id}.json`, "/signing-key.pem"]) {
      const response = await fetch(`${base}${path}`)
      expect(response.status, path).toBe(503)
      expect(await response.json()).toMatchObject({ kind: "not-configured" })
    }
  })
})
