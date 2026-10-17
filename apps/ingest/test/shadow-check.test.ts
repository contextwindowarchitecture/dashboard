// The gate (ADR-0008): deploy/shadow-check.mjs runs a candidate against a corpus on a running service
// and exits 1 over its thresholds, 2 when it cannot run; a pull request check is that exit code.

import { spawn } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createPostgresStore } from "../src/postgres-store.ts"
import { replay } from "../src/replay.ts"
import { createIngestServer } from "../src/server.ts"

const SCRIPT = resolve(import.meta.dirname, "../../../deploy/shadow-check.mjs")
const EVENTS = resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures/events")
const dir = mkdtempSync(join(tmpdir(), "cwa-shadow-check-"))
let base = ""
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
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await fetch(`${base}/corpora`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify({ name: "chat", from: { profile: "cache-first-chat" } }),
  })
  stop = async () => {
    await new Promise((done) => server.close(() => done(undefined)))
    await db.close()
  }
})
afterAll(async () => {
  await stop()
  rmSync(dir, { recursive: true, force: true })
})

// Spawned, not run synchronously: the service answering it is in this process.
function check(args: string[]) {
  return new Promise<{ status: number | null; out: string }>((done) => {
    const child = spawn(process.execPath, [SCRIPT, ...args])
    let out = ""
    child.stdout.on("data", (chunk) => (out += chunk))
    child.stderr.on("data", (chunk) => (out += chunk))
    child.on("close", (status) => done({ status, out }))
  })
}
const file = (name: string, value: unknown) => {
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(value))
  return path
}

describe("deploy/shadow-check.mjs", () => {
  it("passes a candidate within its thresholds, printing the summary and writing the report", async () => {
    const chat = REGISTRY.profiles.find((p) => p.id === "cache-first-chat")!
    const report = join(dir, "report.json")
    const result = await check([
      "--api",
      base,
      "--corpus",
      "chat",
      "--profile",
      file("own.json", chat),
      "--report",
      report,
    ])
    expect(result.out).toMatch(/refusals added 0/)
    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(report, "utf8")).$schema).toBe("cwa-dashboard/shadow-report/v1")
  })

  it("fails a candidate over a threshold, naming it", async () => {
    const elsewhere = REGISTRY.profiles.find((p) => p.route !== "support-chat")!
    const result = await check([
      "--api",
      base,
      "--corpus",
      "chat",
      "--profile",
      file("elsewhere.json", elsewhere),
    ])
    expect(result.out).toMatch(/candidate rejected .* over the limit of 0/)
    expect(result.status).toBe(1)
    const allowed = await check([
      "--api",
      base,
      "--corpus",
      "chat",
      "--profile",
      file("elsewhere.json", elsewhere),
      "--max-candidate-rejected",
      "1000",
    ])
    expect(allowed.status).toBe(0)
  })

  it("says it could not run, apart from a breach, for a missing corpus or no candidate", async () => {
    const chat = REGISTRY.profiles.find((p) => p.id === "cache-first-chat")!
    expect(
      (await check(["--api", base, "--corpus", "nothing", "--profile", file("own.json", chat)]))
        .status,
    ).toBe(2)
    expect((await check(["--api", base, "--corpus", "chat"])).status).toBe(2)
  })

  it("is what the composite action runs, every input passed as the flag the script reads", () => {
    const actionDir = resolve(import.meta.dirname, "../../../.github/actions/shadow-regression")
    const action = readFileSync(join(actionDir, "action.yml"), "utf8")
    const run = /node "\$GITHUB_ACTION_PATH\/([^"]+)"/.exec(action)![1]!
    expect(resolve(actionDir, run)).toBe(SCRIPT)
    const script = readFileSync(SCRIPT, "utf8")
    for (const input of [
      "route-policy",
      "profile",
      "max-refusals-added",
      "max-shedding-increase",
      "max-candidate-rejected",
      "report",
    ]) {
      expect(action, input).toContain(`--${input} `)
      expect(script, input).toContain(`"--${input}"`)
    }
  })
})
