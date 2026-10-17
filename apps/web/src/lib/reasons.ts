// The one place a reason code becomes words (AGENTS.md, "Never invent vocabulary"). Every code,
// rule and text comes from the vendored contract/reasons.json; a code outside it has no entry, no
// stage and no label.

import { REASONS, SLOT_DEFAULTS, type ReasonCode, type SlotId } from "@cwa-dashboard/contract/data"
import type { ContextItem, RoutePolicy } from "@cwa-dashboard/contract/types"

export type ReasonKind = (typeof REASONS)[number]["kind"]

export interface ReasonInfo {
  /** The code as the trace writes it, `missing_field:relevance` say. */
  readonly code: string
  /** The registry's code it is an instance of, `missing_field:<name>` say. */
  readonly registered: ReasonCode
  readonly kind: ReasonKind
  readonly rule: string
  readonly text: string
  /** For `missing_field:<name>`, the field the trace names. */
  readonly field?: string
}

const MISSING_FIELD = "missing_field:"
const BY_CODE = new Map<string, (typeof REASONS)[number]>(
  REASONS.map((reason) => [reason.code, reason]),
)

/** The registry's entry for a code as a trace writes it, or undefined for a code outside it. */
export function reasonInfo(code: string): ReasonInfo | undefined {
  if (code.startsWith(MISSING_FIELD)) {
    const field = code.slice(MISSING_FIELD.length)
    const reason = BY_CODE.get(`${MISSING_FIELD}<name>`)
    if (field.length === 0 || reason === undefined) return undefined
    const { kind, rule, text } = reason
    return { code, registered: reason.code, kind, rule, text, field }
  }
  const reason = BY_CODE.get(code)
  if (reason === undefined) return undefined
  const { kind, rule, text } = reason
  return { code, registered: reason.code, kind, rule, text }
}

// --- stages --------------------------------------------------------------------------------------

/**
 * The stages an excluded row can come from, in the order a trace lists them (conformance/README.md,
 * Array order): the producers' own rows, then the assembler's admission, conflict, supersession,
 * deduplication, source-diversity and fitting rows. A refusal is the assembly's outcome, not a row.
 */
export const PIPELINE_ORDER = [
  "producer",
  "admission",
  "conflict",
  "supersession",
  "dedupe",
  "diversity",
  "fitting",
] as const
export type RowStage = (typeof PIPELINE_ORDER)[number]
export type PipelineStage = RowStage | "refusal"

// reasons.json lists the exclusion codes in pipeline order (R-21). The resolving stages are the
// codes of the requirements that define them; every exclusion before the first is admission, and
// every one after the last is fitting.
const RESOLVING_RULES: Readonly<Record<string, PipelineStage>> = {
  "R-11": "conflict",
  "R-25": "supersession",
  "R-24": "dedupe",
  "R-26": "diversity",
}
/** The resolving stage a requirement defines (R-11 conflict, R-25 supersession, ...), if any. */
export const ruleStage = (rule: string): PipelineStage | undefined => RESOLVING_RULES[rule]

const STAGE_BY_CODE: ReadonlyMap<string, PipelineStage> = (() => {
  const stages = new Map<string, PipelineStage>()
  let current: PipelineStage = "admission"
  for (const reason of REASONS) {
    if (reason.kind === "refusal") {
      stages.set(reason.code, "refusal")
      continue
    }
    const resolving = RESOLVING_RULES[reason.rule]
    if (resolving !== undefined) current = resolving
    else if (current !== "admission") current = "fitting"
    stages.set(reason.code, current)
  }
  return stages
})()

/** The pipeline stage a code belongs to, or undefined for a code outside the registry. */
export function pipelineStage(code: string): PipelineStage | undefined {
  const registered = reasonInfo(code)?.registered
  return registered === undefined ? undefined : STAGE_BY_CODE.get(registered)
}

/**
 * The stage of a trace's excluded row: a producer's row stays the producer's, whatever its code.
 * Undefined for a code outside the registry, and for a refusal code, which is never a row.
 */
export function excludedRowStage(row: {
  readonly reason: string
  readonly stage: "producer" | "assembler"
}): RowStage | undefined {
  if (row.stage === "producer") return "producer"
  const stage = pipelineStage(row.reason)
  return stage === "refusal" ? undefined : stage
}

// --- tiers ---------------------------------------------------------------------------------------

export type Tier = NonNullable<ContextItem["tier"]>

/** Highest first, as context_item.schema.json lists them and R-16 sheds them in reverse. */
const TIER_ORDER: readonly Tier[] = ["protected", "compressible", "droppable"]

export interface EffectiveTier {
  readonly tier: Tier
  /** Where the tier came from: the item's own `tier`, the slot default, or the route's `tier_upgrades`. */
  readonly source: "item" | "slot-default" | "route"
}

const isSlot = (slot: unknown): slot is SlotId =>
  typeof slot === "string" && Object.hasOwn(SLOT_DEFAULTS, slot)

/**
 * An item's effective tier (R-16): its own `tier` when it sets one, otherwise its slot's default
 * raised by the route's `tier_upgrades`, never lowered by them. Undefined when the item names no
 * slot of the eleven.
 */
export function effectiveTier(
  item: { readonly slot: unknown; readonly tier?: Tier | null },
  policy: Pick<RoutePolicy, "tier_upgrades">,
): EffectiveTier | undefined {
  if (!isSlot(item.slot)) return undefined
  if (item.tier) return { tier: item.tier, source: "item" }
  const fallback = SLOT_DEFAULTS[item.slot].tier
  const upgrade = policy.tier_upgrades?.[item.slot]
  if (upgrade !== undefined && TIER_ORDER.indexOf(upgrade) < TIER_ORDER.indexOf(fallback)) {
    return { tier: upgrade, source: "route" }
  }
  return { tier: fallback, source: "slot-default" }
}
