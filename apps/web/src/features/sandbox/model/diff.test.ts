import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { traceDiff } from "./diff"

const cases = resolve(
  import.meta.dirname,
  "../../../../../../packages/contract/vendor/cwa/conformance/cases",
)
const trace = (id: string) =>
  JSON.parse(readFileSync(join(cases, id, "expected.trace.json"), "utf8")) as Record<
    string,
    unknown
  >

describe("traceDiff", () => {
  it("finds no change between a trace and its replay, whatever their ids and timings", () => {
    const a = trace("admission-reasons")
    const b = { ...structuredClone(a), trace_id: "another", timings: { admission: 3 } }
    const diff = traceDiff(a, b)
    expect(diff.changed).toBe(false)
    expect(diff.rows.every((row) => row.kind === "same" || row.kind === "skipped")).toBe(true)
  })

  it("shows a changed value as the line removed and the line added, in place", () => {
    const a = trace("budget-margin")
    const b = structuredClone(a) as { result: { input_tokens: number } }
    b.result.input_tokens += 1
    const diff = traceDiff(a, b)
    expect(diff.changed).toBe(true)
    const removed = diff.rows.find((r) => r.kind === "removed") as { text: string }
    const added = diff.rows.find((r) => r.kind === "added") as { text: string }
    expect(removed.text).toContain(`"input_tokens": ${b.result.input_tokens - 1}`)
    expect(added.text).toContain(`"input_tokens": ${b.result.input_tokens}`)
    expect(diff.rows.indexOf(added as never)).toBe(diff.rows.indexOf(removed as never) + 1)
  })

  it("keeps a few unchanged lines around each change and collapses the rest", () => {
    const a = trace("admission-reasons")
    const b = structuredClone(a) as { result: { input_tokens: number } }
    b.result.input_tokens += 1
    const diff = traceDiff(a, b, { context: 2 })
    const skipped = diff.rows.filter((r) => r.kind === "skipped")
    expect(skipped.length).toBeGreaterThan(0)
    for (const row of skipped) expect(row.lines).toBeGreaterThan(0)
    const shown = diff.rows.filter((r) => r.kind === "same").length
    expect(shown).toBeLessThanOrEqual(4)
  })

  it("does not diff traces larger than its bound, and says so", () => {
    const a = trace("admission-reasons")
    const b = structuredClone(a) as { trace_id: string; excluded: unknown[] }
    b.excluded = []
    const diff = traceDiff(a, b, { maxLines: 10 })
    expect(diff).toMatchObject({ changed: true, tooLarge: true, rows: [] })
  })

  it("compares a missing trace with nothing", () => {
    expect(traceDiff(undefined, trace("budget-margin")).changed).toBe(true)
    expect(traceDiff(undefined, undefined).changed).toBe(false)
  })
})
