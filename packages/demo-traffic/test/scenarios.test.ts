import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import { validateSnapshot } from "@cwa-dashboard/contract/validators"
import { describe, expect, it } from "vitest"

import { SCENARIOS } from "../src/scenarios/index.ts"
import { record } from "../src/wrapper.ts"

// Each scenario is written to show something the assembler decides. The expectations are the
// author's intent; the assembler's trace must bear them out.

const recording = (turn: number) => ({
  eventId: "01JA2B3C4D5E6F7G8H9JKMNPQR",
  recordedAt: "2026-10-15T09:30:00.000Z",
  service: { name: "scenario", environment: "demo" },
  redaction: { mode: "full" as const },
  traceId: `scenario-turn-${turn}`,
})

describe("the authored scenarios", () => {
  it("have distinct ids", () => {
    const ids = SCENARIOS.map((scenario) => scenario.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  for (const scenario of SCENARIOS) {
    describe(scenario.id, () => {
      it("writes every turn the assembler is meant to assemble as a valid snapshot", () => {
        for (const [index, turn] of scenario.turns.entries()) {
          if (turn.expect.outcome === "rejected") continue
          const ok = validateSnapshot(turn.snapshot)
          expect(ok ? null : validateSnapshot.errors, `turn ${index}`).toBeNull()
        }
      })

      it("moves its clock forward from turn to turn", () => {
        const times = scenario.turns.map((turn) => Date.parse(turn.snapshot.assembly_time))
        expect(times).toEqual([...times].sort((a, b) => a - b))
        expect(new Set(times).size).toBe(times.length)
      })

      it("shows what it was written to show", () => {
        for (const [index, turn] of scenario.turns.entries()) {
          const event = record(turn.snapshot, recording(index))
          const where = `${scenario.id} turn ${index}`
          expect(event.outcome, `${where}: ${JSON.stringify(event.rejection?.problems)}`).toBe(
            turn.expect.outcome,
          )
          if (turn.expect.refused !== undefined) {
            expect(event.trace?.refused.reason, where).toBe(turn.expect.refused)
          }
          const reasons = new Set(event.trace?.excluded.map((row) => row.reason) ?? [])
          for (const code of turn.expect.excluded ?? []) {
            expect([...reasons], `${where} excludes ${code}`).toContain(code)
          }
          const included = event.trace?.included.map((row) => row.item_id) ?? []
          for (const id of turn.expect.included ?? []) {
            expect(included, `${where} includes ${id}`).toContain(id)
          }
          if (turn.expect.compressed !== undefined) {
            expect(event.trace?.compressed.length ?? 0, where).toBeGreaterThanOrEqual(
              turn.expect.compressed,
            )
          }
        }
      })
    })
  }
})

// The demo covers what exists today (the maintainer, 2026-10-15): between them the scenarios use
// every renderer and tokenizer the published cases use, every published profile, every redaction
// mode and every outcome, so no part of the dashboard is shown on one configuration only.
describe("the scenarios cover what exists today", () => {
  const cases = resolve(import.meta.dirname, "../../contract/vendor/cwa/conformance/cases")
  const published = readdirSync(cases).map(
    (id) =>
      JSON.parse(readFileSync(join(cases, id, "snapshot.json"), "utf8")) as {
        renderer: string
        tokenizer: string
      },
  )
  const snapshots = SCENARIOS.flatMap((scenario) => scenario.turns.map((turn) => turn.snapshot))
  const used = (values: Iterable<string>) => [...new Set(values)].sort()

  it("every published renderer and tokenizer", () => {
    expect(used(snapshots.map((s) => s.renderer))).toEqual(used(published.map((s) => s.renderer)))
    expect(used(snapshots.map((s) => s.tokenizer))).toEqual(used(published.map((s) => s.tokenizer)))
  })

  it("every profile in the published registry", () => {
    const profiles = new Set(snapshots.map((s) => s.profile.id))
    for (const profile of REGISTRY.profiles) expect([...profiles], profile.id).toContain(profile.id)
  })

  it("every redaction mode and every outcome", () => {
    expect(used(SCENARIOS.map((scenario) => scenario.redaction.mode))).toEqual([
      "digest_only",
      "full",
      "pii_scrubbed",
    ])
    expect(
      used(SCENARIOS.flatMap((scenario) => scenario.turns.map((t) => t.expect.outcome))),
    ).toEqual(["assembled", "refused", "rejected"])
  })
})
