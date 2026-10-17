// The draft's models (ADR-0013): what changed against where it started, a field read and set by its
// kind as the contract's FIELDS give it, and a snapshot with the draft in place for a preview. Over
// the registry's own entries and a demo event.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { FIELDS } from "@cwa-dashboard/contract/data"
import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { changes, fieldText, setField, withDraft } from "./draft"

const PROFILE = REGISTRY.profiles[0]!
const POLICY = REGISTRY.route_policies[0]!
const field = (kind: "profile" | "route_policy", name: string) =>
  FIELDS[kind].find((f) => f.name === name)!

describe("changes", () => {
  it("lists every changed path, as a JSON Pointer, before and after", () => {
    const after = structuredClone(PROFILE) as Record<string, unknown>
    after["version"] = 2
    ;(after["placement"] as unknown[]).pop()
    expect(changes(PROFILE, after)).toEqual([
      {
        path: `/placement/${PROFILE.placement.length - 1}`,
        before: PROFILE.placement.at(-1),
        after: undefined,
      },
      { path: "/version", before: PROFILE.version, after: 2 },
    ])
  })

  it("escapes a key holding a slash or a tilde, and finds nothing in an unchanged document", () => {
    expect(changes({ "a/b~c": 1 }, { "a/b~c": 2 })).toEqual([
      { path: "/a~1b~0c", before: 1, after: 2 },
    ])
    expect(changes(POLICY, structuredClone(POLICY))).toEqual([])
  })
})

describe("a field, by its kind", () => {
  it("reads and sets a scalar as itself, a missing optional one as empty", () => {
    expect(fieldText(PROFILE, field("profile", "version"))).toBe(String(PROFILE.version))
    expect(setField(PROFILE, field("profile", "version"), "3")).toEqual({
      ok: true,
      document: { ...PROFILE, version: 3 },
    })
    const parser = field("route_policy", "parser")
    expect(setField(POLICY, parser, "true")).toMatchObject({ ok: true, document: { parser: true } })
    // An optional field emptied is removed; the rest stays as it was.
    expect(setField({ ...POLICY, parser: true }, parser, "")).toEqual({
      ok: true,
      document: POLICY,
    })
  })

  it("says what is wrong with a value its kind cannot hold, and leaves the document as it was", () => {
    expect(setField(PROFILE, field("profile", "version"), "two")).toEqual({
      ok: false,
      problem: "version is a whole number",
    })
    expect(setField(PROFILE, field("profile", "placement"), "[1,")).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/^placement is not JSON/),
    })
  })

  it("reads and sets an object or an array as JSON", () => {
    const placement = field("profile", "placement")
    expect(JSON.parse(fieldText(PROFILE, placement))).toEqual(PROFILE.placement)
    const one = JSON.stringify(PROFILE.placement.slice(0, 1))
    expect(setField(PROFILE, placement, one)).toMatchObject({
      ok: true,
      document: { placement: PROFILE.placement.slice(0, 1) },
    })
  })
})

describe("withDraft", () => {
  it("puts the draft in place of the snapshot's profile or route policy, and nothing else", () => {
    const index = JSON.parse(
      readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
    ) as EventsIndexV1
    const event = JSON.parse(
      readFileSync(
        join(
          FIXTURES_DIR,
          "events",
          `${index.events.find((r) => r.outcome === "assembled")!.event_id}.json`,
        ),
        "utf8",
      ),
    ) as AssemblyEventV1
    const draft = { ...event.snapshot!.profile, version: 9 }
    const swapped = withDraft(event.snapshot!, "profile", draft)
    expect(swapped).toEqual({ ...event.snapshot, profile: draft })
    expect(withDraft(event.snapshot!, "route_policy", POLICY)).toEqual({
      ...event.snapshot,
      route_policy: POLICY,
    })
  })
})
