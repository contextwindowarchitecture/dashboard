// The sources report (sources-report v1): what each producer sent in the window and what became of
// it, from the events' snapshots and traces.

import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { sourcesReport } from "../src/derive.ts"
import type { AssemblyEventV1 } from "../generated/types.ts"
import { validateSourcesReportV1 } from "../generated/validators.js"

const EVENTS_DIR = resolve(import.meta.dirname, "../../demo-traffic/fixtures/events")
const read = (id: string) =>
  JSON.parse(readFileSync(join(EVENTS_DIR, `${id}.json`), "utf8")) as AssemblyEventV1
const ALL = readdirSync(EVENTS_DIR)
  .filter((name) => name.endsWith(".json") && name !== "index.json")
  .map((name) => read(name.replace(/\.json$/, "")))
const AT = "2026-10-17T00:00:00.000Z"

describe("sourcesReport", () => {
  it("counts one event's producers as its batches and trace say", () => {
    // Four batches; wiki-corpus sent wiki:refund and wiki:fees, reported wiki:refund-paraphrase as a
    // duplicate itself, and the assembler excluded wiki:refund as a duplicate of kb:a.
    const report = sourcesReport([read("01M4YZT6M0TMR0MJ171Q2W6C1M")], AT)
    const none = { compressed: 0, excluded: [], rejected_events: 0, events: 1 }
    expect(report.producers).toEqual([
      {
        id: "conversation",
        kind: "interaction",
        submitted: 1,
        admitted: 1,
        included_tokens: 6,
        ...none,
      },
      {
        id: "policy-corpus",
        kind: "retrieval",
        submitted: 1,
        admitted: 1,
        included_tokens: 8,
        ...none,
      },
      {
        id: "policy-registry",
        kind: "policy",
        submitted: 1,
        admitted: 1,
        included_tokens: 10,
        ...none,
      },
      {
        id: "wiki-corpus",
        kind: "retrieval",
        submitted: 2,
        admitted: 1,
        included_tokens: 5,
        ...none,
        excluded: [
          { reason: "duplicate_content", stage: "producer", items: 1 },
          { reason: "duplicate_content", stage: "assembler", items: 1 },
        ],
      },
    ])
    expect(report.window).toEqual({
      from: "2026-10-15T05:16:00.000Z",
      to: "2026-10-15T05:16:00.000Z",
      events: 1,
    })
  })

  it("counts a rejected event's producers apart, and nothing else of it", () => {
    const rejected = ALL.find((e) => e.outcome === "rejected" && e.rejection?.snapshot)!
    const report = sourcesReport([rejected], AT)
    for (const producer of report.producers) {
      expect(producer).toMatchObject({ events: 0, submitted: 0, admitted: 0, rejected_events: 1 })
    }
  })

  it("covers the whole demo tree as a valid report, producers ordered, reasons in the contract's order", () => {
    const report = sourcesReport(ALL, AT)
    expect(validateSourcesReportV1(report) ? null : validateSourcesReportV1.errors).toBeNull()
    expect(report.window.events).toBe(ALL.length)
    const keys = report.producers.map((p) => `${p.id} ${p.kind}`)
    expect(keys).toEqual([...keys].sort())
    const assembled = ALL.filter((e) => e.trace !== undefined)
    const submitted = assembled.reduce(
      (n, e) => n + e.snapshot!.batches.reduce((m, b) => m + b.items.length, 0),
      0,
    )
    expect(report.producers.reduce((n, p) => n + p.submitted, 0)).toBe(submitted)
    for (const p of report.producers) expect(p.admitted).toBeLessThanOrEqual(p.submitted)
  })
})
