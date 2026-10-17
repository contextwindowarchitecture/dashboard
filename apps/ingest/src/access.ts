// Who may read what (ADR-0011): the access file grants roles to anonymous readers, to every signed-in
// reader and by the issuer's groups, and a reader holds the union of what applies to them. A body a
// reader may not see is withheld with its digest; the event keeps the mode its wrapper recorded.

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { canonicalJson } from "@cwa-dashboard/telemetry/canonical"
import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"

export type Role = "viewer" | "auditor" | "operator" | `owner:${string}`

export interface Access {
  readonly anonymous: readonly Role[]
  readonly signed_in: readonly Role[]
  readonly groups: Readonly<Record<string, readonly Role[]>>
}

const isRole = (value: unknown): value is Role =>
  value === "viewer" ||
  value === "auditor" ||
  value === "operator" ||
  (typeof value === "string" && /^owner:(\*|[^\s*]+)$/.test(value))

function roles(value: unknown, where: string, problems: string[]): Role[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    problems.push(`${where} must be a list of roles`)
    return []
  }
  for (const role of value) {
    if (!isRole(role)) problems.push(`${where} names ${JSON.stringify(role)}, not a role`)
  }
  return value.filter(isRole)
}

/** The access file's grants, checked: an unknown key, role or shape is a mistake, said at start. */
export function accessFrom(value: unknown): Access {
  const problems: string[] = []
  const raw = (
    typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}
  ) as Record<string, unknown>
  for (const key of Object.keys(raw)) {
    if (!["anonymous", "signed_in", "groups"].includes(key))
      problems.push(`${key} is not a key of the access file`)
  }
  const groups: Record<string, Role[]> = {}
  const given = raw["groups"]
  if (
    given !== undefined &&
    (typeof given !== "object" || given === null || Array.isArray(given))
  ) {
    problems.push("groups must map group names to lists of roles")
  } else {
    for (const [group, list] of Object.entries((given ?? {}) as Record<string, unknown>)) {
      groups[group] = roles(list, `groups.${group}`, problems)
    }
  }
  const access = {
    anonymous: roles(raw["anonymous"], "anonymous", problems),
    signed_in: roles(raw["signed_in"], "signed_in", problems),
    groups,
  }
  if (problems.length > 0) throw new Error(`The access file: ${problems.join("; ")}`)
  return access
}

/** The access file ACCESS_FILE names, or undefined: every reader reads everything, as before. */
export function loadAccess(env: Readonly<Record<string, string | undefined>>): Access | undefined {
  const path = env["ACCESS_FILE"]
  if (path === undefined || path === "") return undefined
  return accessFrom(JSON.parse(readFileSync(path, "utf8")))
}

/** A reader's roles: anonymity's, and when signed in, sign-in's and every group's. */
export function rolesOf(
  access: Access,
  session: { readonly groups: readonly string[] } | undefined,
): Set<Role> {
  const held = new Set<Role>(access.anonymous)
  if (session !== undefined) {
    for (const role of access.signed_in) held.add(role)
    for (const group of session.groups)
      for (const role of access.groups[group] ?? []) held.add(role)
  }
  return held
}

/** Every role reads what a viewer reads: the metadata and every document derived from it. */
export const mayRead = (held: ReadonlySet<Role>) => held.size > 0

/** Whether a reader owns a route: its bodies and its bundles. */
export const mayOwn = (held: ReadonlySet<Role>, route: string | undefined) =>
  held.has("owner:*") || (route !== undefined && held.has(`owner:${route}`))

/** The route an event ran, when its snapshot says. */
export function routeOf(event: AssemblyEventV1): string | undefined {
  const snapshot = (event.snapshot ?? event.rejection?.snapshot) as
    { route_policy?: { route?: unknown } } | undefined
  const route = snapshot?.route_policy?.route
  return typeof route === "string" ? route : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** The digest the conventions define: a redacted body's own, else the original's. */
function digestOf(body: unknown): string {
  if (isRecord(body) && typeof body["content_sha256"] === "string") return body["content_sha256"]
  return createHash("sha256")
    .update(typeof body === "string" ? body : canonicalJson(body))
    .digest("hex")
}

/** The event with every body and variant body withheld, and nothing else changed; a copy. */
export function withholdBodies(event: AssemblyEventV1): AssemblyEventV1 {
  const copy = structuredClone(event)
  const snapshot = (copy.snapshot ?? copy.rejection?.snapshot) as unknown
  if (!isRecord(snapshot) || !Array.isArray(snapshot["batches"])) return copy
  const withhold = (body: unknown) => ({ withheld: "role", content_sha256: digestOf(body) })
  for (const batch of snapshot["batches"]) {
    if (!isRecord(batch) || !Array.isArray(batch["items"])) continue
    for (const item of batch["items"]) {
      if (!isRecord(item)) continue
      if ("body" in item) item["body"] = withhold(item["body"])
      if (!Array.isArray(item["variants"])) continue
      for (const variant of item["variants"]) {
        if (isRecord(variant) && "body" in variant) variant["body"] = withhold(variant["body"])
      }
    }
  }
  return copy
}
