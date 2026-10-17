// The vault's routes (ADR-0009): PUT /bodies/<sha256> deposits with the ingest token; GET and DELETE
// need the operator token, which the ingest token is not. The bodies are the demo events' own.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterEach, describe, expect, it } from "vitest"

import { createPostgresStore } from "../src/postgres-store.ts"
import type { Runner } from "../src/runner.ts"
import { createIngestServer, type IngestOptions } from "../src/server.ts"
import { type BodyVault, directoryVault } from "../src/vault.ts"
import { DEMO_DEPOSITS } from "./vault-contract.ts"

const INGEST = "ingest-token"
const OPERATOR = "operator-token"
const idle: Runner = { run: async () => ({ status: 503 }) as never, close: async () => {} }
const { sha256: SHA, deposit: BODY } = DEMO_DEPOSITS[0]!

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** A service over a PostgreSQL store; its vault the store's unless another, or none, is given. */
async function serve(
  options: Omit<Partial<IngestOptions>, "vault"> & { vault?: BodyVault | "store" | "none" } = {},
) {
  const db = new PGlite()
  const store = await createPostgresStore(db)
  const { vault = "store", ...rest } = options
  const server = createIngestServer({
    runner: idle,
    maxBodyBytes: 1024 * 1024,
    maxQueue: 8,
    store,
    token: INGEST,
    vaultToken: OPERATOR,
    ...(vault === "none" ? {} : { vault: vault === "store" ? store.vault : vault }),
    ...rest,
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  cleanups.push(async () => {
    await new Promise((done) => server.close(() => done(undefined)))
    await db.close()
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const put = (base: string, token = INGEST, sha = SHA, bytes = BODY.bytes, type = BODY.mediaType) =>
  fetch(`${base}/bodies/${sha}`, {
    method: "PUT",
    headers: { ...bearer(token), "content-type": type },
    body: bytes,
  })
const problems = async (response: Response) =>
  ((await response.json()) as { problems: string[] }).problems.join(" ")

describe("the vault's routes", () => {
  it("take a deposit with the ingest token, once, and give it back to the operator, never cached", async () => {
    const base = await serve()
    expect((await put(base)).status).toBe(201)
    expect((await put(base)).status).toBe(200)
    const got = await fetch(`${base}/bodies/${SHA}`, { headers: bearer(OPERATOR) })
    expect(got.status).toBe(200)
    expect(got.headers.get("content-type")).toBe(BODY.mediaType)
    expect(got.headers.get("cache-control")).toBe("no-store")
    expect(got.headers.get("x-content-type-options")).toBe("nosniff")
    expect(Buffer.from(await got.arrayBuffer()).equals(Buffer.from(BODY.bytes))).toBe(true)
  })

  it("never give a body for the ingest token, nor without a token", async () => {
    const base = await serve()
    await put(base)
    for (const headers of [bearer(INGEST), {}]) {
      const got = await fetch(`${base}/bodies/${SHA}`, { headers })
      expect(got.status).toBe(401)
      expect(got.headers.get("www-authenticate")).toBe("Bearer")
    }
    expect(
      (await fetch(`${base}/bodies/${SHA}`, { method: "DELETE", headers: bearer(INGEST) })).status,
    ).toBe(401)
  })

  it("take no deposit without the ingest token, nor the operator's", async () => {
    const base = await serve()
    expect((await put(base, "wrong")).status).toBe(401)
    expect((await put(base, OPERATOR)).status).toBe(401)
  })

  it("refuse a deposit that is not what its digest names, saying why", async () => {
    const base = await serve()
    const other = DEMO_DEPOSITS[1]!.sha256
    const response = await put(base, INGEST, other)
    expect(response.status).toBe(400)
    expect(await problems(response)).toMatch(/SHA-256/)
    expect((await put(base, INGEST, SHA, BODY.bytes, "text/html" as never)).status).toBe(400)
  })

  it("say a body the vault does not hold is not there, and erase one it does", async () => {
    const base = await serve()
    const missing = await fetch(`${base}/bodies/${SHA}`, { headers: bearer(OPERATOR) })
    expect(missing.status).toBe(404)
    await put(base)
    const erased = await fetch(`${base}/bodies/${SHA}`, {
      method: "DELETE",
      headers: bearer(OPERATOR),
    })
    expect(erased.status).toBe(204)
    expect((await fetch(`${base}/bodies/${SHA}`, { headers: bearer(OPERATOR) })).status).toBe(404)
    expect(
      (await fetch(`${base}/bodies/${SHA}`, { method: "DELETE", headers: bearer(OPERATOR) }))
        .status,
    ).toBe(404)
  })

  it("name no file for a path that is not a digest, even in a directory vault", async () => {
    const root = mkdtempSync(join(tmpdir(), "cwa-vault-routes-"))
    cleanups.push(async () => rmSync(root, { recursive: true, force: true }))
    // Where "..." would land in <root>/vault, its first two characters taken as the directory.
    writeFileSync(join(root, "....txt"), "outside the vault")
    const base = await serve({ vault: directoryVault(join(root, "vault")) })
    for (const name of ["...", "..%2F..%2Fetc%2Fpasswd"]) {
      const response = await fetch(`${base}/bodies/${name}`, { headers: bearer(OPERATOR) })
      expect(response.status, name).toBe(404)
      expect(await response.text()).not.toContain("outside the vault")
    }
  })

  it("name the setting each missing piece needs", async () => {
    const noVault = await serve({ vault: "none" })
    const deposit = await put(noVault)
    expect(deposit.status).toBe(503)
    expect(await problems(deposit)).toMatch(/VAULT_DIR|DATABASE_URL/)
    const noOperator = await serve({ vaultToken: undefined })
    await put(noOperator)
    const read = await fetch(`${noOperator}/bodies/${SHA}`, { headers: bearer(OPERATOR) })
    expect(read.status).toBe(503)
    expect(await problems(read)).toMatch(/VAULT_TOKEN/)
  })

  it("answer only GET, PUT and DELETE", async () => {
    const base = await serve()
    const response = await fetch(`${base}/bodies/${SHA}`, { method: "POST" })
    expect(response.status).toBe(405)
    expect(response.headers.get("allow")).toBe("GET, PUT, DELETE")
  })
})

describe("createIngestServer", () => {
  it("refuses an operator token that is the ingest token", () => {
    expect(() =>
      createIngestServer({
        runner: idle,
        maxBodyBytes: 1,
        maxQueue: 1,
        token: "same",
        vaultToken: "same",
      }),
    ).toThrow(/VAULT_TOKEN/)
  })
})
