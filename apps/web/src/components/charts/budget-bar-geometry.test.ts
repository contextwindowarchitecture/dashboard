import { describe, expect, it } from "vitest"

import { budgetBar } from "./budget-bar-geometry"

const planes = { gov: 300, state: 100, evid: 400, inter: 200 }
const none = { gov: 0, state: 0, evid: 0, inter: 0 }

describe("budgetBar", () => {
  it("lays each plane, its compressed share and the overhead along the budget", () => {
    const bar = budgetBar({
      budget: { input: 2000, reserved_output: 500 },
      byPlane: planes,
      compressedByPlane: { ...none, evid: 100 },
      overhead: 50,
      inputTokens: 1050,
    })
    expect(bar.segments.map((s) => [s.key, s.tokens])).toEqual([
      ["gov", 300],
      ["state", 100],
      ["evid", 300],
      ["evid-compressed", 100],
      ["inter", 200],
      ["overhead", 50],
    ])
    expect(bar.segments[0]!.percent).toBe(15)
    expect(bar.used).toBe(1050)
    expect(bar.free).toBe(950)
    expect(bar.overBudget).toBe(false)
    expect(bar.reservedPercent).toBe(25)
  })

  it("leaves out empty segments", () => {
    const bar = budgetBar({
      budget: { input: 1000, reserved_output: 0 },
      byPlane: { ...none, gov: 10 },
      compressedByPlane: none,
      overhead: 0,
      inputTokens: 10,
    })
    expect(bar.segments.map((s) => s.key)).toEqual(["gov"])
  })

  it("draws the margin as the line the payload must fit under", () => {
    const bar = budgetBar({
      budget: { input: 1150, reserved_output: 0, margin_percent: 15 },
      byPlane: planes,
      compressedByPlane: none,
      overhead: 0,
      inputTokens: 1000,
    })
    expect(bar.marginPercent).toBeCloseTo(100 * (100 / 115), 6)
  })

  it("draws nothing for a refusal and says so", () => {
    const bar = budgetBar({
      budget: { input: 1000, reserved_output: 100 },
      byPlane: none,
      compressedByPlane: none,
      overhead: undefined,
      inputTokens: undefined,
    })
    expect(bar.segments).toEqual([])
    expect(bar.refused).toBe(true)
    expect(bar.used).toBeUndefined()
  })

  it("clamps and flags tokens over the budget", () => {
    const bar = budgetBar({
      budget: { input: 500, reserved_output: 0 },
      byPlane: planes,
      compressedByPlane: none,
      overhead: 0,
      inputTokens: 1000,
    })
    expect(bar.overBudget).toBe(true)
    expect(bar.segments.reduce((sum, s) => sum + s.percent, 0)).toBeCloseTo(100, 6)
    expect(bar.free).toBe(0)
  })

  it("survives a zero budget without dividing by it", () => {
    const bar = budgetBar({
      budget: { input: 0, reserved_output: 0 },
      byPlane: { ...none, gov: 5 },
      compressedByPlane: none,
      overhead: 0,
      inputTokens: 5,
    })
    for (const segment of bar.segments) expect(Number.isFinite(segment.percent)).toBe(true)
    expect(bar.overBudget).toBe(true)
  })

  it("never draws a non-finite or negative width", () => {
    const bar = budgetBar({
      budget: { input: 100, reserved_output: Number.NaN },
      byPlane: { ...none, gov: -5, state: Number.POSITIVE_INFINITY },
      compressedByPlane: none,
      overhead: 0,
      inputTokens: 10,
    })
    for (const segment of bar.segments) expect(segment.percent).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(bar.reservedPercent)).toBe(true)
  })
})
