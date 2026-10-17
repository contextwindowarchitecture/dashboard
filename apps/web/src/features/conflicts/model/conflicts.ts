// The conflicts (dashboard-plan.md DP-10): which events of the window resolved one item against
// another, and, for one event, how: a forest in which every excluded item hangs under the item it
// lost a conflict to, was superseded by or duplicated, and a conflict group with no winner is a root
// of its own with its members under it. Every edge is a reason code or a group's resolution as the
// trace wrote it; nothing is recomputed that the trace does not say.

import { REASONS } from "@cwa-dashboard/contract/data"
import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"

import { ruleStage } from "../../../lib/reasons"
import {
  conflictCards,
  type ConflictCard,
  excludedByStage,
  joinItems,
  type Producer,
} from "../../traces/model/inspector"

/** The registry's codes of the requirements that resolve one item against another. */
export const RESOLVING_CODES: readonly string[] = REASONS.filter((reason) =>
  ["conflict", "supersession", "dedupe"].includes(ruleStage(reason.rule) ?? ""),
).map((reason) => reason.code)

type Row = EventsIndexV1["events"][number]
const codesOf = (row: Row) => [
  ...row.reason_codes,
  ...(row.refused_reason ? [row.refused_reason] : []),
]

/** The window's events with a resolving code, newest first, and each code's count of events. */
export function conflictEvents(index: EventsIndexV1) {
  const rows = index.events.filter((row) => codesOf(row).some((c) => RESOLVING_CODES.includes(c)))
  const counts = RESOLVING_CODES.map((code) => ({
    code,
    events: rows.filter((row) => codesOf(row).includes(code)).length,
  })).filter((count) => count.events > 0)
  return { rows, counts }
}

export interface ForestNode {
  /** `item:<id>` or `group:<group_id>`, so an item and a group can never share a key. */
  readonly key: string
  readonly kind: "item" | "group"
  /** The item's id or the group's id, as the trace writes it. */
  readonly label: string
  readonly status: "kept" | "excluded" | "not in the trace" | "group"
  readonly producer?: Producer
}

export interface ForestEdge {
  readonly child: string
  readonly parent: string
  /** The excluded row's reason, or the winnerless group's resolution. */
  readonly code: string
}

export interface ConflictForest {
  readonly nodes: readonly ForestNode[]
  readonly edges: readonly ForestEdge[]
  readonly groups: readonly ConflictCard[]
  /** Whether the links loop, which a conformant trace never does; then no tree can be drawn. */
  readonly cycle: boolean
}

export function conflictForest(event: AssemblyEventV1): ConflictForest {
  const kept = new Map(joinItems(event).map((row) => [row.item_id, row.producer]))
  const excluded = new Map(
    excludedByStage(event)
      .flatMap((group) => group.rows)
      .map((row) => [row.item_id, row]),
  )
  const groups = conflictCards(event)
  const parentOf = new Map<string, { parent: string; code: string }>()

  // Groups first; an excluded row's own link, which names the item's fate, then takes precedence.
  for (const group of groups) {
    for (const member of group.members) {
      if (member.id === group.winner) continue
      const parent = group.winner === undefined ? `group:${group.group_id}` : `item:${group.winner}`
      const code = excluded.get(member.id)?.reason ?? group.resolution
      parentOf.set(`item:${member.id}`, { parent, code })
    }
  }
  for (const row of excluded.values()) {
    const target = row.superseded_by ?? row.duplicate_of
    if (target !== undefined)
      parentOf.set(`item:${row.item_id}`, { parent: `item:${target}`, code: row.reason })
  }

  const nodes = new Map<string, ForestNode>()
  const addItem = (id: string) => {
    const key = `item:${id}`
    if (nodes.has(key)) return
    const producer = kept.get(id) ?? excluded.get(id)?.producer
    const status = kept.has(id) ? "kept" : excluded.has(id) ? "excluded" : "not in the trace"
    nodes.set(key, { key, kind: "item", label: id, status, ...(producer ? { producer } : {}) })
  }
  for (const group of groups) {
    if (group.winner === undefined) {
      const key = `group:${group.group_id}`
      nodes.set(key, { key, kind: "group", label: group.group_id, status: "group" })
    } else addItem(group.winner)
    for (const member of group.members) addItem(member.id)
  }
  for (const [child, { parent }] of parentOf) {
    addItem(child.slice("item:".length))
    if (parent.startsWith("item:")) addItem(parent.slice("item:".length))
  }

  const edges = [...parentOf].map(([child, { parent, code }]) => ({ child, parent, code }))
  // A loop would make some node its own ancestor.
  const cycle = edges.some(({ child }) => {
    const seen = new Set<string>()
    for (let at: string | undefined = child; at !== undefined; at = parentOf.get(at)?.parent) {
      if (seen.has(at)) return true
      seen.add(at)
    }
    return false
  })
  return { nodes: [...nodes.values()], edges, groups, cycle }
}
