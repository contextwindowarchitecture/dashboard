import { describe, expect, it } from "vitest"

import type { ForestEdge, ForestNode } from "../../features/conflicts/model/conflicts"
import { COLUMN, conflictForestGeometry, ROW } from "./conflict-forest-geometry"

const item = (id: string, status: ForestNode["status"] = "kept"): ForestNode => ({
  key: `item:${id}`,
  kind: "item",
  label: id,
  status,
})
const edge = (child: string, parent: string, code: string): ForestEdge => ({
  child: `item:${child}`,
  parent: `item:${parent}`,
  code,
})

describe("conflictForestGeometry", () => {
  it("draws nothing for an empty forest", () => {
    expect(conflictForestGeometry([], [])).toEqual({ width: 0, height: 0, nodes: [], links: [] })
  })

  it("puts a single node at the first column, first row", () => {
    const geometry = conflictForestGeometry([item("a")], [])
    expect(geometry.nodes).toEqual([
      expect.objectContaining({ key: "item:a", depth: 0, x: 0, y: 0 }),
    ])
    expect(geometry.links).toEqual([])
    expect(geometry).toMatchObject({ width: COLUMN, height: ROW })
  })

  it("steps a chain one column per link, the link from child to parent, labelled", () => {
    const geometry = conflictForestGeometry(
      [item("kb:a"), item("wiki:refund", "excluded"), item("wiki:paraphrase", "excluded")],
      [
        edge("wiki:refund", "kb:a", "duplicate_content"),
        edge("wiki:paraphrase", "wiki:refund", "duplicate_content"),
      ],
    )
    const depth = Object.fromEntries(geometry.nodes.map((n) => [n.key, n.depth]))
    expect(depth).toEqual({ "item:kb:a": 0, "item:wiki:refund": 1, "item:wiki:paraphrase": 2 })
    for (const node of geometry.nodes) expect(node.x).toBe(node.depth * COLUMN)
    expect(geometry.links).toHaveLength(2)
    const link = geometry.links.find((l) => l.child === "item:wiki:refund")!
    expect(link).toMatchObject({ parent: "item:kb:a", code: "duplicate_content" })
    expect([link.x1, link.x2]).toEqual([0, COLUMN])
    expect(geometry.width).toBe(3 * COLUMN)
  })

  it("stacks several trees, one row per leaf, none overlapping", () => {
    const geometry = conflictForestGeometry(
      [item("w"), item("l1", "excluded"), item("l2", "excluded"), item("lone")],
      [edge("l1", "w", "conflict_lost"), edge("l2", "w", "conflict_lost")],
    )
    const ys = geometry.nodes.map((n) => `${n.x},${n.y}`)
    expect(new Set(ys).size).toBe(ys.length)
    for (const node of geometry.nodes) expect(node.y % ROW).toBe(0)
    expect(Math.min(...geometry.nodes.map((n) => n.y))).toBe(0)
    expect(geometry.height).toBe(3 * ROW)
    const at = Object.fromEntries(geometry.nodes.map((n) => [n.key, n.y]))
    expect(at["item:w"]).toBe(at["item:l1"])
  })

  it("refuses links that loop", () => {
    expect(() =>
      conflictForestGeometry([item("a"), item("b")], [edge("a", "b", "x"), edge("b", "a", "x")]),
    ).toThrow(/cycle/)
  })
})
