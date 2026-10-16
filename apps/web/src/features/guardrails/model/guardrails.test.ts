import { readFileSync } from "node:fs"
import { join } from "node:path"

import { REASONS, REQUIREMENTS } from "@cwa-dashboard/contract/data"
import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { GUARDRAILS, guardrailCounts } from "./guardrails"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1

describe("the guardrails", () => {
  it("are the seven failure modes, numbered 01 to 07", () => {
    expect(GUARDRAILS.map((g) => g.number)).toEqual(["01", "02", "03", "04", "05", "06", "07"])
    expect(GUARDRAILS.map((g) => g.name)).toEqual([
      "Authority inversion",
      "Instruction-shaped evidence",
      "Stale-as-current",
      "Memory that never expires",
      "Displacement under budget",
      "Redundant re-reading",
      "Missing trigger",
    ])
  })

  // AGENTS.md, "Never invent vocabulary": every code and rule a card names is the contract's.
  it("monitor only codes of contract/reasons.json and cite only its requirements", () => {
    const codes = new Set(REASONS.map((r) => r.code as string))
    const rules = new Set(REQUIREMENTS.map((r) => r.id as string))
    for (const guardrail of GUARDRAILS) {
      for (const code of guardrail.codes)
        expect(codes, `${guardrail.number} ${code}`).toContain(code)
      for (const rule of guardrail.requirements)
        expect(rules, `${guardrail.number} ${rule}`).toContain(rule)
      expect(guardrail.requirements.length, guardrail.number).toBeGreaterThan(0)
    }
  })

  it("count each event once, when its trace records any of the guardrail's codes", () => {
    const counts = guardrailCounts(index.events)
    for (const guardrail of GUARDRAILS) {
      const count = counts.get(guardrail.number)
      if (guardrail.codes.length === 0) {
        expect(count, guardrail.number).toBeUndefined()
        continue
      }
      const expected = index.events.filter((row) =>
        guardrail.codes.some(
          (code) => row.reason_codes.includes(code) || row.refused_reason === code,
        ),
      ).length
      expect(count, guardrail.number).toBe(expected)
    }
    expect(counts.get("05")).toBeGreaterThan(0)
    expect(counts.get("03")).toBeGreaterThan(0)
  })

  it("say redundant re-reading is measured per session, not counted from the index", () => {
    const rereading = GUARDRAILS.find((g) => g.number === "06")!
    expect(rereading.codes).toEqual([])
    expect(rereading.measure).toMatch(/session/)
  })
})
