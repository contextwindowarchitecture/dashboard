// A policy repository's layout (ADR-0014): route-policies/<route>/<version>.json and
// profiles/<id>/<version>.json, a file's path its identity. Imports nothing, so the repository's
// check (deploy/policy-check.mjs) runs it under plain Node with no install.

export type PolicyKind = "route_policy" | "profile"

export interface Identity {
  readonly kind: PolicyKind
  /** The route policy's route, or the profile's id. */
  readonly name: string
  readonly version: string | number
}

export type Placed =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly problem: string }

const SEGMENT = /^[A-Za-z0-9._-]+$/
const segment = (value: string) => SEGMENT.test(value) && value !== "." && value !== ".."
const segments = (value: string) => value.split("/").every(segment)
const LAYOUT = "route-policies/<route>/<version>.json, profiles/<id>/<version>.json"

const field = (document: unknown, name: string): unknown =>
  typeof document === "object" && document !== null
    ? (document as Record<string, unknown>)[name]
    : undefined

/** Where a route policy or a profile belongs in the repository, or why it cannot be placed. */
export function policyPath(kind: PolicyKind, document: unknown): Placed {
  if (kind === "route_policy") {
    const route = field(document, "route")
    const version = field(document, "version")
    if (typeof route !== "string" || typeof version !== "string") {
      return { ok: false, problem: "A route policy names its route and its version." }
    }
    if (!segment(route))
      return { ok: false, problem: `The route ${JSON.stringify(route)} is not a path segment.` }
    if (!segments(version)) {
      return {
        ok: false,
        problem: `The version ${JSON.stringify(version)} is not path segments of letters, digits, dots, dashes and underscores.`,
      }
    }
    return { ok: true, path: `route-policies/${route}/${version}.json` }
  }
  const id = field(document, "id")
  const version = field(document, "version")
  if (typeof id !== "string" || typeof version !== "number" || !Number.isInteger(version)) {
    return { ok: false, problem: "A profile names its id and its version, a whole number." }
  }
  if (!segment(id))
    return { ok: false, problem: `The id ${JSON.stringify(id)} is not a path segment.` }
  return { ok: true, path: `profiles/${id}/${version}.json` }
}

/** What a path in the repository names, or undefined for a path outside the layout. */
export function identityOf(path: string): Identity | undefined {
  const policy = /^route-policies\/([^/]+)\/(.+)\.json$/.exec(path)
  if (policy && segment(policy[1]!) && segments(policy[2]!)) {
    return { kind: "route_policy", name: policy[1]!, version: policy[2]! }
  }
  const profile = /^profiles\/([^/]+)\/(0|[1-9]\d*)\.json$/.exec(path)
  if (profile && segment(profile[1]!)) {
    return { kind: "profile", name: profile[1]!, version: Number(profile[2]) }
  }
  return undefined
}

/** The problems with a file at a path: whether it is in the layout, and holds what its path names. */
export function checkFile(path: string, document: unknown): string[] {
  const identity = identityOf(path)
  if (identity === undefined)
    return [`${path}: not where a route policy or a profile belongs (${LAYOUT})`]
  const nameField = identity.kind === "route_policy" ? "route" : "id"
  const problems: string[] = []
  const name = field(document, nameField)
  if (name !== identity.name)
    problems.push(`${path}: ${nameField} is ${String(name)}, the path says ${identity.name}`)
  const version = field(document, "version")
  if (version !== identity.version) {
    problems.push(`${path}: version is ${String(version)}, the path says ${identity.version}`)
  }
  return problems
}

/** A document as the repository keeps it. */
export const fileText = (document: unknown) => `${JSON.stringify(document, null, 2)}\n`
