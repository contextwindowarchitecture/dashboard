import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../test/fixture-fetch"
import { parseDocument } from "./validate"

const read = (path: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, path), "utf8")) as Record<string, unknown>
const index = () => read("events/index.json")
const firstEventId = () => (index()["events"] as { event_id: string }[])[0]!.event_id

describe("parseDocument", () => {
  it("accepts each kind of the tree as its own kind", () => {
    expect(parseDocument("events-index", index())).toMatchObject({ ok: true })
    expect(parseDocument("assembly-event", read(`events/${firstEventId()}.json`))).toMatchObject({
      ok: true,
    })
    expect(parseDocument("session", read("sessions/refund-7.json"))).toMatchObject({ ok: true })
    expect(parseDocument("fleet-report", read("fleet.json"))).toMatchObject({ ok: true })
  })

  it("calls a document of no dashboard schema, or of another version, unsupported", () => {
    expect(parseDocument("events-index", "text")).toEqual({
      ok: false,
      reason: "unsupported",
      schema: null,
    })
    expect(parseDocument("events-index", { events: [] })).toEqual({
      ok: false,
      reason: "unsupported",
      schema: null,
    })
    expect(parseDocument("events-index", { ...index(), $schema: "cwa-bench/run/v1" })).toEqual({
      ok: false,
      reason: "unsupported",
      schema: "cwa-bench/run/v1",
    })
    expect(
      parseDocument("events-index", { ...index(), $schema: "cwa-dashboard/events-index/v2" }),
    ).toEqual({
      ok: false,
      reason: "unsupported",
      schema: "cwa-dashboard/events-index/v2",
    })
  })

  it("names the kind it found when it is another of the dashboard's", () => {
    expect(parseDocument("assembly-event", read("sessions/refund-7.json"))).toEqual({
      ok: false,
      reason: "wrong-kind",
      expected: "assembly-event",
      actual: "session",
    })
  })

  it("says in words what is wrong with an invalid document, by path", () => {
    const broken = index()
    delete broken["facets"]
    ;(broken["events"] as Record<string, unknown>[])[0]!["outcome"] = "maybe"
    const result = parseDocument("events-index", broken)
    expect(result.ok).toBe(false)
    if (result.ok || result.reason !== "invalid") throw new Error("expected invalid")
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\/ .*facets/),
        expect.stringMatching(/^\/events\/0\/outcome /),
      ]),
    )
  })
})
