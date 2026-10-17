// The contract every body vault keeps (ADR-0009): it keeps a deposit's exact bytes and media type
// under its digest, says when it already held one, and erases one on request. The directory vault
// and the PostgreSQL store's vault each run this suite. The bodies are the demo events' own.

import { createHash } from "node:crypto"

import { canonicalJson } from "@cwa-dashboard/telemetry/canonical"
import { describe, expect, it } from "vitest"

import { type BodyVault, type Deposit, JSON_TYPE, TEXT_TYPE } from "../src/vault.ts"
import { DEMO_EVENTS } from "./store-contract.ts"

/** Every body of the demo's full events, as a wrapper would deposit it. */
export const DEMO_DEPOSITS: { sha256: string; deposit: Deposit }[] = (() => {
  const seen = new Map<string, Deposit>()
  for (const event of DEMO_EVENTS) {
    if (event.redaction_mode !== "full" || event.snapshot === undefined) continue
    for (const batch of event.snapshot.batches) {
      for (const item of batch.items as { body?: unknown }[]) {
        if (!("body" in item)) continue
        const text = typeof item.body === "string"
        const bytes = new TextEncoder().encode(
          text ? (item.body as string) : canonicalJson(item.body),
        )
        const sha256 = createHash("sha256").update(bytes).digest("hex")
        seen.set(sha256, { bytes, mediaType: text ? TEXT_TYPE : JSON_TYPE })
      }
    }
  }
  return [...seen].map(([sha256, deposit]) => ({ sha256, deposit }))
})()

const textual = DEMO_DEPOSITS.find((d) => d.deposit.mediaType === TEXT_TYPE)!
// The demo's bodies are all strings; a producer may send any JSON, so a demo item stands in for one.
const structured = (() => {
  const item = DEMO_EVENTS.find((e) => e.snapshot !== undefined)!.snapshot!.batches[0]!.items[0]
  const bytes = new TextEncoder().encode(canonicalJson(item))
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    deposit: { bytes, mediaType: JSON_TYPE } as Deposit,
  }
})()

export function vaultContract(
  name: string,
  open: () => Promise<{ vault: BodyVault; done: () => Promise<void> }>,
) {
  describe(name, () => {
    const withVault = async (test: (vault: BodyVault) => Promise<void>) => {
      const { vault, done } = await open()
      try {
        await test(vault)
      } finally {
        await done()
      }
    }

    it("keeps a deposit's bytes and media type under its digest", () =>
      withVault(async (vault) => {
        for (const { sha256, deposit } of [textual, structured]) {
          expect(await vault.put(sha256, deposit)).toBe("stored")
          const kept = await vault.get(sha256)
          expect(kept?.mediaType).toBe(deposit.mediaType)
          expect(Buffer.from(kept!.bytes).equals(Buffer.from(deposit.bytes))).toBe(true)
        }
      }))

    it("says it already holds a digest it was given before", () =>
      withVault(async (vault) => {
        await vault.put(textual.sha256, textual.deposit)
        expect(await vault.put(textual.sha256, textual.deposit)).toBe("held")
      }))

    it("keeps any bytes exactly, a NUL and characters beyond ASCII among them", () =>
      withVault(async (vault) => {
        const bytes = new TextEncoder().encode("a\u0000b · ü 🚀")
        const sha256 = createHash("sha256").update(bytes).digest("hex")
        await vault.put(sha256, { bytes, mediaType: TEXT_TYPE })
        expect(Buffer.from((await vault.get(sha256))!.bytes).equals(Buffer.from(bytes))).toBe(true)
      }))

    it("holds nothing it was not given, and erases what it was", () =>
      withVault(async (vault) => {
        expect(await vault.get(textual.sha256)).toBeUndefined()
        expect(await vault.delete(textual.sha256)).toBe(false)
        await vault.put(textual.sha256, textual.deposit)
        expect(await vault.delete(textual.sha256)).toBe(true)
        expect(await vault.get(textual.sha256)).toBeUndefined()
        expect(await vault.delete(textual.sha256)).toBe(false)
      }))
  })
}
