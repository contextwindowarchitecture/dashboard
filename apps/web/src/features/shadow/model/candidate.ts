// The candidate a shadow run swaps into each snapshot (ADR-0008): an object holding a route policy, a
// profile, or both, as the contract writes them. The page reads only its shape; whether the assembler
// accepts it is the replay's to say, and the report counts the rejections.

import { REGISTRY } from "@cwa-dashboard/contract/registry"

export interface Candidate {
  readonly route_policy?: object
  readonly profile?: object
}

export type Parsed =
  | { readonly ok: true; readonly candidate: Candidate }
  | { readonly ok: false; readonly message: string }

const KEYS = new Set(["route_policy", "profile"])
const isObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const SHAPE = "The candidate must hold a route_policy, a profile, or both, each an object."

export function parseCandidate(text: string): Parsed {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      message: `The candidate is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (!isObject(value)) return { ok: false, message: SHAPE }
  const record = value as Record<string, unknown>
  const other = Object.keys(record).filter((key) => !KEYS.has(key))
  if (other.length > 0) {
    return { ok: false, message: `${SHAPE} It also holds ${other.join(", ")}.` }
  }
  const { route_policy, profile } = record
  if (route_policy !== undefined && !isObject(route_policy)) return { ok: false, message: SHAPE }
  if (profile !== undefined && !isObject(profile)) return { ok: false, message: SHAPE }
  if (route_policy === undefined && profile === undefined) return { ok: false, message: SHAPE }
  return {
    ok: true,
    candidate: {
      ...(route_policy === undefined ? {} : { route_policy }),
      ...(profile === undefined ? {} : { profile }),
    },
  }
}

export interface CandidateChoice {
  /** "profile:<id>@<version>" or "route_policy:<route>@<version>". */
  readonly value: string
  readonly label: string
}

/** The registry's profiles and route policies, to start a candidate from. */
export function candidateChoices(): CandidateChoice[] {
  return [
    ...REGISTRY.profiles.map((p) => ({
      value: `profile:${p.id}@${p.version}`,
      label: `Profile ${p.id} v${p.version} · ${p.route}`,
    })),
    ...REGISTRY.route_policies.map((p) => ({
      value: `route_policy:${p.route}@${p.version}`,
      label: `Route policy ${p.route} ${p.version}`,
    })),
  ]
}

/** The candidate JSON a choice starts from, or undefined for a choice the registry does not hold. */
export function candidateText(value: string): string | undefined {
  const profile = REGISTRY.profiles.find((p) => value === `profile:${p.id}@${p.version}`)
  if (profile) return JSON.stringify({ profile }, null, 2)
  const policy = REGISTRY.route_policies.find(
    (p) => value === `route_policy:${p.route}@${p.version}`,
  )
  if (policy) return JSON.stringify({ route_policy: policy }, null, 2)
  return undefined
}
