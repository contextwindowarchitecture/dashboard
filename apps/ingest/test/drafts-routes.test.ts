// Drafts (ADR-0013): a signed-in owner of a route keeps drafts of its route policy and profiles in the
// API, reads them back, changes and removes them; no other author sees them; a draft for a route the
// author does not own is not saved; a write from another site is refused.

import { PGlite } from "@electric-sql/pglite"
import { REGISTRY } from "@cwa-dashboard/contract/registry"
import { validateDraftV1 } from "@cwa-dashboard/telemetry/validators"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { accessFrom } from "../src/access.ts"
import { createAuth } from "../src/auth.ts"
import { createPostgresStore } from "../src/postgres-store.ts"
import type { Runner } from "../src/runner.ts"
import { createIngestServer } from "../src/server.ts"
import { startIssuer } from "./oidc-issuer.ts"
import { freePort, signIn } from "./sign-in.ts"

const CLIENT = { clientId: "cwa-dashboard", clientSecret: "client-secret" }
const idle: Runner = { run: async () => ({ status: 503 }) as never, close: async () => {} }
const PROFILE = REGISTRY.profiles.find((p) => p.route === "support-chat")!
const OTHER = REGISTRY.profiles.find((p) => p.route !== "support-chat")!

let base = ""
const cookie: Record<"ada" | "grace", string> = { ada: "", grace: "" }
let stop: () => Promise<void> = async () => undefined

beforeAll(async () => {
  const issuer = await startIssuer({ ...CLIENT, person: { sub: "x" } })
  const db = new PGlite()
  const store = await createPostgresStore(db)
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  const server = createIngestServer({
    runner: idle,
    maxBodyBytes: 1024 * 1024,
    maxQueue: 8,
    store,
    drafts: store.drafts,
    access: accessFrom({ signed_in: ["viewer"], groups: { owners: ["owner:support-chat"] } }),
    auth: createAuth({
      config: { issuer: issuer.url, ...CLIENT, redirectUri: `${base}/auth/callback` },
      sessions: store.sessions,
    }),
  })
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done))
  issuer.signInAs({ sub: "ada", name: "Ada", groups: ["owners"] })
  cookie.ada = (await signIn(base)).session!.value
  issuer.signInAs({ sub: "grace", name: "Grace", groups: ["owners"] })
  cookie.grace = (await signIn(base)).session!.value
  stop = async () => {
    await new Promise((done) => server.close(() => done(undefined)))
    await db.close()
    await issuer.close()
  }
})
afterAll(() => stop())

const ID = "a1b2c3d4-0000-4000-8000-000000000001"
const as = (
  who: "ada" | "grace" | undefined,
  method: string,
  path: string,
  body?: unknown,
  origin?: string,
) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      ...(who ? { cookie: `cwa_session=${cookie[who]}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(origin ? { origin } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const draft = (document: unknown) => ({
  kind: "profile",
  started_from: { profile: { id: PROFILE.id, version: PROFILE.version } },
  document,
})

describe("drafts", () => {
  it("are an owner's to keep, read back, change and remove", async () => {
    const saved = await as("ada", "PUT", `/drafts/${ID}.json`, draft({ ...PROFILE, version: 2 }))
    expect(saved.status).toBe(200)
    const read = await (await as("ada", "GET", `/drafts/${ID}.json`)).json()
    expect(validateDraftV1(read) ? null : validateDraftV1.errors).toBeNull()
    expect(read).toMatchObject({ id: ID, kind: "profile", route: "support-chat" })
    expect((read as { document: { version: number } }).document.version).toBe(2)
    // Work in progress is kept as it is, valid or not.
    await as("ada", "PUT", `/drafts/${ID}.json`, draft({ ...PROFILE, version: "two" }))
    expect(
      (
        (await (await as("ada", "GET", `/drafts/${ID}.json`)).json()) as {
          document: { version: unknown }
        }
      ).document.version,
    ).toBe("two")
    const list = (await (await as("ada", "GET", "/drafts.json")).json()) as {
      drafts: { id: string }[]
    }
    expect(list.drafts.map((d) => d.id)).toEqual([ID])
    expect((await as("ada", "DELETE", `/drafts/${ID}.json`)).status).toBe(204)
    expect((await as("ada", "GET", `/drafts/${ID}.json`)).status).toBe(404)
  })

  it("are nobody else's to read, change or remove", async () => {
    await as("ada", "PUT", `/drafts/${ID}.json`, draft(PROFILE))
    expect((await as("grace", "GET", `/drafts/${ID}.json`)).status).toBe(404)
    expect((await as("grace", "PUT", `/drafts/${ID}.json`, draft(PROFILE))).status).toBe(404)
    expect((await as("grace", "DELETE", `/drafts/${ID}.json`)).status).toBe(404)
    expect(
      ((await (await as("grace", "GET", "/drafts.json")).json()) as { drafts: unknown[] }).drafts,
    ).toEqual([])
    await as("ada", "DELETE", `/drafts/${ID}.json`)
  })

  it("are their tenant's: another tenant neither lists, reads, changes nor removes them", async () => {
    const saved = await as("ada", "PUT", `/drafts/${ID}.json?tenant=northwind`, draft(PROFILE))
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ id: ID, tenant: "northwind" })
    expect((await as("ada", "GET", `/drafts/${ID}.json?tenant=northwind`)).status).toBe(200)
    expect(
      (
        (await (await as("ada", "GET", "/drafts.json?tenant=northwind")).json()) as {
          drafts: { id: string }[]
        }
      ).drafts.map((d) => d.id),
    ).toEqual([ID])
    expect((await as("ada", "GET", `/drafts/${ID}.json`)).status).toBe(404)
    expect(
      ((await (await as("ada", "GET", "/drafts.json")).json()) as { drafts: unknown[] }).drafts,
    ).toEqual([])
    expect((await as("ada", "PUT", `/drafts/${ID}.json`, draft(PROFILE))).status).toBe(404)
    expect((await as("ada", "DELETE", `/drafts/${ID}.json`)).status).toBe(404)
    // A default tenant's draft names no tenant, as an event does not.
    expect((await as("ada", "DELETE", `/drafts/${ID}.json?tenant=northwind`)).status).toBe(204)
    const plain = await as("ada", "PUT", `/drafts/${ID}.json`, draft(PROFILE))
    expect(await plain.json()).not.toHaveProperty("tenant")
    await as("ada", "DELETE", `/drafts/${ID}.json`)
  })

  it("need a session", async () => {
    expect((await as(undefined, "GET", "/drafts.json")).status).toBe(401)
    expect((await as(undefined, "PUT", `/drafts/${ID}.json`, draft(PROFILE))).status).toBe(401)
  })

  it("are not saved for a route the author does not own", async () => {
    const answer = await as("ada", "PUT", `/drafts/${ID}.json`, {
      ...draft(OTHER),
      started_from: { profile: { id: OTHER.id, version: OTHER.version } },
    })
    expect(answer.status).toBe(403)
    expect((await as("ada", "GET", `/drafts/${ID}.json`)).status).toBe(404)
  })

  it("refuse a write from another site, a draft naming no route, another kind, and an id that names a path", async () => {
    expect(
      (await as("ada", "PUT", `/drafts/${ID}.json`, draft(PROFILE), "https://evil.example")).status,
    ).toBe(403)
    expect((await as("ada", "PUT", `/drafts/${ID}.json`, draft({ id: "x" }))).status).toBe(400)
    expect(
      (await as("ada", "PUT", `/drafts/${ID}.json`, { ...draft(PROFILE), kind: "trace" })).status,
    ).toBe(400)
    expect((await as("ada", "PUT", "/drafts/..%2Fx.json", draft(PROFILE))).status).toBe(404)
  })
})
