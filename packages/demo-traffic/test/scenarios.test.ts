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
