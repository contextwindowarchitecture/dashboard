import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { REASONS } from "@cwa-dashboard/contract/data"
import type { ContextItem, Snapshot, Trace } from "@cwa-dashboard/contract/types"
import { describe, expect, it } from "vitest"

import {
  PIPELINE_ORDER,
  effectiveTier,
  excludedRowStage,
  pipelineStage,
  reasonInfo,
} from "./reasons"

const cases = resolve(
  import.meta.dirname,
  "../../../../packages/contract/vendor/cwa/conformance/cases",
)
const caseIds = readdirSync(cases).sort()
const readCase = <T>(id: string, file: string): T =>
  JSON.parse(readFileSync(join(cases, id, file), "utf8")) as T

describe("reasonInfo", () => {
  it("returns the registry's kind, rule and text for every code", () => {
    for (const reason of REASONS) {
      if (reason.code === "missing_field:<name>") continue
      expect(reasonInfo(reason.code)).toEqual({
        code: reason.code,
        registered: reason.code,
        kind: reason.kind,
        rule: reason.rule,
        text: reason.text,
      })
    }
  })

  it("reads missing_field:<name> with the field the trace names", () => {
    const registered = REASONS.find((reason) => reason.code === "missing_field:<name>")
    expect(reasonInfo("missing_field:relevance")).toEqual({
      code: "missing_field:relevance",
      registered: "missing_field:<name>",
      kind: "exclusion",
      rule: registered?.rule,
      text: registered?.text,
      field: "relevance",
    })
    expect(reasonInfo("missing_field:")).toBeUndefined()
  })

  it("knows nothing outside the registry", () => {
    for (const invented of ["ITEM_EXPIRED", "BUDGET_SHED_DROPPABLE", "Expired", "expired ", ""]) {
      expect(reasonInfo(invented)).toBeUndefined()
    }
  })

  it("knows every code the vendored cases record", () => {
    for (const id of caseIds) {
      const trace = readCase<Trace>(id, "expected.trace.json")
      for (const row of trace.excluded)
        expect(reasonInfo(row.reason), `${id}: ${row.reason}`).toBeDefined()
      if (trace.refused.reason !== null) {
        expect(reasonInfo(trace.refused.reason)?.kind, id).toBe("refusal")
      }
    }
  })
})

describe("pipelineStage", () => {
  const codesOf = (stage: string) =>
    REASONS.map((reason) => reason.code).filter((code) => pipelineStage(code) === stage)

  // conformance/README.md, Array order: admission, then conflicts, supersession, deduplication and
  // source diversity, then fitting; reasons.json lists the codes in that order (R-21).
  it("places every code in the stage the conformance README orders it by", () => {
    expect(codesOf("conflict")).toEqual(["conflict_deferred", "conflict_lost"])
    expect(codesOf("supersession")).toEqual(["superseded"])
    expect(codesOf("dedupe")).toEqual(["duplicate_content"])
    expect(codesOf("diversity")).toEqual(["source_diversity_cap"])
    expect(codesOf("fitting")).toEqual(["over_budget"])
    expect(codesOf("refusal")).toEqual(
      REASONS.filter((reason) => reason.kind === "refusal").map((reason) => reason.code),
    )
    // The last admission check is placement.
    expect(codesOf("admission").at(-1)).toBe("slot_unplaced")
    expect(codesOf("admission")).toHaveLength(23)
  })

  it("reads missing_field:<name> as admission and an unknown code as no stage", () => {
    expect(pipelineStage("missing_field:expires")).toBe("admission")
    expect(pipelineStage("ITEM_EXPIRED")).toBeUndefined()
  })

  it("orders every vendored trace's excluded rows: producer rows, then the pipeline's", () => {
    let rows = 0
    for (const id of caseIds) {
      const trace = readCase<Trace>(id, "expected.trace.json")
      const ranks = trace.excluded.map((row) => PIPELINE_ORDER.indexOf(excludedRowStage(row)!))
      rows += ranks.length
      expect(
        ranks.every((rank) => rank >= 0),
        id,
      ).toBe(true)
      expect(ranks, id).toEqual([...ranks].sort((a, b) => a - b))
    }
    expect(rows).toBeGreaterThan(100)
  })

  it("keeps a producer's row in the producer stage whatever its code", () => {
    expect(excludedRowStage({ reason: "duplicate_content", stage: "producer" })).toBe("producer")
    expect(excludedRowStage({ reason: "duplicate_content", stage: "assembler" })).toBe("dedupe")
  })

  it("gives a row with a refusal code no stage, since a refusal is never a row", () => {
    expect(excludedRowStage({ reason: "evidence_required", stage: "assembler" })).toBeUndefined()
  })
})

describe("effectiveTier", () => {
  it("takes the item's own tier when it sets one", () => {
    expect(effectiveTier({ slot: "evidence.knowledge", tier: "droppable" }, {})).toEqual({
      tier: "droppable",
      source: "item",
    })
  })

  it("takes the slot default, raised by the route's tier_upgrades and never lowered", () => {
    expect(effectiveTier({ slot: "evidence.knowledge" }, {})).toEqual({
      tier: "compressible",
      source: "slot-default",
    })
    expect(
      effectiveTier(
        { slot: "evidence.knowledge" },
        { tier_upgrades: { "evidence.knowledge": "protected" } },
      ),
    ).toEqual({ tier: "protected", source: "route" })
    // A value at or below the default changes nothing (route_policy.schema.json, tier_upgrades).
    expect(
      effectiveTier(
        { slot: "evidence.knowledge" },
        { tier_upgrades: { "evidence.knowledge": "compressible" } },
      ),
    ).toEqual({ tier: "compressible", source: "slot-default" })
    expect(
      effectiveTier({ slot: "state.task" }, { tier_upgrades: { "state.task": "compressible" } }),
    ).toEqual({ tier: "protected", source: "slot-default" })
  })

  it("has no tier for an item whose slot is not one of the eleven", () => {
    expect(effectiveTier({ slot: "evidence.web" }, {})).toBeUndefined()
    expect(effectiveTier({ slot: 5 }, {})).toBeUndefined()
  })

  it("gives every item of every vendored case a tier", () => {
    for (const id of caseIds) {
      const snapshot = readCase<Snapshot>(id, "snapshot.json")
      const trace = readCase<Trace>(id, "expected.trace.json")
      // Candidates are raw until admission; an included item passed it, so it is a context item.
      const items = new Map(
        snapshot.batches.flatMap((batch) =>
          (batch.items as ContextItem[]).map((item) => [item.id, item] as const),
        ),
      )
      for (const row of trace.included) {
        const item = items.get(row.item_id)
        expect(item, `${id}: ${row.item_id}`).toBeDefined()
        expect(effectiveTier(item!, snapshot.route_policy), `${id}: ${row.item_id}`).toBeDefined()
      }
    }
  })
})
