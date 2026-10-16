import { readFileSync } from "node:fs"
import { join } from "node:path"

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { AssemblyEventV1, SessionV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { applyControls, profileChoices, type Snapshot } from "./controls"

// A refund-7 turn: support-chat under illustrative/v1, recorded with full bodies.
const session = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "sessions/refund-7.json"), "utf8"),
) as SessionV1
const event = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events", `${session.turns[0]!.event_id}.json`), "utf8"),
) as AssemblyEventV1
const snapshot = event.snapshot as unknown as Snapshot
const ids = (s: Snapshot) => s.batches.flatMap((b) => b.items.map((i) => (i as { id: string }).id))

describe("applyControls", () => {
  it("leaves the snapshot as it was with no controls, in a copy", () => {
    const { snapshot: out, problems } = applyControls(snapshot, {})
    expect(out).toEqual(snapshot)
    expect(out).not.toBe(snapshot)
    expect(problems).toEqual([])
  })

  it("sets the budget's input, reserve and margin the controls give, and keeps the rest", () => {
    const { snapshot: out } = applyControls(snapshot, { input: 300, margin_percent: 10 })
    expect(out.budget).toEqual({ ...snapshot.budget, input: 300, margin_percent: 10 })
    expect(applyControls(snapshot, { reserved_output: 0 }).snapshot.budget.reserved_output).toBe(0)
  })

  it("takes the disabled items out of every batch, and nothing else", () => {
    const off = ids(snapshot).slice(0, 2)
    const { snapshot: out } = applyControls(snapshot, { off })
    expect(ids(out)).toEqual(ids(snapshot).filter((id) => !off.includes(id)))
    expect(out.batches.map((b) => b.producer)).toEqual(snapshot.batches.map((b) => b.producer))
  })

  it("moves the assembly time by the offset, in seconds", () => {
    const { snapshot: out } = applyControls(snapshot, { offset: 86_400 })
    expect(Date.parse(out.assembly_time) - Date.parse(snapshot.assembly_time)).toBe(86_400_000)
  })

  it("swaps in a registry profile for the same route and policy version (R-20)", () => {
    const { snapshot: out, problems } = applyControls(snapshot, { profile: "policy-first-chat@1" })
    expect(problems).toEqual([])
    expect(out.profile).toEqual(REGISTRY.profiles.find((p) => p.id === "policy-first-chat"))
  })

  it("refuses a profile of another route or policy version, and says why", () => {
    const { snapshot: out, problems } = applyControls(snapshot, { profile: "document-analysis@1" })
    expect(out.profile).toEqual(snapshot.profile)
    expect(problems).toEqual([expect.stringContaining("R-20")])
  })
})

describe("profileChoices", () => {
  it("offers the recorded profile and every registry profile, those of other routes or versions disabled with the R-20 reason", () => {
    const choices = profileChoices(snapshot)
    expect(choices[0]).toMatchObject({ value: "", available: true })
    const byId = (id: string) => choices.find((c) => c.value === `${id}@1`)!
    expect(byId("cache-first-chat").available).toBe(true)
    expect(byId("policy-first-chat").available).toBe(true)
    expect(byId("document-analysis")).toMatchObject({ available: false })
    expect(byId("document-analysis").reason).toContain("R-20")
    expect(choices).toHaveLength(REGISTRY.profiles.length + 1)
  })

  it("disables a profile of the same route that binds another policy version", () => {
    const other = {
      ...snapshot,
      route_policy: { ...snapshot.route_policy, version: "admission/v1" },
    }
    const cacheFirst = profileChoices(other).find((c) => c.value === "cache-first-chat@1")!
    expect(cacheFirst.available).toBe(false)
    expect(cacheFirst.reason).toContain("illustrative/v1")
  })
})
