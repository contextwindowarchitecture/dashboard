// The registry's view model (dashboard-plan.md 7.5): each route policy and profile the vendored
// registry holds, with the lock's digest and the events in the index that ran it, pinned or drifted
// (the same identity with other content, which a registry refuses: R-20); the identities events ran
// that the registry does not hold; the policy each profile binds (R-20); and whether a profile
// could be promoted (R-19). Read from the registry, its lock and the index's digests; the browser
// digests nothing.

import type { Profile, RoutePolicy } from "@cwa-dashboard/contract/types"
import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"

type Row = EventsIndexV1["events"][number]

/** schema/route_policy.schema.json's slot_rules, in its order; a test holds the two together. */
export const SLOT_RULE_FIELDS = [
  "min_relevance",
  "max_age_seconds",
  "required_scope",
  "source_prefix",
  "priority",
  "order_by",
  "min_included",
  "max_tokens",
  "min_tokens",
  "supersede",
  "dedupe",
  "max_per_source",
] as const

export interface Registry {
  readonly profiles: readonly Profile[]
  readonly route_policies: readonly RoutePolicy[]
  readonly lock: {
    readonly profiles: readonly { id: string; version: number; sha256: string }[]
    readonly route_policies: readonly { route: string; version: string; sha256: string }[]
  }
}

export interface Usage {
  readonly events: number
  /** Events whose digest is the lock's. */
  readonly pinned: number
  /** Events on the same identity with another digest. */
  readonly drifted: number
  readonly services: readonly string[]
}

export interface PolicyEntry {
  readonly route: string
  readonly version: string
  readonly sha256: string | undefined
  readonly policy: RoutePolicy
  readonly usage: Usage
}

export interface ProfileEntry {
  readonly id: string
  readonly version: number
  readonly sha256: string | undefined
  readonly profile: Profile
  readonly usage: Usage
  /** The registry's route policy for the profile's route and route_policy_version (R-20). */
  readonly binds: PolicyEntry | undefined
}

export interface Drift {
  readonly event_id: string
  readonly service: string
  readonly kind: "route_policy" | "profile"
  /** The identity, as "route version" or "id vN". */
  readonly identity: string
}

function usage(ran: readonly Row[], digest: (row: Row) => string | undefined, sha256?: string) {
  const pinned = ran.filter((row) => sha256 !== undefined && digest(row) === sha256).length
  return {
    events: ran.length,
    pinned,
    drifted: ran.length - pinned,
    services: [...new Set(ran.map((row) => row.service))].sort(),
  }
}

/** R-19: a concrete model family and an evaluation with a suite, date, result and artifact. */
export function promotable(profile: Profile): boolean {
  const evaluation = profile.evaluation as Record<string, unknown> | undefined
  return (
    typeof profile.model_family === "string" &&
    evaluation?.["status"] === "evaluated" &&
    ["suite", "date", "result", "artifact"].every(
      (field) => typeof evaluation[field] === "string" && evaluation[field] !== "",
    )
  )
}

export function registryModel(registry: Registry, rows: readonly Row[]) {
  const ranPolicy = (route: string, version: string) =>
    rows.filter((row) => row.route === route && row.route_policy_version === version)
  const ranProfile = (id: string, version: number) =>
    rows.filter((row) => row.profile?.id === id && row.profile.version === version)

  const policies: PolicyEntry[] = registry.route_policies.map((policy) => {
    const sha256 = registry.lock.route_policies.find(
      (e) => e.route === policy.route && e.version === policy.version,
    )?.sha256
    const ran = ranPolicy(policy.route, policy.version)
    return {
      route: policy.route,
      version: policy.version,
      sha256,
      policy,
      usage: usage(ran, (row) => row.route_policy_sha256, sha256),
    }
  })
  const profiles: ProfileEntry[] = registry.profiles.map((profile) => {
    const sha256 = registry.lock.profiles.find(
      (e) => e.id === profile.id && e.version === profile.version,
    )?.sha256
    return {
      id: profile.id,
      version: profile.version,
      sha256,
      profile,
      usage: usage(ranProfile(profile.id, profile.version), (row) => row.profile_sha256, sha256),
      binds: policies.find(
        (p) => p.route === profile.route && p.version === profile.route_policy_version,
      ),
    }
  })

  const drift: Drift[] = []
  for (const row of rows) {
    if (row.route === undefined || row.profile === undefined) continue
    const policy = policies.find(
      (p) => p.route === row.route && p.version === row.route_policy_version,
    )
    if (policy && policy.sha256 !== row.route_policy_sha256)
      drift.push({
        event_id: row.event_id,
        service: row.service,
        kind: "route_policy",
        identity: `${row.route} ${row.route_policy_version}`,
      })
    const profile = profiles.find(
      (p) => p.id === row.profile!.id && p.version === row.profile!.version,
    )
    if (profile && profile.sha256 !== row.profile_sha256)
      drift.push({
        event_id: row.event_id,
        service: row.service,
        kind: "profile",
        identity: `${row.profile.id} v${row.profile.version}`,
      })
  }

  const unregistered = <K extends string>(key: (row: Row) => K | undefined, held: Set<string>) => {
    const groups = new Map<K, Row[]>()
    for (const row of rows) {
      const k = key(row)
      if (k === undefined || held.has(k)) continue
      groups.set(k, [...(groups.get(k) ?? []), row])
    }
    return [...groups].sort(([a], [b]) => (a < b ? -1 : 1))
  }
  const SEP = "\u0000"
  const unregisteredPolicies = unregistered(
    (row) =>
      row.route === undefined ? undefined : `${row.route}${SEP}${row.route_policy_version}`,
    new Set(policies.map((p) => `${p.route}${SEP}${p.version}`)),
  ).map(([k, ran]) => {
    const [route, version] = k.split(SEP) as [string, string]
    const { events, services } = usage(ran, () => undefined)
    return { route, version, events, services }
  })
  const unregisteredProfiles = unregistered(
    (row) =>
      row.profile === undefined ? undefined : `${row.profile.id}${SEP}${row.profile.version}`,
    new Set(profiles.map((p) => `${p.id}${SEP}${p.version}`)),
  ).map(([k, ran]) => {
    const [id, version] = k.split(SEP) as [string, string]
    const { events, services } = usage(ran, () => undefined)
    return { id, version: Number(version), events, services }
  })

  return { policies, profiles, drift, unregisteredPolicies, unregisteredProfiles }
}

export type RegistryModel = ReturnType<typeof registryModel>
