import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { settle } from "./settle"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const load = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "events", `${id}.json`), "utf8")) as AssemblyEventV1
const assembled = load(
  index.events.find((r) => r.outcome === "assembled" && (r.compressed_count ?? 0) > 0)!.event_id,
)
const refused = load(index.events.find((r) => r.outcome === "refused")!.event_id)

describe("settle", () => {
  it("starts each segment of the replay at the width it had in the recorded assembly", () => {
    const plan = settle(assembled, assembled)!
    expect(plan.ghosts).toEqual([])
    for (const [key, from] of Object.entries(plan.from)) expect(from, key).toBeGreaterThan(0)
  })

  it("grows a segment the recording did not have from nothing, and collapses one the replay lost", () => {
    // The recording refused, so every segment of the replay grows from nothing.
    const grow = settle(refused, assembled)!
    expect(grow.ghosts).toEqual([])
    expect(Object.keys(grow.from).length).toBeGreaterThan(0)
    expect(Object.values(grow.from).every((width) => width === 0)).toBe(true)
    // The replay refused, so every segment of the recording collapses.
    const collapse = settle(assembled, refused)!
    expect(collapse.ghosts.length).toBeGreaterThan(0)
    for (const key of collapse.ghosts) expect(collapse.from[key]).toBeGreaterThan(0)
  })

  it("has nothing to settle from when the event recorded no assembly", () => {
    const rejected = load(index.events.find((r) => r.outcome === "rejected")!.event_id)
    expect(settle(rejected, assembled)).toBeUndefined()
  })
})
