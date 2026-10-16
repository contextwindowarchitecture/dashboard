import { describe, expect, it } from "vitest"

import { LATENCY_MARGIN as M, latencyGeometry } from "./latency-geometry"

const row = (name: string, p50: number, p95: number, p99: number, samples = 10) => ({
  name,
  latency: { samples, p50, p95, p99 },
})
const SIZE = { width: 600, rowHeight: 28 }

describe("latencyGeometry", () => {
  it("spaces equal ratios equally: a log axis", () => {
    const g = latencyGeometry([row("a", 0.1, 1, 10)], SIZE)
    const [p50, p95, p99] = g.rows[0]!.dots!
    expect(p95!.x - p50!.x).toBeCloseTo(p99!.x - p95!.x)
  })

  it("ticks whole decades that cover every value, inside the plot", () => {
    const g = latencyGeometry([row("a", 0.12, 0.47, 5.6), row("b", 0.03, 0.15, 0.15)], SIZE)
    expect(g.domain).toEqual([0.01, 10])
    expect(g.ticks.map((t) => t.value)).toEqual([0.01, 0.1, 1, 10])
    expect(g.ticks[0]!.x).toBeCloseTo(M.left)
    expect(g.ticks.at(-1)!.x).toBeCloseTo(SIZE.width - M.right)
  })

  it("gives each service a row with its sample count, in the order given", () => {
    const g = latencyGeometry([row("a", 1, 2, 3, 90), row("b", 1, 2, 3, 2)], SIZE)
    expect(g.rows.map((r) => [r.name, r.samples])).toEqual([
      ["a", 90],
      ["b", 2],
    ])
    expect(g.rows[1]!.y - g.rows[0]!.y).toBe(SIZE.rowHeight)
    expect(g.height).toBe(M.top + 2 * SIZE.rowHeight + M.bottom)
  })

  it("draws no dots for a service that measured nothing", () => {
    const g = latencyGeometry([row("a", 1, 2, 3), { name: "quiet", latency: undefined }], SIZE)
    expect(g.rows[1]).toMatchObject({ name: "quiet", samples: 0, dots: undefined })
  })

  it("puts a single value in the middle of one decade", () => {
    const g = latencyGeometry([row("a", 2, 2, 2, 1)], SIZE)
    expect(g.domain).toEqual([1, 10])
    for (const dot of g.rows[0]!.dots!) expect(dot.x).toBeGreaterThan(M.left)
  })

  it("clamps a value a log axis cannot place to the axis's start, and flags it", () => {
    const g = latencyGeometry([row("a", 0, 0.5, 2)], SIZE)
    const [p50] = g.rows[0]!.dots!
    expect(p50).toMatchObject({ value: 0, clamped: true })
    expect(p50!.x).toBeCloseTo(M.left)
    expect(g.rows[0]!.dots![1]!.clamped).toBe(false)
  })

  it("is finite with no services, or only unmeasured ones", () => {
    for (const rows of [[], [{ name: "q", latency: undefined }]]) {
      const g = latencyGeometry(rows, SIZE)
      expect(g.domain.every(Number.isFinite)).toBe(true)
      for (const t of g.ticks) expect(Number.isFinite(t.x)).toBe(true)
    }
  })
})
