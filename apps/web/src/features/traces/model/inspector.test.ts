import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { SLOT_DEFAULTS } from "@cwa-dashboard/contract/data"
import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { PIPELINE_ORDER } from "../../../lib/reasons"
import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { excludedByStage, joinItems, placementRows, planeTotals } from "./inspector"

const events = readdirSync(join(FIXTURES_DIR, "events"))
  .filter((name) => name !== "index.json")
  .map(
    (name) =>
      JSON.parse(readFileSync(join(FIXTURES_DIR, "events", name), "utf8")) as AssemblyEventV1,
  )
const withTrace = events.filter((event) => event.trace !== undefined)
const assembled = events.filter((event) => event.outcome === "assembled")
const plane = (slot: string) => SLOT_DEFAULTS[slot as keyof typeof SLOT_DEFAULTS].plane

describe("joinItems", () => {
  it("joins every included occurrence to its candidate and producer, with no orphan", () => {
    for (const event of assembled) {
      const rows = joinItems(event)
      expect(rows, event.event_id).toHaveLength(event.trace!.included.length)
      rows.forEach((row, i) => {
        const occurrence = event.trace!.included[i]!
        expect(row.item_id).toBe(occurrence.item_id)
        expect(row.tokens).toBe(occurrence.tokens)
        expect(row.plane).toBe(plane(occurrence.slot))
        expect(row.producer, `${event.event_id} ${row.item_id}`).toBeDefined()
      })
    }
  })

  // R-DASH-1: item metadata is visible for every item, in every redaction mode.
  it("gives every item its metadata in every mode", () => {
    const modes = new Set<string>()
    for (const event of assembled) {
      modes.add(event.redaction_mode)
      for (const row of joinItems(event)) {
        for (const field of [
          "authority",
          "trust",
          "freshness",
          "source",
          "source_version",
        ] as const) {
          expect(row[field], `${event.event_id} ${row.item_id} ${field}`).toBeTypeOf("string")
        }
        expect(row.tier?.tier, `${event.event_id} ${row.item_id} tier`).toBeTypeOf("string")
        expect(row.lineage?.value, `${event.event_id} ${row.item_id} lineage`).toBeTypeOf("string")
        expect(
          row.injection_risk?.value,
          `${event.event_id} ${row.item_id} injection_risk`,
        ).toBeTypeOf("string")
        expect(row.producer.id).toBeTypeOf("string")
      }
    }
    expect([...modes].sort()).toEqual(["digest_only", "full", "pii_scrubbed"])
  })

  it("marks a policy field the assembler filled from the defaults as a default", () => {
    const included = (e: AssemblyEventV1) => new Set(e.trace!.included.map((row) => row.item_id))
    const event = assembled.find((e) =>
      e.trace!.defaults_filled.some(
        (row) => row.field === "lineage" && included(e).has(row.item_id),
      ),
    )!
    const filled = event.trace!.defaults_filled.find(
      (row) => row.field === "lineage" && included(event).has(row.item_id),
    )!
    const row = joinItems(event).find((r) => r.item_id === filled.item_id)!
    expect(row.lineage).toEqual({
      value: SLOT_DEFAULTS[row.slot as keyof typeof SLOT_DEFAULTS].lineage,
      defaulted: true,
    })
  })

  it("carries each compressed occurrence's step-down", () => {
    const event = assembled.find((e) => e.trace!.compressed.length > 0)!
    const rows = joinItems(event).filter((row) => row.compressed)
    expect(rows).toHaveLength(event.trace!.compressed.length)
    expect(rows[0]!.compressed).toEqual(
      expect.objectContaining({
        from: expect.any(Number),
        to: expect.any(Number),
        method: expect.any(String),
      }),
    )
  })

  it("gives each body the form its mode left it in", () => {
    const formOf = (mode: string) =>
      new Set(
        assembled
          .filter((e) => e.redaction_mode === mode)
          .flatMap((e) => joinItems(e).map((row) => row.body.form)),
      )
    expect([...formOf("full")]).toEqual(["text"])
    expect([...formOf("digest_only")]).toEqual(["digest"])
    expect([...formOf("pii_scrubbed")]).toEqual(["scrubbed"])
    const digested = joinItems(assembled.find((e) => e.redaction_mode === "digest_only")!)[0]!.body
    expect(digested).toMatchObject({
      form: "digest",
      content_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })
})

describe("planeTotals", () => {
  it("sums each plane's included tokens and names the rendering overhead", () => {
    for (const event of assembled) {
      const totals = planeTotals(event.trace!)
      const sum = event.trace!.included.reduce((total, row) => total + row.tokens, 0)
      expect(
        Object.values(totals.byPlane).reduce((a, b) => a + b, 0),
        event.event_id,
      ).toBe(sum)
      expect(totals.overhead, event.event_id).toBe(
        Math.max(0, event.trace!.result!.input_tokens - sum),
      )
      expect(totals.overheadNegative).toBe(event.trace!.result!.input_tokens < sum)
    }
  })

  it("has no overhead to name for a refusal, which rendered nothing", () => {
    const refused = events.find((e) => e.outcome === "refused")!
    const totals = planeTotals(refused.trace!)
    expect(totals.byPlane).toEqual({ gov: 0, state: 0, evid: 0, inter: 0 })
    expect(totals.overhead).toBeUndefined()
  })
})

describe("placementRows", () => {
  it("lists the profile's placements in order, with every occurrence placed once", () => {
    for (const event of assembled) {
      const rows = placementRows(event)
      expect(
        rows.placed.map((p) => p.slot),
        event.event_id,
      ).toEqual(event.snapshot!.profile.placement.map((p) => p.slot))
      expect(
        rows.placed.reduce((n, p) => n + p.occurrences.length, 0),
        event.event_id,
      ).toBe(event.trace!.included.length)
      for (const placement of rows.placed) {
        for (const occurrence of placement.occurrences) expect(occurrence.slot).toBe(placement.slot)
      }
    }
  })

  it("gives each placement of a slot placed twice its own occurrences of the slot's items", () => {
    const twice = assembled.filter((e) => {
      const slots = e.snapshot!.profile.placement.map((p) => p.slot)
      return slots.some((slot, i) => slots.indexOf(slot) !== i)
    })
    expect(twice.length).toBeGreaterThan(0)
    for (const event of twice) {
      const bySlot = new Map<string, string[][]>()
      for (const placement of placementRows(event).placed) {
        bySlot.set(placement.slot, [
          ...(bySlot.get(placement.slot) ?? []),
          placement.occurrences.map((o) => o.item_id),
        ])
      }
      for (const [slot, runs] of bySlot) {
        for (const run of runs) expect(run, `${event.event_id} ${slot}`).toEqual(runs[0])
      }
    }
  })

  it("names the slots left unplaced", () => {
    const event = withTrace.find((e) =>
      e.trace!.excluded.some((row) => row.reason === "slot_unplaced"),
    )!
    const unplaced = event
      .trace!.excluded.filter((row) => row.reason === "slot_unplaced")
      .map((row) => row.slot)
    expect(placementRows(event).unplaced).toEqual([...new Set(unplaced)].sort())
  })
})

describe("excludedByStage", () => {
  it("groups every excluded row by stage, in pipeline order, with its producer where the snapshot names one", () => {
    for (const event of withTrace) {
      const groups = excludedByStage(event)
      expect(groups.map((g) => g.stage)).toEqual(
        PIPELINE_ORDER.filter((stage) => groups.some((g) => g.stage === stage)),
      )
      expect(
        groups.reduce((n, g) => n + g.rows.length, 0),
        event.event_id,
      ).toBe(event.trace!.excluded.length)
      for (const row of groups.flatMap((g) => g.rows))
        expect(row.producer, `${event.event_id} ${row.item_id}`).toBeDefined()
    }
  })
})
