import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { withheld } from "../../../test/withheld"
import { parity, replayable, type Replayed } from "./fidelity"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const load = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "events", `${id}.json`), "utf8")) as AssemblyEventV1
const first = (mode: string, outcome = "assembled") =>
  load(index.events.find((r) => r.redaction_mode === mode && r.outcome === outcome)!.event_id)
const bodies = (snapshot: unknown) =>
  (snapshot as { batches: { items: { body: unknown }[] }[] }).batches.flatMap((b) =>
    b.items.map((i) => i.body),
  )

const full = first("full")
const scrubbed = first("pii_scrubbed")
const digested = first("digest_only")
const replayedAs = (event: AssemblyEventV1, change: Partial<Replayed> = {}): Replayed => ({
  outcome: event.outcome === "refused" ? "refused" : "assembled",
  payloadHash: event.payload?.hash ?? null,
  snapshotDigest: event.trace!.context.snapshot_digest,
  ...change,
})

describe("replayable", () => {
  it("replays a full event's snapshot as recorded", () => {
    const result = replayable(full)
    expect(result.kind).toBe("full")
    if (result.kind === "full") expect(result.snapshot).toEqual(full.snapshot)
  })

  it("replays a scrubbed event over the scrubbed text it holds, and says it can claim no parity", () => {
    const result = replayable(scrubbed)
    expect(result.kind).toBe("scrubbed")
    if (result.kind !== "scrubbed") return
    const texts = bodies(scrubbed.snapshot).map((b) =>
      typeof b === "object" && b !== null && "text" in b ? (b as { text: string }).text : b,
    )
    expect(bodies(result.snapshot)).toEqual(texts)
    expect(result.reason).toContain("scrubbed")
  })

  it("cannot replay an event whose bodies were withheld from the reader, and says why", () => {
    for (const event of [full, scrubbed]) {
      const answer = replayable(withheld(event))
      expect(answer.kind).toBe("none")
      expect(answer.kind === "none" && answer.reason).toMatch(/withheld/)
      expect(answer.kind === "none" && answer.reason).toMatch(/owner/)
    }
  })

  it("cannot replay a digested event, and says why and where the setting is", () => {
    const result = replayable(digested)
    expect(result.kind).toBe("none")
    if (result.kind === "none") {
      expect(result.reason).toContain("digest_only")
      expect(result.reason).toContain("routes.<route>.redaction_mode")
    }
  })

  it("replays a rejected event's recorded snapshot, saying it may have lost what was rejected", () => {
    const rejected = load(
      index.events.find((r) => r.outcome === "rejected" && r.redaction_mode === "full")!.event_id,
    )
    const result = replayable(rejected)
    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.snapshot).toEqual(rejected.rejection!.snapshot)
    expect(result.reason).toContain("A value JSON cannot hold")
  })
})

describe("parity", () => {
  it("finds a full event's replay equal when its hash and digest are the recorded ones", () => {
    expect(parity(full, replayedAs(full), { edited: false })).toMatchObject({
      kind: "equal",
      crossImplementation: false,
    })
  })

  it("finds them different when either differs, without saying which assembler is wrong", () => {
    const differ = parity(full, replayedAs(full, { payloadHash: "0".repeat(64) }), {
      edited: false,
    })
    expect(differ).toMatchObject({ kind: "differ" })
    if (differ.kind === "differ") expect(differ.note).toContain("one of the two is non-conformant")
  })

  it("calls it a cross-implementation check when another language's service recorded the event (R-23)", () => {
    const go = { ...full, assembler: { ...full.assembler, language: "go" as const } }
    expect(parity(go, replayedAs(full), { edited: false })).toMatchObject({
      kind: "equal",
      crossImplementation: true,
    })
  })

  it("claims nothing for an edited snapshot or a scrubbed event", () => {
    expect(parity(full, replayedAs(full), { edited: true }).kind).toBe("edited")
    expect(parity(scrubbed, replayedAs(scrubbed), { edited: false }).kind).toBe("no-claim")
  })
})
