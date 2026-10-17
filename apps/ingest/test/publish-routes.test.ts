// Publishing a draft (ADR-0014): its author, signed in and owning its route, opens a pull request in
// the tenant's policy repository as the App, the file where the layout puts it and the body naming
// them with the counts of a shadow run the API makes itself; the draft records the pull request. A
// draft the contract refuses, or a version the repository holds, goes nowhere; without the App the
// answer is the file and the commands. Against GitHub's API and an issuer in this process.

import { readdirSync, readFileSync } from "node:fs"
import type { Server } from "node:http"
import { join, resolve } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import { validateDraftV1 } from "@cwa-dashboard/telemetry/validators"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { accessFrom } from "../src/access.ts"
import { createAuth } from "../src/auth.ts"
import { createPublisher } from "../src/github.ts"
import { fileText } from "../src/policy-layout.ts"
import { createPostgresStore } from "../src/postgres-store.ts"
import { replay } from "../src/replay.ts"
import { createIngestServer } from "../src/server.ts"
import { startGitHub, type FakeGitHub } from "./github-fake.ts"
import { startIssuer } from "./oidc-issuer.ts"
import { freePort, signIn } from "./sign-in.ts"

const CLIENT = { clientId: "cwa-dashboard", clientSecret: "client-secret" }
const EVENTS = resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures/events")
const PROFILE = REGISTRY.profiles.find((p) => p.id === "cache-first-chat")!
const NEXT = { ...PROFILE, version: PROFILE.version + 1 }
const PATH = `profiles/${PROFILE.id}/${NEXT.version}.json`
const ID = "a1b2c3d4-0000-4000-8000-000000000001"

let github: FakeGitHub
let withApp = ""
let byHand = ""
/** With the App, but an access file that no longer makes the owners owners. */
let demoted = ""
const cookie: Record<"ada" | "grace", string> = { ada: "", grace: "" }
let stop: () => Promise<void> = async () => undefined

beforeAll(async () => {
  github = await startGitHub({ repository: "acme/policies" })
  const issuer = await startIssuer({ ...CLIENT, person: { sub: "x" } })
  const db = new PGlite()
  const store = await createPostgresStore(db)
  const chat: string[] = []
  for (const name of readdirSync(EVENTS).filter((n) => n !== "index.json" && n.endsWith(".json"))) {
    const event = JSON.parse(readFileSync(join(EVENTS, name), "utf8")) as AssemblyEventV1
    await store.write(event)
    if (event.outcome === "assembled" && event.snapshot?.profile.id === PROFILE.id) {
      chat.push(event.event_id)
    }
  }
  await store.saveCorpus({
    $schema: "cwa-dashboard/corpus/v1",
    name: "chat",
    created_at: "2026-10-17T12:00:00.000Z",
    events: chat.slice(0, 3).map((event_id) => ({ event_id })),
  })
  const servers: Server[] = []
  for (const [publishing, owners] of [
    [true, "owner:support-chat"],
    [false, "owner:support-chat"],
    [true, "viewer"],
  ] as const) {
    const port = await freePort()
    const base = `http://127.0.0.1:${port}`
    const server = createIngestServer({
      runner: { run: async (snapshot) => replay(snapshot), close: async () => {} },
      maxBodyBytes: 1024 * 1024,
      maxQueue: 8,
      store,
      drafts: store.drafts,
      access: accessFrom({ signed_in: ["viewer"], groups: { owners: [owners] } }),
      auth: createAuth({
        config: { issuer: issuer.url, ...CLIENT, redirectUri: `${base}/auth/callback` },
        sessions: store.sessions,
      }),
      ...(publishing
        ? {
            publish: {
              publisher: createPublisher(
                {
                  appId: github.appId,
                  installationId: github.installationId,
                  privateKey: github.privateKey,
                },
                { api: github.url },
              ),
              repositories: { default: "acme/policies" },
            },
          }
        : {}),
    })
    await new Promise<void>((done) => server.listen(port, "127.0.0.1", done))
    servers.push(server)
    if (!publishing) byHand = base
    else if (owners === "viewer") demoted = base
    else withApp = base
  }
  // Sessions live in the shared store, so a session made on one server holds on both.
  issuer.signInAs({ sub: "ada", name: "Ada Lovelace", groups: ["owners"] })
  cookie.ada = (await signIn(withApp)).session!.value
  issuer.signInAs({ sub: "grace", name: "Grace", groups: ["owners"] })
  cookie.grace = (await signIn(withApp)).session!.value
  stop = async () => {
    for (const server of servers) await new Promise((done) => server.close(() => done(undefined)))
    await db.close()
    await issuer.close()
    await github.close()
  }
})
afterAll(() => stop())
afterEach(async () => {
  github.fault = undefined
  github.pulls.length = 0
  github.commits.length = 0
  github.tokens.length = 0
  for (const branch of [...github.branches.keys()])
    if (branch !== "main") github.branches.delete(branch)
  github.branches.get("main")!.delete(PATH)
  await as("ada", withApp, "DELETE", `/drafts/${ID}.json`)
})

const as = (
  who: "ada" | "grace" | undefined,
  base: string,
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
const keep = (document: unknown, base = withApp) =>
  as("ada", base, "PUT", `/drafts/${ID}.json`, {
    kind: "profile",
    started_from: { profile: { id: PROFILE.id, version: PROFILE.version } },
    document,
  })
const publish = (body: unknown = {}, who: "ada" | "grace" | undefined = "ada", base = withApp) =>
  as(who, base, "POST", `/drafts/${ID}/publish`, body)

describe("publishing a draft", () => {
  it("opens a pull request as the App, naming the author and the shadow run's counts", async () => {
    await keep(NEXT)
    const answer = await publish({ corpus: "chat" })
    expect(answer.status).toBe(200)
    const published = (await answer.json()) as Record<string, unknown>
    expect(published).toEqual({
      kind: "published",
      repository: "acme/policies",
      path: PATH,
      branch: `cwa-dashboard/${ID}`,
      number: 1,
      url: "https://github.test/acme/policies/pull/1",
    })
    expect(github.branches.get(`cwa-dashboard/${ID}`)!.get(PATH)).toBe(fileText(NEXT))
    const [pull] = github.pulls
    expect(pull!.title).toBe(`Profile ${PROFILE.id} v${NEXT.version} for ${PROFILE.route}`)
    expect(pull!.body).toContain("Ada Lovelace")
    expect(pull!.body).toContain("`ada`")
    expect(pull!.body).toContain(`profile ${PROFILE.id} v${PROFILE.version}`)
    expect(pull!.body).toMatch(/Shadow over `chat`/)
    expect(pull!.body).toMatch(/\| replayed \| 3 \|/)
    // The draft remembers its pull request.
    const draft = await (await as("ada", withApp, "GET", `/drafts/${ID}.json`)).json()
    expect(validateDraftV1(draft) ? null : validateDraftV1.errors).toBeNull()
    expect(draft).toMatchObject({
      published: { repository: "acme/policies", path: PATH, number: 1, url: published["url"] },
    })
    // A later save keeps it.
    await keep({ ...NEXT, model_family: PROFILE.model_family })
    expect(await (await as("ada", withApp, "GET", `/drafts/${ID}.json`)).json()).toHaveProperty(
      "published.number",
      1,
    )
  })

  it("commits a second publish to the same pull request", async () => {
    await keep(NEXT)
    await publish()
    await keep({ ...NEXT, evaluation: PROFILE.evaluation })
    const again = await publish()
    expect(await again.json()).toMatchObject({ kind: "published", number: 1 })
    expect(github.commits).toHaveLength(2)
    expect(github.pulls).toHaveLength(1)
    expect(github.pulls[0]!.body).toContain("No shadow run was asked for")
  })

  it("does not publish a draft the contract refuses, nor reach GitHub for it", async () => {
    await keep({ ...NEXT, version: "two" })
    const answer = await publish()
    expect(answer.status).toBe(400)
    expect(await answer.json()).toMatchObject({
      kind: "invalid",
      problems: [expect.stringContaining("/version")],
    })
    expect(github.tokens).toEqual([])
  })

  it("does not change a version the repository already holds", async () => {
    github.branches.get("main")!.set(PATH, "{}\n")
    await keep(NEXT)
    const answer = await publish()
    expect(answer.status).toBe(409)
    expect(await answer.json()).toMatchObject({ kind: "conflict", path: PATH })
  })

  it("does not shadow a corpus the tenant does not hold, nor publish", async () => {
    await keep(NEXT)
    const answer = await publish({ corpus: "nothing" })
    expect(answer.status).toBe(404)
    expect(github.commits).toEqual([])
  })

  it("is the author's, signed in, from this site", async () => {
    await keep(NEXT)
    expect((await as(undefined, withApp, "POST", `/drafts/${ID}/publish`, {})).status).toBe(401)
    expect((await publish({}, "grace")).status).toBe(404)
    const crossSite = await as(
      "ada",
      withApp,
      "POST",
      `/drafts/${ID}/publish`,
      {},
      "https://evil.example",
    )
    expect(crossSite.status).toBe(403)
    expect((await as("ada", withApp, "GET", `/drafts/${ID}/publish`)).status).toBe(405)
    // Ownership is asked again at publish: an author whose roles no longer own the route cannot.
    expect((await publish({}, "ada", demoted)).status).toBe(403)
    expect(github.commits).toEqual([])
  })

  it("names GitHub's refusals", async () => {
    await keep(NEXT)
    github.fault = "protected"
    const refused = await publish()
    expect(refused.status).toBe(502)
    expect(await refused.json()).toMatchObject({
      kind: "refused",
      problems: [expect.stringContaining("Repository rule violations found")],
    })
    github.fault = "not-installed"
    expect(await (await publish()).json()).toMatchObject({ kind: "no-access" })
    expect(await (await as("ada", withApp, "GET", `/drafts/${ID}.json`)).json()).not.toHaveProperty(
      "published",
    )
  })
})

describe("without the App", () => {
  it("answers with the file and the commands, and writes nothing", async () => {
    await keep(NEXT, byHand)
    const answer = await publish({}, "ada", byHand)
    expect(answer.status).toBe(200)
    const body = (await answer.json()) as {
      kind: string
      path: string
      file: string
      branch: string
      commands: string[]
    }
    expect(body).toMatchObject({ kind: "by-hand", path: PATH, file: fileText(NEXT) })
    expect(body.commands).toEqual([
      `git switch -c cwa-dashboard/${ID}`,
      `mkdir -p profiles/${PROFILE.id}`,
      `# save the file as ${PATH}`,
      `git add ${PATH}`,
      `git commit -s -m "Add profile ${PROFILE.id} v${NEXT.version}"`,
      `git push -u origin cwa-dashboard/${ID}`,
    ])
    expect(github.tokens).toEqual([])
  })
})
