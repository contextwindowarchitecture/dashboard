import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

// The sandbox's fidelity rules, the module its page runs, over every demo event and the real
// assembler: what the page claims about a replay has to hold for each.
import { parity, replayable } from "../../web/src/features/sandbox/model/fidelity.ts"
import { replay } from "../src/replay.ts"

const events = resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures/events")
const all = readdirSync(events)
  .filter((name) => name !== "index.json")
  .map((name) => JSON.parse(readFileSync(join(events, name), "utf8")) as AssemblyEventV1)

describe("every demo event, replayed as the sandbox would", () => {
  it("replays each full event to the trace, hash and digest it recorded", () => {
    const full = all.filter((e) => e.redaction_mode === "full" && e.outcome !== "rejected")
    expect(full.length).toBeGreaterThan(50)
    for (const event of full) {
      const source = replayable(event)
      if (source.kind !== "full") throw new Error(event.event_id)
      const result = replay(source.snapshot)
      expect(result.status, event.event_id).toBe(200)
      if (result.status !== 200) continue
      const check = parity(
        event,
        {
          outcome: result.body.outcome,
          payloadHash: result.body.payload_hash,
          snapshotDigest: result.body.snapshot_digest,
        },
        { edited: false },
      )
      expect(check.kind, event.event_id).toBe("equal")
      const {
        trace_id: _a,
        timings: _b,
        ...replayed
      } = result.body.trace as Record<string, unknown>
      const {
        trace_id: _c,
        timings: _d,
        ...recorded
      } = event.trace as unknown as Record<string, unknown>
      expect(replayed, event.event_id).toEqual(recorded)
    }
  })

  it("replays each scrubbed event over its scrubbed text", () => {
    const scrubbed = all.filter(
      (e) => e.redaction_mode === "pii_scrubbed" && e.outcome !== "rejected",
    )
    expect(scrubbed.length).toBeGreaterThan(0)
    for (const event of scrubbed) {
      const source = replayable(event)
      expect(source.kind).toBe("scrubbed")
      if (source.kind === "scrubbed")
        expect(replay(source.snapshot).status, event.event_id).toBe(200)
    }
  })

  it("rejects each rejected event again, unless what was rejected is a value its JSON could not keep", () => {
    const rejected = all.filter((e) => e.outcome === "rejected" && e.redaction_mode === "full")
    expect(rejected.length).toBeGreaterThan(10)
    for (const event of rejected) {
      const source = replayable(event)
      expect(source.kind).toBe("rejected")
      if (source.kind !== "rejected") continue
      const lost = event.rejection!.problems.some((p) => p.includes("not I-JSON"))
      expect(replay(source.snapshot).status, event.event_id).toBe(lost ? 200 : 400)
    }
  })
})
