import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import type { AssemblyEventV1 } from "../generated/types.ts"
import { validateAssemblyEventV1 } from "../generated/validators.js"

// The envelope conformance fixtures every wrapper reproduces: each must be a valid event, and the
// three modes of one case must differ in bodies and the mode's name only (R-DASH-1).

const root = resolve(import.meta.dirname, "../fixtures/envelope")
const dirs = readdirSync(root)
  .filter((name) => statSync(join(root, name)).isDirectory())
  .sort()
const load = (dir: string, mode: string) =>
  JSON.parse(readFileSync(join(root, dir, `${mode}.json`), "utf8")) as AssemblyEventV1

// The event with every body and variant body set aside, in a snapshot or a rejected one.
function withoutBodies(event: AssemblyEventV1): unknown {
  const copy = structuredClone(event) as Record<string, unknown>
  delete copy["redaction_mode"]
  const snapshot = (copy["snapshot"] ??
    (copy["rejection"] as Record<string, unknown>)["snapshot"]) as {
    batches?: { items?: unknown[] }[]
  }
  for (const batch of snapshot.batches ?? []) {
    for (const item of batch.items ?? []) {
      if (typeof item !== "object" || item === null) continue
      const record = item as Record<string, unknown>
      if ("body" in record) record["body"] = "(body)"
      for (const variant of (record["variants"] as Record<string, unknown>[] | undefined) ?? []) {
        if (typeof variant === "object" && variant !== null && "body" in variant)
          variant["body"] = "(body)"
      }
    }
  }
  return copy
}

describe("packages/telemetry/fixtures/envelope", () => {
  it("holds the cases, each with its recording and three modes", () => {
    expect(dirs.length).toBeGreaterThanOrEqual(6)
    for (const dir of dirs) {
      expect(readdirSync(join(root, dir)).sort(), dir).toEqual([
        "digest_only.json",
        "full.json",
        "pii_scrubbed.json",
        "recording.json",
      ])
    }
  })

  for (const dir of dirs) {
    it(`${dir}: every mode is a valid event, differing from full in bodies only`, () => {
      const full = load(dir, "full")
      for (const mode of ["full", "pii_scrubbed", "digest_only"]) {
        const event = load(dir, mode)
        const ok = validateAssemblyEventV1(event)
        expect(ok ? null : validateAssemblyEventV1.errors, mode).toBeNull()
        expect(event.redaction_mode).toBe(mode)
        expect(withoutBodies(event), mode).toEqual(withoutBodies(full))
      }
    })
  }

  it("spans an assembly, a refusal and a rejection", () => {
    expect(new Set(dirs.map((dir) => load(dir, "full").outcome))).toEqual(
      new Set(["assembled", "refused", "rejected"]),
    )
  })
})
