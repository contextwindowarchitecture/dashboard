// The conflict forest (STYLE.md 6, Charts): an event's items as boxes in an outline, each excluded
// item under the item it lost to, was superseded by or duplicated, a group with no winner as a box
// of its own, each link labelled with its code. An image named by its title and its summary; the
// same links and groups are tables beside it (conflicts-view.tsx).

import { useId } from "react"

import type { ConflictForest } from "../../features/conflicts/model/conflicts"
import { COLUMN, conflictForestGeometry, ROW } from "./conflict-forest-geometry"

/** A node's box, and the room for a link's code between columns. */
const BOX = 190
const HEIGHT = ROW - 8
const PAD = 8
/** Characters a box shows of a label, in 12px mono; the tables beside hold every one whole. */
const SHOWN = 25

const shorten = (label: string) => (label.length > SHOWN ? `${label.slice(0, SHOWN - 1)}…` : label)

export function ConflictForestChart({
  forest,
  title,
  summary,
}: {
  readonly forest: ConflictForest
  readonly title: string
  readonly summary: string
}) {
  const id = useId()
  const geometry = conflictForestGeometry(forest.nodes, forest.edges)
  const width = geometry.width - (COLUMN - BOX) + 2 * PAD
  const height = geometry.height + 2 * PAD
  return (
    <figure data-slot="forest" aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`} data-label="">
        {title}
      </figcaption>
      <div
        role="img"
        aria-labelledby={`${id}-title ${id}-summary`}
        tabIndex={0}
        data-slot="scroll-region"
      >
        <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <g transform={`translate(${PAD},${PAD})`}>
            {geometry.links.map((link) => {
              const fromX = link.x1 + BOX
              const fromY = link.y1 + HEIGHT / 2
              const toY = link.y2 + HEIGHT / 2
              const elbow = fromX + 12
              return (
                <g key={`${link.child}-link`} data-code={link.code}>
                  <path
                    d={`M${fromX},${fromY} H${elbow} V${toY} H${link.x2}`}
                    data-slot="forest-link"
                  />
                  <text x={link.x2 - 6} y={toY - 5} textAnchor="end" data-slot="forest-code">
                    {link.code}
                  </text>
                </g>
              )
            })}
            {geometry.nodes.map((node) => (
              <g
                key={node.key}
                transform={`translate(${node.x},${node.y})`}
                data-status={node.status}
              >
                <title>{node.label}</title>
                <rect width={BOX} height={HEIGHT} data-slot="forest-node" />
                <text x={8} y={HEIGHT / 2} dominantBaseline="central" data-slot="forest-label">
                  {node.kind === "group" ? `group ${shorten(node.label)}` : shorten(node.label)}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
      <p id={`${id}-summary`} data-slot="chart-summary">
        {summary}
      </p>
    </figure>
  )
}
