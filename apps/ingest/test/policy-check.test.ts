// A policy repository's check (ADR-0014): deploy/policy-check.mjs in a git checkout, against a running
// service. Every file is where the layout puts it and holds what its path names; a pull request adds
// versions and never edits a published one; each route it changes is shadowed over the route's corpus
// in shadow.json, within its limits. Exits 0 when all holds, 1 when something does not, 2 when it
// cannot run.

import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { fileText } from "../src/policy-layout.ts"
import { createPostgresStore } from "../src/postgres-store.ts"
import { replay } from "../src/replay.ts"
import { createIngestServer } from "../src/server.ts"
import { freePort } from "./sign-in.ts"

const SCRIPT = resolve(import.meta.dirname, "../../../deploy/policy-check.mjs")
const EVENTS = resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures/events")
const PROFILE = REGISTRY.profiles.find((p) => p.id === "cache-first-chat")!
const POLICY = REGISTRY.route_policies.find(
  (p) => p.route === PROFILE.route && p.version === PROFILE.route_policy_version,
)!
let api = ""
let stop: () => Promise<void> = async () => undefined

beforeAll(async () => {
  const db = new PGlite()
  const store = await createPostgresStore(db)
  for (const name of readdirSync(EVENTS).filter((n) => n !== "index.json")) {
    await store.write(JSON.parse(readFileSync(join(EVENTS, name), "utf8")) as AssemblyEventV1)
  }
  const server = createIngestServer({
    runner: { run: async (s) => replay(s), close: async () => {} },
    maxBodyBytes: 4 * 1024 * 1024,
    maxQueue: 8,
    store,
    token: "t",
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await fetch(`${api}/corpora`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify({ name: "chat", from: { profile: PROFILE.id } }),
  })
  stop = async () => {
    await new Promise((done) => server.close(() => done(undefined)))
    await db.close()
  }
})
afterAll(() => stop())

// The test's own throwaway repositories: none of the machine's git configuration or hooks apply.
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }
const git = (cwd: string, ...args: string[]) => {
  const run = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV })
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`)
  return run.stdout
}
const write = (root: string, path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

/** A repository whose main holds the layout and the given files, with a branch holding the changes. */
function repository(
  onMain: Record<string, unknown>,
  changes: Record<string, unknown>,
  shadow: unknown = { api: "", corpora: { [PROFILE.route]: "chat" } },
) {
  const root = mkdtempSync(join(tmpdir(), "cwa-policies-"))
  git(root, "init", "-q", "-b", "main")
  git(root, "config", "user.email", "test@example.com")
  git(root, "config", "user.name", "Test")
  write(root, "README.md", "# Policies\n")
  write(root, "shadow.json", fileText({ ...(shadow as object), api }))
  for (const [path, document] of Object.entries(onMain)) write(root, path, fileText(document))
  git(root, "add", ".")
  git(root, "commit", "-q", "-m", "layout")
  git(root, "switch", "-q", "-c", "change")
  for (const [path, document] of Object.entries(changes)) {
    write(root, path, typeof document === "string" ? document : fileText(document))
  }
  git(root, "add", ".")
  git(root, "commit", "-q", "-m", "change")
  return root
}

function check(root: string, ...args: string[]) {
  return new Promise<{ code: number | null; out: string }>((done) => {
    const base = args.includes("--base") ? [] : ["--base", "main"]
    const child = spawn(process.execPath, [SCRIPT, ...base, ...args], { cwd: root })
    let out = ""
    child.stdout.on("data", (d: Buffer) => (out += d.toString()))
    child.stderr.on("data", (d: Buffer) => (out += d.toString()))
    child.on("close", (code) => done({ code, out }))
  })
}

const NEXT = { ...PROFILE, version: PROFILE.version + 1 }
const NEXT_PATH = `profiles/${PROFILE.id}/${NEXT.version}.json`
const PUBLISHED_PATH = `profiles/${PROFILE.id}/${PROFILE.version}.json`

describe("the policy repository's check", () => {
  it("passes a new version that holds what its path names, shadowed within its limits", async () => {
    const root = repository({ [PUBLISHED_PATH]: PROFILE }, { [NEXT_PATH]: NEXT })
    const { code, out } = await check(root)
    expect(out).toContain(`${NEXT_PATH}: shadowed over chat`)
    expect(code).toBe(0)
  }, 60_000)

  it("shadows a route's changed route policy and profile together", async () => {
    const policy = { ...POLICY, version: `${POLICY.version}-next` }
    const profile = { ...NEXT, route_policy_version: policy.version }
    const root = repository(
      {},
      {
        [`route-policies/${POLICY.route}/${policy.version}.json`]: policy,
        [NEXT_PATH]: profile,
      },
    )
    const { code, out } = await check(root)
    expect(out).toMatch(/route-policies\/support-chat\/.+ with profiles\/cache-first-chat\/2\.json/)
    expect(code).toBe(0)
  }, 60_000)

  it("fails a file whose contents are not what its path names", async () => {
    const root = repository({}, { [`profiles/${PROFILE.id}/7.json`]: NEXT })
    const { code, out } = await check(root)
    expect(out).toContain(
      `profiles/${PROFILE.id}/7.json: version is ${NEXT.version}, the path says 7`,
    )
    expect(code).toBe(1)
  })

  it("fails a file outside the layout, and one that is not JSON", async () => {
    const root = repository({}, { "profiles/stray.json": NEXT, [NEXT_PATH]: "{ not json" })
    const { code, out } = await check(root)
    expect(out).toContain("profiles/stray.json: not where a route policy or a profile belongs")
    expect(out).toContain(`${NEXT_PATH}: not JSON`)
    expect(code).toBe(1)
  })

  it("fails an edit to a published version, and its removal", async () => {
    const edited = repository(
      { [PUBLISHED_PATH]: PROFILE },
      { [PUBLISHED_PATH]: { ...PROFILE, placement: [] } },
    )
    const one = await check(edited)
    expect(one.out).toContain(
      `${PUBLISHED_PATH}: a published version is never edited; add a new version`,
    )
    expect(one.code).toBe(1)
    const root = mkdtempSync(join(tmpdir(), "cwa-policies-"))
    git(root, "init", "-q", "-b", "main")
    git(root, "config", "user.email", "test@example.com")
    git(root, "config", "user.name", "Test")
    write(root, "shadow.json", fileText({ api, corpora: { [PROFILE.route]: "chat" } }))
    write(root, PUBLISHED_PATH, fileText(PROFILE))
    git(root, "add", ".")
    git(root, "commit", "-q", "-m", "layout")
    git(root, "switch", "-q", "-c", "change")
    git(root, "rm", "-q", PUBLISHED_PATH)
    git(root, "commit", "-q", "-m", "remove")
    const two = await check(root)
    expect(two.out).toContain(`${PUBLISHED_PATH}: a published version is never removed`)
    expect(two.code).toBe(1)
  })

  it("fails a route shadow.json names no corpus for", async () => {
    const root = repository({}, { [NEXT_PATH]: NEXT }, { api: "", corpora: {} })
    const { code, out } = await check(root)
    expect(out).toContain(`shadow.json names no corpus for the route ${PROFILE.route}`)
    expect(code).toBe(1)
  })

  it("fails a candidate the assembler rejects", async () => {
    const root = repository({}, { [NEXT_PATH]: { ...NEXT, placement: "everywhere" } })
    const { code } = await check(root)
    expect(code).toBe(1)
  }, 60_000)

  it("cannot pass when the dashboard does not answer", async () => {
    const root = repository({}, { [NEXT_PATH]: NEXT })
    const closed = await freePort()
    write(
      root,
      "shadow.json",
      fileText({ api: `http://127.0.0.1:${closed}`, corpora: { [PROFILE.route]: "chat" } }),
    )
    git(root, "commit", "-q", "-am", "nowhere")
    const { code, out } = await check(root)
    expect(out).toContain(`${NEXT_PATH}: the shadow run over chat could not run`)
    expect(code).toBe(2)
  })

  it("cannot run without shadow.json, or without a base to compare with", async () => {
    const root = repository({}, { [NEXT_PATH]: NEXT })
    git(root, "rm", "-q", "shadow.json")
    git(root, "commit", "-q", "-m", "no config")
    expect((await check(root)).code).toBe(2)
    const other = repository({}, { [NEXT_PATH]: NEXT })
    expect((await check(other, "--base", "nowhere")).code).toBe(2)
  })
})
