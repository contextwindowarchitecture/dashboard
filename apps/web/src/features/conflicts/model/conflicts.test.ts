import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { conflictEvents, conflictForest, RESOLVING_CODES } from "./conflicts"

const event = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "events", `${id}.json`), "utf8")) as AssemblyEventV1
const ALL = readdirSync(join(FIXTURES_DIR, "events"))
  .filter((name) => name.endsWith(".json") && name !== "index.json")
  .map((name) => event(name.replace(/\.json$/, "")))
const edgesOf = (id: string) =>
  conflictForest(event(id)).edges.map((e) => `${e.child} -> ${e.parent} (${e.code})`)

describe("RESOLVING_CODES", () => {
  it("are the registry's codes of the conflict, supersession and deduplication rules", () => {
    expect([...RESOLVING_CODES].sort()).toEqual(
      [
        "conflict_deferred",
        "conflict_lost",
        "conflict_unresolved",
        "duplicate_content",
        "superseded",
      ].sort(),
    )
  })
})

describe("conflictForest", () => {
  it("hangs a duplicate under the item it duplicates, along a chain", () => {
    expect(edgesOf("01M4YZT6M0TMR0MJ171Q2W6C1M")).toEqual(
      expect.arrayContaining([
        "item:wiki:refund-paraphrase -> item:wiki:refund (duplicate_content)",
        "item:wiki:refund -> item:kb:a (duplicate_content)",
      ]),
    )
    const forest = conflictForest(event("01M4YZT6M0TMR0MJ171Q2W6C1M"))
    expect(forest.nodes.find((n) => n.key === "item:kb:a")).toMatchObject({ status: "kept" })
    expect(forest.nodes.find((n) => n.key === "item:wiki:refund")).toMatchObject({
      status: "excluded",
      producer: { id: "wiki-corpus", kind: "retrieval" },
    })
  })

  it("hangs a conflict's loser under its winner, and a superseded item under what replaced it", () => {
    const forest = conflictForest(event("01M4YZXVT0N9BECJFQPP1EDDVP"))
    expect(edgesOf("01M4YZXVT0N9BECJFQPP1EDDVP")).toContain(
      "item:wiki:w -> item:kb:w1 (conflict_lost)",
    )
    expect(forest.edges.filter((e) => e.code === "superseded")).toHaveLength(1)
    expect(forest.edges.filter((e) => e.code === "duplicate_content")).toHaveLength(1)
    // A group with a winner needs no node of its own.
    expect(forest.nodes.some((n) => n.kind === "group")).toBe(false)
  })

  it("roots a group with no winner, its members under it by reason or by the group's resolution", () => {
    const forest = conflictForest(event("01M4YZHYYGC6H1HAH74899MJ2C"))
    // g-all-defer surfaced both instructions: both kept, under the group, by its resolution.
    for (const id of ["ex:refund-no", "ex:refund-yes"]) {
      expect(forest.edges).toContainEqual({
        child: `item:${id}`,
        parent: "group:g-all-defer",
        code: "surfaced",
      })
    }
    // g-peers has a winner: the members it deferred hang under it, by their row's reason.
    expect(forest.edges).toContainEqual({
      child: "item:ex:bullets",
      parent: "item:policy:format",
      code: "conflict_deferred",
    })
    const surfaced = conflictForest(event("01M4YYZN0GKV7ZPC9NYXPXTX31"))
    const kept = surfaced.edges.filter((e) => e.parent === "group:g-cite")
    expect(kept.length).toBe(2)
    expect(kept.every((e) => e.code === "surfaced")).toBe(true)
  })

  it("is a forest for every demo event: one parent at most, every parent a node, no cycle", () => {
    for (const e of ALL.filter((x) => x.trace !== undefined)) {
      const forest = conflictForest(e)
      const keys = new Set(forest.nodes.map((n) => n.key))
      const children = forest.edges.map((edge) => edge.child)
      expect(new Set(children).size, e.event_id).toBe(children.length)
      for (const edge of forest.edges) expect(keys.has(edge.parent), e.event_id).toBe(true)
      expect(forest.cycle, e.event_id).toBe(false)
    }
  })
})

describe("a trace whose links loop", () => {
  it("is said to loop, so no tree is drawn from it", () => {
    // The chain's root made a duplicate of its own descendant: no conformant trace does this.
    const looped = structuredClone(event("01M4YZT6M0TMR0MJ171Q2W6C1M"))
    looped.trace!.excluded.push({
      item_id: "kb:a",
      reason: "duplicate_content",
      stage: "assembler",
      duplicate_of: "wiki:refund",
    })
    expect(conflictForest(looped).cycle).toBe(true)
  })
})

describe("conflictEvents", () => {
  it("lists the window's events with a resolving code, and counts each code's events", () => {
    const index = JSON.parse(
      readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
    ) as EventsIndexV1
    const { rows, counts } = conflictEvents(index)
    const codesOf = (row: EventsIndexV1["events"][number]) => [
      ...row.reason_codes,
      ...(row.refused_reason ? [row.refused_reason] : []),
    ]
    expect(rows.map((r) => r.event_id)).toEqual(
      index.events
        .filter((r) => codesOf(r).some((c) => RESOLVING_CODES.includes(c)))
        .map((r) => r.event_id),
    )
    for (const { code, events } of counts) {
      expect(events, code).toBe(index.events.filter((r) => codesOf(r).includes(code)).length)
    }
    expect(counts.map((c) => c.code)).toEqual(
      RESOLVING_CODES.filter((code) => counts.some((c) => c.code === code)),
    )
  })
})
