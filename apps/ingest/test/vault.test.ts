// The vault (ADR-0009): what a deposit must be, and the two vaults held to one contract.

import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"

import { createPostgresStore } from "../src/postgres-store.ts"
import { checkDeposit, directoryVault, JSON_TYPE, TEXT_TYPE } from "../src/vault.ts"
import { DEMO_DEPOSITS, vaultContract } from "./vault-contract.ts"

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const utf8 = (text: string) => new TextEncoder().encode(text)

vaultContract("the directory vault", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cwa-vault-"))
  return { vault: directoryVault(dir), done: async () => rmSync(dir, { recursive: true }) }
})

vaultContract("the PostgreSQL store's vault (PGlite)", async () => {
  const db = new PGlite()
  const store = await createPostgresStore(db, { end: () => db.close() })
  return { vault: store.vault, done: () => store.close() }
})

describe("checkDeposit", () => {
  it("takes a demo body as a wrapper deposits it", () => {
    for (const { sha256, deposit } of DEMO_DEPOSITS) {
      expect(checkDeposit(sha256, deposit.bytes, deposit.mediaType)).toEqual({ ok: true, deposit })
    }
  })

  it("refuses bytes whose digest is not the one named", () => {
    const bytes = utf8("the body")
    const other = sha(utf8("another body"))
    const checked = checkDeposit(other, bytes, TEXT_TYPE)
    expect(checked.ok).toBe(false)
    expect(!checked.ok && checked.problems.join(" ")).toMatch(/SHA-256/)
  })

  it("refuses a digest that is not lowercase hexadecimal SHA-256", () => {
    const bytes = utf8("x")
    for (const digest of [sha(bytes).toUpperCase(), "../etc"]) {
      const checked = checkDeposit(digest, bytes, TEXT_TYPE)
      expect(!checked.ok && checked.problems.join(" "), digest).toMatch(/lowercase hexadecimal/)
    }
  })

  it("takes text as UTF-8 only", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x41])
    const checked = checkDeposit(sha(bytes), bytes, TEXT_TYPE)
    expect(!checked.ok && checked.problems.join(" ")).toMatch(/UTF-8/)
    expect(checkDeposit(sha(utf8("é")), utf8("é"), "text/plain;charset=UTF-8")).toMatchObject({
      ok: true,
      deposit: { mediaType: TEXT_TYPE },
    })
  })

  it("takes JSON only in its RFC 8785 form, the one content_sha256 digests", () => {
    for (const text of ['{"b":1,"a":2}', '{ "a": 2 }', "not json"]) {
      const checked = checkDeposit(sha(utf8(text)), utf8(text), JSON_TYPE)
      expect(checked.ok, text).toBe(false)
    }
    const canonical = utf8('{"a":2,"b":1}')
    expect(checkDeposit(sha(canonical), canonical, JSON_TYPE).ok).toBe(true)
  })

  it("refuses any other media type", () => {
    const bytes = utf8("<p>x</p>")
    const checked = checkDeposit(sha(bytes), bytes, "text/html")
    expect(!checked.ok && checked.problems.join(" ")).toMatch(/text\/plain; charset=utf-8/)
    expect(checkDeposit(sha(bytes), bytes, undefined).ok).toBe(false)
  })
})
