// Every route's answer to every role (ADR-0011), as one table: a reader not signed in, a member with
// no group, an owner of the support chat, an auditor and an operator, each signed in through the test
// issuer, against a store holding the demo events. Then what each reads of an event's bodies, and how
// the answers may be cached. Adding a route means adding its row.

import { createHash, generateKeyPairSync } from "node:crypto"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { accessFrom, loadAccess } from "../src/access.ts"
import { createAuth } from "../src/auth.ts"
import { signingKeyFrom } from "../src/bundle.ts"
import { createPostgresStore, type PostgresStore } from "../src/postgres-store.ts"
import { replay } from "../src/replay.ts"
import type { Runner } from "../src/runner.ts"
import { createIngestServer } from "../src/server.ts"
import { TEXT_TYPE } from "../src/vault.ts"
import { startIssuer } from "./oidc-issuer.ts"
import { freePort, signIn } from "./sign-in.ts"
import { DEMO_EVENTS, inTenant } from "./store-contract.ts"
import { DEMO_DEPOSITS } from "./vault-contract.ts"

const CLIENT = { clientId: "cwa-dashboard", clientSecret: "client-secret" }
const KEY = signingKeyFrom(
  generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
)
const VAULT = join(import.meta.dirname, "../../../packages/demo-traffic/vault")
const runner: Runner = { run: async (snapshot) => replay(snapshot), close: async () => {} }
const routeOf = (e: AssemblyEventV1) => e.snapshot?.route_policy.route
const full = (test: (e: AssemblyEventV1) => boolean) =>
  DEMO_EVENTS.find((e) => e.outcome === "assembled" && e.redaction_mode === "full" && test(e))!
const CHAT = full((e) => routeOf(e) === "support-chat")
const OTHER = full((e) => routeOf(e) !== "support-chat")
const SESSION = DEMO_EVENTS.find((e) => e.session !== undefined)!.session!.id
const ACCESS = {
  anonymous: [],
  signed_in: [],
  groups: {
    "cwa:members": ["viewer"],
    "cwa:owners": ["viewer", "owner:support-chat"],
    "cwa:auditors": ["auditor"],
    "cwa:ops": ["operator"],
    // Only the default tenant's viewer.
    "cwa:local": ["viewer@default"],
    // Owns the review agent's route, whose bodies are in the vault.
    "cwa:agents": ["owner:agent-loop"],
  },
}

type Reader = "anonymous" | "member" | "owner" | "auditor" | "operator" | "local" | "agents"
const READERS: Reader[] = ["anonymous", "member", "owner", "auditor", "operator", "local", "agents"]
const GROUPS: Record<Exclude<Reader, "anonymous">, string[]> = {
  member: ["cwa:members"],
  owner: ["cwa:owners"],
  auditor: ["cwa:auditors"],
  operator: ["cwa:ops"],
  // Only the default tenant's viewer.
  local: ["cwa:local"],
  // Owns the review agent's route, whose bodies are in the vault.
  agents: ["cwa:agents"],
}
const NORTHWIND = inTenant(
  DEMO_EVENTS.filter((e) => e.session?.id === "refund-7"),
  "northwind",
)

let base = ""
let store: PostgresStore
const cookies: Partial<Record<Reader, string>> = {}
let stop: () => Promise<void> = async () => undefined

beforeAll(async () => {
  const issuer = await startIssuer({ ...CLIENT, person: { sub: "x", name: "x" } })
  const db = new PGlite()
  store = await createPostgresStore(db)
  for (const event of [...DEMO_EVENTS, ...NORTHWIND]) await store.write(event)
  // A body the vault holds that the review agent's events do not: a session must not reach it.
  await store.vault.put(DEMO_DEPOSITS[0]!.sha256, DEMO_DEPOSITS[0]!.deposit)
  // The demo vault's bodies, deposited as the review agent's wrapper would.
  for (const prefix of readdirSync(VAULT)) {
    for (const name of readdirSync(join(VAULT, prefix))) {
      const bytes = new Uint8Array(readFileSync(join(VAULT, prefix, name)))
      await store.vault.put(name.split(".")[0]!, { bytes, mediaType: TEXT_TYPE })
    }
  }
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  const server = createIngestServer({
    runner,
    maxBodyBytes: 4 * 1024 * 1024,
    maxQueue: 8,
    store,
    signingKey: KEY,
    vault: store.vault,
    vaultToken: "operator-token",
    access: accessFrom(ACCESS),
    auth: createAuth({
      config: { issuer: issuer.url, ...CLIENT, redirectUri: `${base}/auth/callback` },
      sessions: store.sessions,
    }),
  })
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done))
  for (const [reader, groups] of Object.entries(GROUPS)) {
    issuer.signInAs({ sub: reader, name: reader, groups })
    cookies[reader as Reader] = (await signIn(base)).session!.value
  }
  stop = async () => {
    await new Promise((done) => server.close(() => done(undefined)))
    await db.close()
    await issuer.close()
  }
})
afterAll(() => stop())

const ask = (reader: Reader, method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookies[reader] ? { cookie: `cwa_session=${cookies[reader]}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

// "pass": any answer but a refusal for want of a role (the route then answers on its own terms).
type Expect = number | "pass"
const every = (status: Expect): Record<Reader, Expect> =>
  Object.fromEntries(READERS.map((r) => [r, status])) as Record<Reader, Expect>
const readers = (status: Expect): Record<Reader, Expect> => ({ ...every(status), anonymous: 401 })

const TABLE: [string, string, Record<Reader, Expect>, unknown?][] = [
  ["GET", "/healthz", every(200)],
  ["GET", "/me", every(200)],
  ["GET", "/replay/components", every(200)],
  ["GET", "/signing-key.pem", every(200)],
  ["GET", "/data/events/index.json", readers(200)],
  ["GET", "/data/events/index/2026-01-01.json", readers(404)],
  ["GET", `/data/events/${CHAT.event_id}.json`, readers(200)],
  ["GET", `/data/sessions/${SESSION}.json`, readers(200)],
  ["GET", "/data/fleet.json", readers(200)],
  ["GET", "/data/sources.json", readers(200)],
  ["GET", "/corpora.json", readers(200)],
  ["GET", "/corpora/none.json", readers(404)],
  ["POST", "/shadow", readers(404), { corpus: "none", candidate: { profile: {} } }],
  ["POST", "/replay", readers("pass"), CHAT.snapshot],
  ["GET", `/bundles/${CHAT.event_id}.json`, { ...readers(403), owner: 200, auditor: 200 }],
  ["GET", `/bundles/${OTHER.event_id}.json`, { ...readers(403), auditor: 200 }],
  // Another tenant's documents (ADR-0012): no reader whose roles stop at the default's.
  ["GET", "/data/tenants/northwind/events/index.json", { ...readers(200), local: 403 }],
  [
    "GET",
    `/data/tenants/northwind/events/${NORTHWIND[0]!.event_id}.json`,
    { ...readers(200), local: 403 },
  ],
  ["GET", "/data/tenants/northwind/sessions/refund-7.json", { ...readers(200), local: 403 }],
  // A name no tenant can have names nothing, before anyone's roles are asked.
  ["GET", "/data/tenants/Not-A-Tenant/events/index.json", every(404)],
  ["GET", "/data/tenants.json", readers(200)],
  ["GET", "/corpora.json?tenant=northwind", { ...readers(200), local: 403 }],
  [
    "GET",
    `/bundles/${NORTHWIND[0]!.event_id}.json?tenant=northwind`,
    { ...readers(403), owner: 200, auditor: 200, local: 403 },
  ],
]

describe("every route's answer to every role", () => {
  for (const [method, path, expected, body] of TABLE) {
    it(`${method} ${path}`, async () => {
      for (const reader of READERS) {
        const status = (await ask(reader, method, path, body)).status
        const want = expected[reader]
        if (want === "pass") expect([401, 403], `${reader}`).not.toContain(status)
        else expect(status, `${reader}`).toBe(want)
      }
    })
  }
})

describe("what each reads of an event's bodies", () => {
  const read = async (reader: Reader, event: AssemblyEventV1) =>
    (await (
      await ask(reader, "GET", `/data/events/${event.event_id}.json`)
    ).json()) as AssemblyEventV1
  const firstBody = (event: AssemblyEventV1) =>
    (event.snapshot!.batches[0]!.items[0] as { body: unknown }).body

  it("gives an owner their route's bodies as stored", async () => {
    expect(await read("owner", CHAT)).toEqual(CHAT)
  })

  it("withholds the bodies of a route a reader does not own, keeping the mode and every other field", async () => {
    for (const [reader, event] of [
      ["owner", OTHER],
      ["member", CHAT],
      ["auditor", CHAT],
      ["operator", CHAT],
    ] as const) {
      const served = await read(reader, event)
      expect(firstBody(served), reader).toMatchObject({ withheld: "role" })
      expect(served.redaction_mode).toBe("full")
      expect(served.trace).toEqual(event.trace)
    }
  })

  it("keeps the answers out of shared caches when access is controlled", async () => {
    const answer = await ask("owner", "GET", `/data/events/${CHAT.event_id}.json`)
    expect(answer.headers.get("cache-control")).toBe("private, no-cache")
    const index = await ask("member", "GET", "/data/events/index.json")
    expect(index.headers.get("cache-control")).toBe("private, no-cache")
  })

  it("says why a reader is refused: to sign in, or that the role does not reach", async () => {
    const anonymous = await ask("anonymous", "GET", "/data/events/index.json")
    expect(await anonymous.json()).toMatchObject({ kind: "sign-in" })
    const member = await ask("member", "GET", `/bundles/${CHAT.event_id}.json`)
    expect(await member.json()).toMatchObject({ kind: "forbidden" })
  })

  it("tells a reader their roles", async () => {
    expect(await (await ask("owner", "GET", "/me")).json()).toMatchObject({
      signed_in: true,
      roles: ["owner:support-chat", "viewer"],
    })
    expect(await (await ask("anonymous", "GET", "/me")).json()).toMatchObject({
      signed_in: false,
      roles: [],
    })
  })
})

describe("loadAccess", () => {
  it("reads ACCESS_FILE, and is no access control without it", () => {
    const dir = mkdtempSync(join(tmpdir(), "cwa-access-"))
    try {
      writeFileSync(join(dir, "access.json"), JSON.stringify(ACCESS))
      expect(loadAccess({ ACCESS_FILE: join(dir, "access.json") })).toEqual(accessFrom(ACCESS))
      expect(loadAccess({})).toBeUndefined()
      writeFileSync(join(dir, "bad.json"), JSON.stringify({ anonymous: ["root"] }))
      expect(() => loadAccess({ ACCESS_FILE: join(dir, "bad.json") })).toThrow(/root/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("tenants through the routes (ADR-0012)", () => {
  const json = async (reader: Reader, path: string) => (await ask(reader, "GET", path)).json()

  it("serves another tenant's documents with its events alone", async () => {
    const index = (await json("member", "/data/tenants/northwind/events/index.json")) as {
      events: { event_id: string }[]
    }
    expect(index.events.map((row) => row.event_id).sort()).toEqual(
      NORTHWIND.map((e) => e.event_id).sort(),
    )
    // An event is found under its own tenant only.
    expect((await ask("member", "GET", `/data/events/${NORTHWIND[0]!.event_id}.json`)).status).toBe(
      404,
    )
  })

  it("lists the tenants a reader may read, and only those", async () => {
    expect(await json("member", "/data/tenants.json")).toEqual({
      $schema: "cwa-dashboard/tenants/v1",
      tenants: [
        { tenant: "default", events: DEMO_EVENTS.length },
        { tenant: "northwind", events: NORTHWIND.length },
      ],
    })
    expect(await json("local", "/data/tenants.json")).toEqual({
      $schema: "cwa-dashboard/tenants/v1",
      tenants: [{ tenant: "default", events: DEMO_EVENTS.length }],
    })
  })
})

describe("the vault by role (ADR-0012)", () => {
  const agent = DEMO_EVENTS.find((e) => e.vault !== undefined && e.outcome === "assembled")!
  const held = JSON.stringify(agent.snapshot).match(/(?<="content_sha256":")[0-9a-f]{64}/g)!
  const sha = held[0]!
  const resolve = (reader: Reader, digest: string, event = agent.event_id) =>
    ask(reader, "GET", `/bodies/${digest}?event=${event}`)

  it("gives a route's owner a body its event holds, by session, and logs who", async () => {
    const lines: string[] = []
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk))
      return true
    })
    try {
      const answer = await resolve("agents", sha)
      expect(answer.status).toBe(200)
      const bytes = Buffer.from(await answer.arrayBuffer())
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha)
    } finally {
      spy.mockRestore()
    }
    expect(lines.join("")).toMatch(
      new RegExp(`vault: resolved ${sha} for agents via ${agent.event_id}`),
    )
  })

  it("refuses a reader who does not own the event's route, and one without a session", async () => {
    expect((await resolve("member", sha)).status).toBe(403)
    expect((await resolve("owner", sha)).status).toBe(403)
    expect((await resolve("anonymous", sha)).status).toBe(401)
  })

  it("gives nothing for a digest the event does not hold, or an event the reader cannot see", async () => {
    const other = DEMO_DEPOSITS[0]!.sha256
    expect(held).not.toContain(other)
    expect((await resolve("agents", other)).status).toBe(404)
    expect((await resolve("agents", sha, "01M5ZZZZZZZZZZZZZZZZZZZZZY")).status).toBe(404)
  })

  it("still answers the operator token, without an event, and logs it", async () => {
    const lines: string[] = []
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk))
      return true
    })
    try {
      const answer = await fetch(`${base}/bodies/${sha}`, {
        headers: { authorization: "Bearer operator-token" },
      })
      expect(answer.status).toBe(200)
    } finally {
      spy.mockRestore()
    }
    expect(lines.join("")).toMatch(new RegExp(`vault: resolved ${sha} for the operator token`))
  })
})

describe("the vault for anonymous readers who own every route (the public demo's grant)", () => {
  it("still resolves nothing without a session", async () => {
    const db = new PGlite()
    const open = await createPostgresStore(db)
    const agent = DEMO_EVENTS.find((e) => e.vault !== undefined && e.outcome === "assembled")!
    await open.write(agent)
    const sha = JSON.stringify(agent.snapshot).match(/(?<="content_sha256":")[0-9a-f]{64}/)![0]
    const file = readdirSync(join(VAULT, sha.slice(0, 2)))[0]!
    await open.vault.put(sha, {
      bytes: new Uint8Array(readFileSync(join(VAULT, sha.slice(0, 2), file))),
      mediaType: TEXT_TYPE,
    })
    const port = await freePort()
    const server = createIngestServer({
      runner,
      maxBodyBytes: 1024 * 1024,
      maxQueue: 8,
      store: open,
      vault: open.vault,
      access: accessFrom({ anonymous: ["viewer", "owner:*"] }),
    })
    await new Promise<void>((done) => server.listen(port, "127.0.0.1", done))
    try {
      const answer = await fetch(`http://127.0.0.1:${port}/bodies/${sha}?event=${agent.event_id}`)
      expect(answer.status).toBe(401)
      expect(await answer.json()).toMatchObject({ kind: "sign-in" })
    } finally {
      await new Promise((done) => server.close(() => done(undefined)))
      await db.close()
    }
  })
})
