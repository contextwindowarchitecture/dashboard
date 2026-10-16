import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { replay } from "../src/replay.ts"

const conformance = resolve(
  import.meta.dirname,
  "../../../packages/contract/vendor/cwa/conformance",
)
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
const cases = readdirSync(join(conformance, "cases")).sort()
const rejections = readdirSync(join(conformance, "rejections")).sort()
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
// What a replay cannot reproduce: the trace's random id and the assembler's own timings (R-23).
const comparable = (trace: Record<string, unknown>) => {
  const { trace_id: _id, timings: _timings, ...rest } = trace
  return rest
}

describe("replay", () => {
  it("replays every vendored case to its expected trace and payload", () => {
    for (const id of cases) {
      const snapshot = readJson(join(conformance, "cases", id, "snapshot.json"))
      const expected = readJson(join(conformance, "cases", id, "expected.trace.json"))
      const result = replay(snapshot)
      expect(result.status, id).toBe(200)
      if (result.status !== 200) continue
      expect(comparable(result.body.trace as Record<string, unknown>), id).toEqual(
        comparable(expected),
      )
      const refused = (expected["refused"] as { bool: boolean }).bool
      expect(result.body.outcome, id).toBe(refused ? "refused" : "assembled")
      if (refused) {
        expect(result.body.payload_hash, id).toBeNull()
      } else {
        const payload = readFileSync(join(conformance, "cases", id, "expected.payload.txt"))
        expect(result.body.payload_hash, id).toBe(sha256(payload))
        expect(result.body.payload_bytes, id).toBe(payload.length)
      }
      expect(result.body.snapshot_digest, id).toBe(
        (expected["context"] as { snapshot_digest: string }).snapshot_digest,
      )
    }
  })

  it("rejects every vendored rejection with its problems", () => {
    for (const id of rejections) {
      const snapshot = readJson(join(conformance, "rejections", id, "snapshot.json"))
      const result = replay(snapshot)
      expect(result.status, id).toBe(400)
      if (result.status !== 400) continue
      expect(result.body.problems.length, id).toBeGreaterThan(0)
    }
  })

  it("names a tokenizer the assembler does not provide, apart from a rejection", () => {
    const snapshot = readJson(join(conformance, "cases", cases[0]!, "snapshot.json"))
    const result = replay({ ...snapshot, tokenizer: "made-up/v1" })
    expect(result.status).toBe(422)
    if (result.status === 422) expect(result.body.problems.join(" ")).toContain("made-up/v1")
  })

  it("replays one snapshot to one hash, whatever the call", () => {
    const snapshot = readJson(join(conformance, "cases", "messages-render", "snapshot.json"))
    const first = replay(snapshot)
    const second = replay(structuredClone(snapshot))
    expect(first.status).toBe(200)
    if (first.status === 200 && second.status === 200) {
      expect(second.body.payload_hash).toBe(first.body.payload_hash)
      expect(second.body.trace).not.toBe(first.body.trace)
    }
  })
})
