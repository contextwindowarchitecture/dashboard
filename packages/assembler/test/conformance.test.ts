import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { SnapshotRejectedError, UnsupportedComponentError, assemble } from "../index.js"

// ADR-0003: the pinned assembler and the vendored contract must agree. Every vendored case's
// snapshot assembles to its expected trace and payload, every rejection is rejected, and each
// outcome is the one the TypeScript implementation's published report records. A pin that drifts
// from the contract fails here.

const vendor = resolve(import.meta.dirname, "../../contract/vendor/cwa")
const read = (path: string): unknown => JSON.parse(readFileSync(join(vendor, path), "utf8"))
const dirs = (path: string) => readdirSync(join(vendor, path)).sort()

type Report = {
  cases: { id: string; outcome: string }[]
  rejections: { id: string; outcome: string }[]
}
const report = (read("implementations/typescript.json") as { report: Report }).report
const published = new Map(
  [...report.cases, ...report.rejections].map((entry) => [entry.id, entry.outcome]),
)

// conformance/README.md, Running a case: these may differ between implementations and runs.
function comparable(trace: unknown) {
  const copy = structuredClone(trace) as Record<string, unknown>
  delete copy["trace_id"]
  delete copy["timings"]
  const recovery = copy["recovery"] as Record<string, unknown> | undefined
  if (recovery) delete recovery["detail"]
  return copy
}

describe("the pinned assembler against the vendored contract", () => {
  it("assembles every case to its expected trace and payload, or skips it as its report does", () => {
    const outcomes: Record<string, string> = {}
    for (const id of dirs("conformance/cases")) {
      try {
        const assembly = assemble(read(`conformance/cases/${id}/snapshot.json`))
        expect(comparable(assembly.trace), id).toEqual(
          comparable(read(`conformance/cases/${id}/expected.trace.json`)),
        )
        const payloadPath = join(vendor, `conformance/cases/${id}/expected.payload.txt`)
        if (existsSync(payloadPath)) {
          expect(Buffer.from(assembly.payload ?? []).equals(readFileSync(payloadPath)), id).toBe(
            true,
          )
        } else {
          expect(assembly.payload, id).toBeNull()
        }
        outcomes[id] = "passed"
      } catch (error) {
        if (!(error instanceof UnsupportedComponentError)) throw error
        outcomes[id] = "skipped"
      }
    }
    expect(Object.keys(outcomes)).toHaveLength(65)
    for (const [id, outcome] of Object.entries(outcomes)) {
      expect(outcome, id).toBe(published.get(id))
    }
  })

  it("rejects every rejection with its problems in words", () => {
    const rejections = dirs("conformance/rejections")
    expect(rejections).toHaveLength(25)
    for (const id of rejections) {
      let thrown: unknown
      try {
        assemble(read(`conformance/rejections/${id}/snapshot.json`))
      } catch (error) {
        thrown = error
      }
      if (thrown instanceof UnsupportedComponentError) {
        expect(published.get(id), id).toBe("skipped")
        continue
      }
      expect(thrown, id).toBeInstanceOf(SnapshotRejectedError)
      expect((thrown as SnapshotRejectedError).problems.length, id).toBeGreaterThan(0)
      expect(published.get(id), id).toBe("rejected")
    }
  })
})
