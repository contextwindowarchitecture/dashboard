// deploy/seed-vault.mjs (ADR-0009): deposits a directory vault's bodies through PUT /bodies, as the
// wrapper of a vaulted route would, so a store that starts empty holds the demo's bodies. Run against
// a service in this process, over the demo vault.

import { spawn } from "node:child_process"
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createPostgresStore } from "../src/postgres-store.ts"
import { createIngestServer } from "../src/server.ts"

const SCRIPT = resolve(import.meta.dirname, "../../../deploy/seed-vault.mjs")
const VAULT = resolve(import.meta.dirname, "../../../packages/demo-traffic/vault")
const BODIES = readdirSync(VAULT).flatMap((prefix) => readdirSync(join(VAULT, prefix))).length
const dir = mkdtempSync(join(tmpdir(), "cwa-seed-vault-"))
let base = ""
let stop: () => Promise<void> = async () => undefined

beforeAll(async () => {
  const db = new PGlite()
  const store = await createPostgresStore(db)
  const server = createIngestServer({
    runner: { run: async () => ({ status: 503 }) as never, close: async () => {} },
    maxBodyBytes: 1024 * 1024,
    maxQueue: 8,
    store,
    token: "ingest",
    vault: store.vault,
    vaultToken: "operator",
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  stop = async () => {
    await new Promise((done) => server.close(() => done(undefined)))
    await db.close()
  }
})
afterAll(async () => {
  await stop()
  rmSync(dir, { recursive: true, force: true })
})

function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ status: number | null; out: string }>((done) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env } })
    let out = ""
    child.stdout.on("data", (chunk) => (out += chunk))
    child.stderr.on("data", (chunk) => (out += chunk))
    child.on("close", (status) => done({ status, out }))
  })
}

describe("deploy/seed-vault.mjs", () => {
  it("deposits every body of the demo vault, then finds them held", async () => {
    const first = await run([VAULT, base, "--token", "ingest"])
    expect(first.out).toContain(`${BODIES} deposited, 0 already held, of ${BODIES}`)
    expect(first.status).toBe(0)
    const again = await run([VAULT, base], { INGEST_TOKEN: "ingest" })
    expect(again.out).toContain(`0 deposited, ${BODIES} already held`)
    const [prefix] = readdirSync(VAULT)
    const [name] = readdirSync(join(VAULT, prefix!))
    const got = await fetch(`${base}/bodies/${name!.split(".")[0]}`, {
      headers: { authorization: "Bearer operator" },
    })
    expect(got.status).toBe(200)
  })

  it("stops at a body the service refuses, naming it", async () => {
    const copy = join(dir, "vault")
    cpSync(VAULT, copy, { recursive: true })
    const [prefix] = readdirSync(copy)
    const [name] = readdirSync(join(copy, prefix!))
    writeFileSync(join(copy, prefix!, name!), "not the body")
    const result = await run([copy, base, "--token", "ingest"])
    expect(result.status).toBe(1)
    expect(result.out).toContain(name)
    expect(result.out).toContain("SHA-256")
  })

  it("asks for what it needs", async () => {
    const result = await run([VAULT], { INGEST_TOKEN: "" })
    expect(result.status).toBe(2)
    expect(result.out).toMatch(/usage/)
  })
})
