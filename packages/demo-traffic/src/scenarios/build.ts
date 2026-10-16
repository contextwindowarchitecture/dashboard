// Building blocks for the authored scenarios: snapshots written the way an application's producers
// would hand them to an assembler. Each item helper fills the eight fields every item must carry
// (contract/model.json, item_fields.must) and what its slot requires, and leaves the policy fields
// to their slot defaults, so the trace's defaults_filled shows the assembler filling them (R-3).
// Nothing here decides what is admitted, excluded or refused: the assembler does, when the
// generator runs it.

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { Profile, RoutePolicy, Snapshot } from "@cwa-dashboard/contract/types"
import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"

export type Item = Record<string, unknown>
export type Batch = Snapshot["batches"][number]

export interface ScenarioTurn {
  /** The snapshot this turn's call assembles. */
  readonly snapshot: Snapshot
  /** What the scenario was written to show; the tests hold the assembler's trace to it. */
  readonly expect: {
    readonly outcome: AssemblyEventV1["outcome"]
    /** The refusal's code, when the turn refuses. */
    readonly refused?: string
    /** Codes the trace's excluded rows must include. */
    readonly excluded?: readonly string[]
    /** The least number of compressed rows the trace must have. */
    readonly compressed?: number
    /** Item ids the trace must include. */
    readonly included?: readonly string[]
  }
}

export interface Scenario {
  readonly id: string
  /** One sentence: what the scenario shows. */
  readonly title: string
  readonly service: string
  /** Set for a conversation of several turns. */
  readonly session?: string
  readonly redaction: {
    readonly mode: AssemblyEventV1["redaction_mode"]
    readonly scrub?: readonly string[]
  }
  readonly turns: readonly ScenarioTurn[]
}

// --- registry ------------------------------------------------------------------------------------

/** A published profile and the route policy it binds, exactly as the registry holds them. */
export function fromRegistry(profileId: string): { profile: Profile; route_policy: RoutePolicy } {
  const profile = REGISTRY.profiles.find((candidate) => candidate.id === profileId)
  if (!profile) throw new Error(`no registry profile ${profileId}`)
  const route_policy = REGISTRY.route_policies.find(
    (policy) => policy.route === profile.route && policy.version === profile.route_policy_version,
  )
  if (!route_policy) throw new Error(`no registry route policy for ${profileId}`)
  return { profile: structuredClone(profile), route_policy: structuredClone(route_policy) }
}

// --- snapshots -----------------------------------------------------------------------------------

export function snapshot(fields: {
  assembly_time: string
  scope: Snapshot["scope"]
  budget: Snapshot["budget"]
  profile: Profile
  route_policy: RoutePolicy
  tokenizer: string
  renderer: string
  batches: Batch[]
  conflicts?: Snapshot["conflicts"]
  capabilities?: Snapshot["capabilities"]
}): Snapshot {
  return {
    assembly_time: fields.assembly_time,
    scope: fields.scope,
    budget: fields.budget,
    profile: fields.profile,
    route_policy: fields.route_policy,
    tokenizer: fields.tokenizer,
    renderer: fields.renderer,
    batches: fields.batches,
    conflicts: fields.conflicts ?? [],
    ...(fields.capabilities === undefined ? {} : { capabilities: fields.capabilities }),
  } as Snapshot
}

export function batch(id: string, kind: string, items: Item[], excluded: unknown[] = []): Batch {
  return { producer: { id, kind }, items, excluded } as unknown as Batch
}

// --- items, by slot ------------------------------------------------------------------------------

interface Common {
  readonly source?: string
  readonly source_version?: string
  readonly freshness: string
  readonly extra?: Item
}

function item(
  id: string,
  slot: string,
  authority: string,
  trust: string,
  body: string,
  common: Common,
): Item {
  return {
    id,
    slot,
    source: common.source ?? id,
    source_version: common.source_version ?? "1",
    authority,
    trust,
    freshness: common.freshness,
    body,
    ...common.extra,
  }
}

export const instruction = (id: string, body: string, common: Common) =>
  item(id, "governance.instructions", "governing", "verified", body, common)
export const capability = (id: string, body: string, common: Common) =>
  item(id, "governance.capabilities", "governing", "verified", body, common)
export const example = (id: string, body: string, common: Common) =>
  item(id, "governance.examples", "governing", "verified", body, common)
export const outputContract = (id: string, body: string, common: Common) =>
  item(id, "governance.output_contract", "governing", "verified", body, common)
export const userState = (id: string, body: string, common: Common) =>
  item(id, "state.user", "state", "verified", body, common)
export const taskState = (id: string, body: string, common: Common) =>
  item(id, "state.task", "state", "verified", body, common)
export const knowledge = (id: string, body: string, relevance: number, common: Common) =>
  item(id, "evidence.knowledge", "reference_only", "verified", body, {
    ...common,
    extra: { relevance, ...common.extra },
  })
export const toolResult = (id: string, body: string, common: Common) =>
  item(id, "evidence.tool_results", "observation", "unverified", body, common)
export const memory = (id: string, body: string, expires: string, common: Common) =>
  item(id, "interaction.memory", "generated", "unverified", body, {
    ...common,
    extra: { expires, ...common.extra },
  })
/** A prior turn: the user's own, or the model's, which history carries as untrusted (R-1). */
export const turn = (id: string, body: string, said: "user" | "model", common: Common) =>
  said === "user"
    ? item(id, "interaction.history", "user", "unverified", body, {
        ...common,
        extra: { lineage: "verbatim", ...common.extra },
      })
    : item(id, "interaction.history", "untrusted", "unverified", body, {
        ...common,
        extra: { lineage: "generated", ...common.extra },
      })
export const query = (id: string, body: string, common: Common) =>
  item(id, "interaction.query", "user", "unverified", body, common)

// --- routes of a deployment's own ----------------------------------------------------------------

/**
 * A draft profile of a deployment's own, not in the published registry: unevaluated, for no model
 * family yet (R-19), binding the route policy version it names (R-20).
 */
export function draftProfile(
  id: string,
  route: string,
  routePolicyVersion: string,
  placement: { slot: string; wrap: string }[],
): Profile {
  return {
    spec: "cwa/draft",
    id,
    version: 1,
    route,
    model_family: null,
    route_policy_version: routePolicyVersion,
    placement,
    evaluation: { status: "unevaluated", suite: null, date: null, result: null, artifact: null },
  } as unknown as Profile
}
