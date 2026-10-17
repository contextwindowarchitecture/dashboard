// The conflict forest's geometry (STYLE.md 6, Charts; ADR-0002): d3-hierarchy's stratify builds the
// trees from the model's links, through one hidden root above the forest's roots, and refuses links
// that loop. The layout is an outline: each leaf a row of its own, a parent level with its first
// child, each generation a column further right, so every label reads on its own line.

import { stratify, type HierarchyNode } from "d3-hierarchy"

import type { ForestEdge, ForestNode } from "../../features/conflicts/model/conflicts"

/** A row's height and a column's width, in px: a node's box and, between columns, room for a code. */
export const ROW = 36
export const COLUMN = 340

const ROOT = "\u0000root"

export interface PlacedNode extends ForestNode {
  /** Links between this node and its forest root. */
  readonly depth: number
  readonly x: number
  readonly y: number
}

export interface PlacedLink extends ForestEdge {
  /** From the parent's position to the child's. */
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

export interface ForestGeometry {
  readonly width: number
  readonly height: number
  readonly nodes: readonly PlacedNode[]
  readonly links: readonly PlacedLink[]
}

type Datum = { readonly key: string; readonly parent: string; readonly node?: ForestNode }

export function conflictForestGeometry(
  nodes: readonly ForestNode[],
  edges: readonly ForestEdge[],
): ForestGeometry {
  if (nodes.length === 0) return { width: 0, height: 0, nodes: [], links: [] }
  const parentOf = new Map(edges.map((edge) => [edge.child, edge]))
  const data: Datum[] = [
    { key: ROOT, parent: "" },
    ...nodes.map((node) => ({
      key: node.key,
      parent: parentOf.get(node.key)?.parent ?? ROOT,
      node,
    })),
  ]
  const root: HierarchyNode<Datum> = stratify<Datum>()
    .id((d) => d.key)
    .parentId((d) => (d.key === ROOT ? null : d.parent))(data)

  // Leaves take a row each, in pre-order; a parent sits on its first child's row.
  const row = new Map<string, number>()
  let next = 0
  root.eachBefore((d) => {
    if (d.data.key !== ROOT && d.children === undefined) row.set(d.data.key, next++)
  })
  root.eachAfter((d) => {
    if (d.data.key !== ROOT && d.children !== undefined)
      row.set(d.data.key, row.get(d.children[0]!.data.key)!)
  })

  const placed = new Map<string, PlacedNode>()
  root.eachBefore((d) => {
    if (d.data.key === ROOT) return
    const depth = d.depth - 1
    placed.set(d.data.key, {
      ...d.data.node!,
      depth,
      x: depth * COLUMN,
      y: row.get(d.data.key)! * ROW,
    })
  })
  const links = edges.map((edge) => {
    const parent = placed.get(edge.parent)!
    const child = placed.get(edge.child)!
    return { ...edge, x1: parent.x, y1: parent.y, x2: child.x, y2: child.y }
  })
  const deepest = Math.max(...[...placed.values()].map((n) => n.depth))
  return { width: (deepest + 1) * COLUMN, height: next * ROW, nodes: [...placed.values()], links }
}
