import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { excludedByStage } from "./inspector"
import { stageTimeline } from "./stage-timeline"

const events = readdirSync(join(FIXTURES_DIR, "events"))
  .filter((name) => name !== "index.json")
  .map(
    (name) =>
      JSON.parse(readFileSync(join(FIXTURES_DIR, "events", name), "utf8")) as AssemblyEventV1,
  )
  .filter((event) => event.trace !== undefined)

describe("stageTimeline", () => {
  it("steps through the trace's stages in the order its rows are grouped", () => {
    for (const event of events) {
      const steps = stageTimeline(event)
      const stages = excludedByStage(event).map((group) => group.stage)
      expect(
        steps.filter((s) => s.kind === "stage").map((s) => s.stage),
        event.event_id,
      ).toEqual(stages)
    }
  })

  it("ends a refused trace on its refusal, and an assembled one on its last stage", () => {
    for (const event of events) {
      const steps = stageTimeline(event)
      const last = steps.at(-1)
      if (event.outcome === "refused") {
        expect(last, event.event_id).toEqual({
          kind: "refusal",
          stage: "refusal",
          code: event.trace!.refused.reason,
        })
      } else if (steps.length > 0) {
        expect(last!.kind, event.event_id).toBe("stage")
      }
    }
  })

  it("has nothing to walk for a trace that excluded nothing and assembled", () => {
    const quiet = events.find(
      (event) => event.outcome === "assembled" && event.trace!.excluded.length === 0,
    )!
    expect(stageTimeline(quiet)).toEqual([])
  })
})
