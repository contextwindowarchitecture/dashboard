// A draft's models (ADR-0013): what changed against where it started, a top-level field read and set
// by the kind the contract's FIELDS give it, and a snapshot with the draft in place for a preview.
// None of this decides what the assembler would do; the preview's replay does.

import type { Field } from "@cwa-dashboard/contract/data"
import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { DraftV1 } from "@cwa-dashboard/telemetry/types"

export type DraftKind = "route_policy" | "profile"
type Json = unknown
type Doc = Record<string, Json>

export interface Change {
  /** A JSON Pointer (RFC 6901), the notation the contract's validators report paths in. */
  readonly path: string
  readonly before: Json
  readonly after: Json
}

const isObject = (value: Json): value is Doc =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const escape = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1")

/** Every changed leaf, by path; an added or removed one has `undefined` on its missing side. */
export function changes(before: Json, after: Json, path = ""): Change[] {
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    return keys
      .flatMap((key) => changes(before[key], after[key], `${path}/${escape(key)}`))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length)
    return Array.from({ length }, (_, i) => changes(before[i], after[i], `${path}/${i}`)).flat()
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path, before, after }]
}

/** A field's value as the editor shows it: a scalar as itself, the rest as JSON; empty when absent. */
export function fieldText(document: Json, field: Field): string {
  const value = isObject(document) ? document[field.name] : undefined
  if (value === undefined) return ""
  return field.kind === "json" || typeof value === "object"
    ? JSON.stringify(value, null, 2)
    : String(value)
}

export type SetField =
  { readonly ok: true; readonly document: Doc } | { readonly ok: false; readonly problem: string }

/** The document with the field set from the editor's text, or what the text cannot be. */
export function setField(document: Json, field: Field, text: string): SetField {
  const base: Doc = isObject(document) ? { ...document } : {}
  if (text.trim() === "" && !field.required) {
    delete base[field.name]
    return { ok: true, document: base }
  }
  let value: Json
  switch (field.kind) {
    case "string":
      value = text
      break
    case "integer":
      if (!/^-?\d+$/.test(text.trim()))
        return { ok: false, problem: `${field.name} is a whole number` }
      value = Number(text.trim())
      break
    case "boolean":
      if (text !== "true" && text !== "false") {
        return { ok: false, problem: `${field.name} is true or false` }
      }
      value = text === "true"
      break
    case "enum":
    case "const": {
      const chosen = field.values?.find((v) => String(v) === text)
      if (chosen === undefined) {
        return { ok: false, problem: `${field.name} is one of ${(field.values ?? []).join(", ")}` }
      }
      value = chosen
      break
    }
    case "json":
      try {
        value = JSON.parse(text)
      } catch (error) {
        return {
          ok: false,
          problem: `${field.name} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
  }
  return { ok: true, document: { ...base, [field.name]: value } }
}

/** The snapshot with the draft in place of its profile or route policy, and nothing else changed. */
export function withDraft<S extends object>(snapshot: S, kind: DraftKind, document: Json): S {
  return { ...snapshot, [kind]: document }
}

export interface Start {
  readonly kind: DraftKind
  readonly started_from: DraftV1["started_from"]
  readonly document: Json
}

/** A new draft from a registry choice ("profile:<id>@<version>" or "route_policy:<route>@<version>"). */
export function startFrom(value: string): Start | undefined {
  const profile = REGISTRY.profiles.find((p) => value === `profile:${p.id}@${p.version}`)
  if (profile) {
    return {
      kind: "profile",
      started_from: { profile: { id: profile.id, version: profile.version } },
      document: profile,
    }
  }
  const policy = REGISTRY.route_policies.find(
    (p) => value === `route_policy:${p.route}@${p.version}`,
  )
  if (policy) {
    return {
      kind: "route_policy",
      started_from: { route_policy: { route: policy.route, version: policy.version } },
      document: policy,
    }
  }
  return undefined
}

/** The registry entry a draft started from, or undefined when it started from nothing the registry holds. */
export function startingDocument(started: DraftV1["started_from"]): Json {
  if (started === null) return undefined
  if ("profile" in started) {
    const { id, version } = started.profile
    return REGISTRY.profiles.find((p) => p.id === id && p.version === version)
  }
  const { route, version } = started.route_policy
  return REGISTRY.route_policies.find((p) => p.route === route && p.version === version)
}
