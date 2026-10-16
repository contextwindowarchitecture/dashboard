// The inspector's model (dashboard-plan.md 2.2, 7.3): a trace carries no authority, trust, tier,
// freshness or body, so every view of an event joins the trace to its snapshot by item id. Candidates
// are raw until admission, so each field is read as unknown and narrowed. Nothing here decides
// anything the assembler decided; it lays its decisions beside what it was given.

import { SLOT_DEFAULTS } from "@cwa-dashboard/contract/data"
import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"

import {
  effectiveTier,
  type EffectiveTier,
  excludedRowStage,
  PIPELINE_ORDER,
  type RowStage,
} from "../../../lib/reasons"

type Snapshot = NonNullable<AssemblyEventV1["snapshot"]>
type Trace = NonNullable<AssemblyEventV1["trace"]>
type Raw = Record<string, unknown>
export type PlaneKey = "gov" | "state" | "evid" | "inter"

const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown) => (typeof value === "string" ? value : undefined)
const planeOf = (slot: string): PlaneKey | undefined =>
  (SLOT_DEFAULTS[slot as keyof typeof SLOT_DEFAULTS]?.plane as PlaneKey | undefined) ?? undefined

export interface Producer {
  readonly id: string
  readonly kind: string
}

/** A body as the event holds it (R-DASH-2): text, scrubbed text, a digest, or a raw value. */
export type Body =
  | { readonly form: "text"; readonly text: string }
  | {
      readonly form: "scrubbed"
      readonly text: string
      readonly content_sha256: string
      readonly token_counts: Record<string, number>
    }
  | {
      readonly form: "digest"
      readonly content_sha256: string
      readonly token_counts: Record<string, number>
    }
  | { readonly form: "raw"; readonly value: unknown }
  | { readonly form: "absent" }

export function bodyOf(value: unknown, present: boolean): Body {
  if (!present) return { form: "absent" }
  if (typeof value === "string") return { form: "text", text: value }
  if (
    isRecord(value) &&
    value["redacted"] === "digest_only" &&
    typeof value["content_sha256"] === "string"
  ) {
    return {
      form: "digest",
      content_sha256: value["content_sha256"],
      token_counts: (value["token_counts"] as Record<string, number>) ?? {},
    }
  }
  if (
    isRecord(value) &&
    value["redacted"] === "pii_scrubbed" &&
    typeof value["content_sha256"] === "string"
  ) {
    return {
      form: "scrubbed",
      text: text(value["text"]) ?? "",
      content_sha256: value["content_sha256"],
      token_counts: (value["token_counts"] as Record<string, number>) ?? {},
    }
  }
  return { form: "raw", value }
}

/** A policy field's value: the item's own, or the default the assembler filled (R-3). */
export interface FieldValue {
  readonly value: string
  readonly defaulted: boolean
}

interface Candidate {
  readonly item: Raw
  readonly producer: Producer
}

// Every candidate by id, first come; and the producers by id, for rows that name no candidate.
function candidates(snapshot: Snapshot | Raw | undefined) {
  const byId = new Map<string, Candidate>()
  const reported = new Map<string, Producer>()
  const producers = new Map<string, Producer>()
  const batches =
    isRecord(snapshot) && Array.isArray(snapshot["batches"]) ? snapshot["batches"] : []
  for (const batch of batches) {
    if (!isRecord(batch) || !isRecord(batch["producer"])) continue
    const producer = {
      id: String(batch["producer"]["id"]),
      kind: String(batch["producer"]["kind"]),
    }
    producers.set(producer.id, producer)
    for (const item of Array.isArray(batch["items"]) ? batch["items"] : []) {
      if (isRecord(item) && typeof item["id"] === "string" && !byId.has(item["id"]))
        byId.set(item["id"], { item, producer })
    }
    for (const row of Array.isArray(batch["excluded"]) ? batch["excluded"] : []) {
      if (isRecord(row) && typeof row["item_id"] === "string")
        reported.set(row["item_id"], producer)
    }
  }
  // A candidate whose id is blank is recorded as "{producer}#invalid-{n}" (conformance/README.md).
  const producerOf = (itemId: string): Producer | undefined =>
    byId.get(itemId)?.producer ??
    reported.get(itemId) ??
    producers.get(
      itemId.includes("#invalid-") ? itemId.slice(0, itemId.lastIndexOf("#invalid-")) : "",
    )
  return { byId, producerOf }
}

export interface ItemRow {
  /** The occurrence's place in included[], placement order. */
  readonly index: number
  readonly item_id: string
  readonly slot: string
  readonly plane: PlaneKey | undefined
  readonly tokens: number
  readonly eligibility: string | undefined
  readonly producer: Producer
  readonly authority: string | undefined
  readonly trust: string | undefined
  readonly tier: EffectiveTier | undefined
  readonly lineage: FieldValue | undefined
  readonly injection_risk: FieldValue | undefined
  readonly freshness: string | undefined
  readonly expires: string | undefined
  readonly source: string | undefined
  readonly source_version: string | undefined
  readonly relevance: number | undefined
  readonly scope: Raw | undefined
  readonly compressed:
    { from: number; to: number; method: string; variant_id: string | undefined } | undefined
  readonly body: Body
}

/** The policy fields R-3 fills from defaults that the inspector shows. */
type PolicyField = "lineage" | "injection_risk"

/** Every included occurrence, in placement order, joined to its candidate (R-DASH-1). */
export function joinItems(event: AssemblyEventV1): ItemRow[] {
  const { snapshot, trace } = event
  if (!snapshot || !trace) return []
  const { byId, producerOf } = candidates(snapshot)
  const filled = new Set(trace.defaults_filled.map((row) => `${row.item_id}\u0000${row.field}`))
  // compressed[] has one row per included occurrence of a compressed item, in included[] order.
  const pending = new Map<string, Trace["compressed"][number][]>()
  for (const row of trace.compressed)
    pending.set(`${row.slot}\u0000${row.item_id}`, [
      ...(pending.get(`${row.slot}\u0000${row.item_id}`) ?? []),
      row,
    ])
  const overrides = (snapshot.route_policy as unknown as Raw)["default_overrides"] as
    Record<string, Raw> | undefined

  return trace.included.map((occurrence, index) => {
    const candidate = byId.get(occurrence.item_id)
    const item = candidate?.item ?? {}
    const field = (name: PolicyField): FieldValue | undefined => {
      const own = text(item[name])
      if (own !== undefined) return { value: own, defaulted: false }
      if (!filled.has(`${occurrence.item_id}\u0000${name}`)) return undefined
      const fallback =
        text(overrides?.[occurrence.slot]?.[name]) ??
        text(SLOT_DEFAULTS[occurrence.slot as keyof typeof SLOT_DEFAULTS]?.[name])
      return fallback === undefined ? undefined : { value: fallback, defaulted: true }
    }
    const compressedRows = pending.get(`${occurrence.slot}\u0000${occurrence.item_id}`)
    const compressed = compressedRows?.shift()
    return {
      index,
      item_id: occurrence.item_id,
      slot: occurrence.slot,
      plane: planeOf(occurrence.slot),
      tokens: occurrence.tokens,
      eligibility: occurrence.eligibility,
      producer: candidate?.producer ??
        producerOf(occurrence.item_id) ?? { id: "unknown", kind: "unknown" },
      authority: text(item["authority"]),
      trust: text(item["trust"]),
      tier: effectiveTier(
        { slot: item["slot"] ?? occurrence.slot, tier: text(item["tier"]) as never },
        snapshot.route_policy,
      ),
      lineage: field("lineage"),
      injection_risk: field("injection_risk"),
      freshness: text(item["freshness"]),
      expires: text(item["expires"]),
      source: text(item["source"]),
      source_version: text(item["source_version"]) ?? occurrence.source_version,
      relevance: typeof item["relevance"] === "number" ? item["relevance"] : undefined,
      scope: isRecord(item["scope"]) ? item["scope"] : undefined,
      compressed: compressed
        ? {
            from: compressed.from,
            to: compressed.to,
            method: compressed.method,
            variant_id: compressed.variant_id,
          }
        : undefined,
      body: bodyOf(item["body"], "body" in item),
    }
  })
}

export interface PlaneTotals {
  readonly byPlane: Record<PlaneKey, number>
  /** Of each plane's tokens, those of occurrences stepped down to a variant (compressed[].to). */
  readonly compressedByPlane: Record<PlaneKey, number>
  /** The payload's tokens beyond its items': wrappers and separators. Absent with no payload. */
  readonly overhead: number | undefined
  /** The items' tokens exceeded the payload's, which would be the assembler's inconsistency. */
  readonly overheadNegative: boolean
}

export function planeTotals(trace: Trace): PlaneTotals {
  const byPlane: Record<PlaneKey, number> = { gov: 0, state: 0, evid: 0, inter: 0 }
  for (const row of trace.included) {
    const plane = planeOf(row.slot)
    if (plane) byPlane[plane] += row.tokens
  }
  const compressedByPlane: Record<PlaneKey, number> = { gov: 0, state: 0, evid: 0, inter: 0 }
  for (const row of trace.compressed) {
    const plane = planeOf(row.slot)
    if (plane) compressedByPlane[plane] += row.to
  }
  const sum = Object.values(byPlane).reduce((a, b) => a + b, 0)
  if (!trace.result)
    return { byPlane, compressedByPlane, overhead: undefined, overheadNegative: false }
  const gap = trace.result.input_tokens - sum
  return { byPlane, compressedByPlane, overhead: Math.max(0, gap), overheadNegative: gap < 0 }
}

export interface Placement {
  readonly slot: string
  readonly wrap: string
  readonly plane: PlaneKey | undefined
  readonly occurrences: Trace["included"]
}

/**
 * The profile's placements in order, each with the occurrences it holds. included[] follows
 * placement order, and every placement of a slot renders the slot's included items, so a run of k
 * adjacent placements of one slot holds k equal runs of rows. A slot placed twice apart holds its own
 * run each time. Unplaced: the slots the trace excluded items from as slot_unplaced.
 */
export function placementRows(event: AssemblyEventV1): { placed: Placement[]; unplaced: string[] } {
  const placement = event.snapshot?.profile.placement ?? []
  const rows = event.trace?.included ?? []
  const placed: Placement[] = []
  let next = 0
  for (let p = 0; p < placement.length;) {
    const slot = placement[p]!.slot
    let k = 1
    while (placement[p + k]?.slot === slot) k += 1
    let run = 0
    while (rows[next + run]?.slot === slot) run += 1
    const share = run / k
    for (let i = 0; i < k; i += 1) {
      placed.push({
        slot,
        wrap: placement[p + i]!.wrap,
        plane: planeOf(slot),
        occurrences: rows.slice(next + i * share, next + (i + 1) * share),
      })
    }
    next += run
    p += k
  }
  const unplaced = [
    ...new Set(
      (event.trace?.excluded ?? [])
        .filter((row) => row.reason === "slot_unplaced")
        .flatMap((row) => (row.slot ? [row.slot] : [])),
    ),
  ].sort()
  return { placed, unplaced }
}

export interface ExcludedRow {
  readonly item_id: string
  readonly reason: string
  readonly stage: "producer" | "assembler"
  readonly slot: string | undefined
  readonly duplicate_of: string | undefined
  readonly superseded_by: string | undefined
  readonly producer: Producer | undefined
  readonly tier: EffectiveTier | undefined
}

export interface StageGroup {
  readonly stage: RowStage | "unknown"
  readonly rows: ExcludedRow[]
}

/** The trace's excluded rows by pipeline stage, in the order conformance/README.md fixes. */
export function excludedByStage(event: AssemblyEventV1): StageGroup[] {
  const snapshot = event.snapshot ?? (event.rejection?.snapshot as Raw | undefined)
  const { byId, producerOf } = candidates(snapshot)
  const groups = new Map<RowStage | "unknown", ExcludedRow[]>()
  for (const row of event.trace?.excluded ?? []) {
    const stage = excludedRowStage(row) ?? "unknown"
    const item = byId.get(row.item_id)?.item
    const list = groups.get(stage) ?? []
    list.push({
      item_id: row.item_id,
      reason: row.reason,
      stage: row.stage,
      slot: row.slot,
      duplicate_of: row.duplicate_of,
      superseded_by: row.superseded_by,
      producer: producerOf(row.item_id),
      tier:
        item && event.snapshot
          ? effectiveTier(
              { slot: item["slot"], tier: text(item["tier"]) as never },
              event.snapshot.route_policy,
            )
          : undefined,
    })
    groups.set(stage, list)
  }
  return [...PIPELINE_ORDER, "unknown" as const].flatMap((stage) =>
    groups.has(stage) ? [{ stage, rows: groups.get(stage)! }] : [],
  )
}

export interface ConflictCard {
  readonly group_id: string
  readonly kind: string
  readonly members: { readonly id: string; readonly producer: Producer | undefined }[]
  readonly resolution: string
  readonly decided_by: string
  readonly winner: string | undefined
  /** For a fact group: the fact, and the route's precedence for it. */
  readonly fact: string | undefined
  readonly precedence: readonly string[] | undefined
  /** For an instruction group: what the route does when it has no unique supported resolution. */
  readonly onUnresolved: string | undefined
}

/** The trace's conflict groups, each with the route's rule that applied to it (R-11). */
export function conflictCards(event: AssemblyEventV1): ConflictCard[] {
  const snapshot = event.snapshot
  const { producerOf } = candidates(snapshot)
  const declared = new Map(
    (snapshot?.conflicts ?? []).map((group) => [group.id, group as unknown as Raw]),
  )
  const policy = (snapshot?.route_policy ?? {}) as unknown as Raw
  const facts = (isRecord(policy["facts"]) ? policy["facts"] : {}) as Record<string, Raw>
  return (event.trace?.conflicts ?? []).map((conflict) => {
    const fact = text(declared.get(conflict.group_id)?.["fact"])
    const precedence =
      fact && Array.isArray(facts[fact]?.["precedence"])
        ? (facts[fact]!["precedence"] as string[])
        : undefined
    return {
      group_id: conflict.group_id,
      kind: conflict.kind,
      members: conflict.items.map((id) => ({ id, producer: producerOf(id) })),
      resolution: conflict.resolution,
      decided_by: conflict.decided_by,
      winner: conflict.winner,
      fact,
      precedence,
      onUnresolved:
        conflict.kind === "instruction"
          ? (text(policy["on_unresolved_instruction"]) ?? "refuse")
          : undefined,
    }
  })
}
