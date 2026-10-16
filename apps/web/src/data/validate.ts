// The boundary (dashboard-plan.md 9): every document the source returns is checked here before a
// page reads it. Its $schema must name the kind the caller expects at the version this dashboard
// reads; only then is it validated, with the generated standalone validators (no schema is compiled
// in the browser: the Content Security Policy forbids eval). Each way a document can fail is a
// result, so a page shows "unsupported" or "invalid" as a state, not a crash.

import type {
  AssemblyEventV1,
  EventsIndexV1,
  FleetReportV1,
  SessionV1,
} from "@cwa-dashboard/telemetry/types"
import {
  validateAssemblyEventV1,
  validateEventsIndexV1,
  validateFleetReportV1,
  validateSessionV1,
} from "@cwa-dashboard/telemetry/validators"
import type { ErrorObject, ValidateFunction } from "ajv"

export interface DocumentByKind {
  "assembly-event": AssemblyEventV1
  "events-index": EventsIndexV1
  session: SessionV1
  "fleet-report": FleetReportV1
}
export type Kind = keyof DocumentByKind

const VALIDATORS: { [K in Kind]: ValidateFunction<DocumentByKind[K]> } = {
  "assembly-event": validateAssemblyEventV1,
  "events-index": validateEventsIndexV1,
  session: validateSessionV1,
  "fleet-report": validateFleetReportV1,
}
const KINDS = Object.keys(VALIDATORS) as Kind[]
const VERSION = "v1"

export type ParseResult<K extends Kind> =
  | { ok: true; document: DocumentByKind[K] }
  /** No dashboard $schema, a foreign one, or a version this dashboard does not read. */
  | { ok: false; reason: "unsupported"; schema: string | null }
  /** Another of the dashboard's kinds where this one was expected. */
  | { ok: false; reason: "wrong-kind"; expected: K; actual: Kind }
  /** The expected kind and version, failing its schema: the problems in words, by path. */
  | { ok: false; reason: "invalid"; issues: string[] }

export function parseDocument<K extends Kind>(kind: K, json: unknown): ParseResult<K> {
  const schema =
    typeof json === "object" &&
    json !== null &&
    !Array.isArray(json) &&
    typeof (json as Record<string, unknown>)["$schema"] === "string"
      ? ((json as Record<string, unknown>)["$schema"] as string)
      : null
  const match = schema === null ? null : /^cwa-dashboard\/([a-z-]+)\/(v\d+)$/.exec(schema)
  if (match === null) return { ok: false, reason: "unsupported", schema }
  const [, found, version] = match
  if (version !== VERSION || !KINDS.includes(found as Kind))
    return { ok: false, reason: "unsupported", schema }
  if (found !== kind)
    return { ok: false, reason: "wrong-kind", expected: kind, actual: found as Kind }
  const validate = VALIDATORS[kind]
  if (validate(json)) return { ok: true, document: json as DocumentByKind[K] }
  return { ok: false, reason: "invalid", issues: describeErrors(validate.errors) }
}

/**
 * Ajv's errors as "<path> <what is wrong>", without the noise of conditional branches: an `if`
 * that failed is not a problem, and a value matching none of an anyOf's forms is one problem, not
 * one per form.
 */
export function describeErrors(errors: ErrorObject[] | null | undefined): string[] {
  const all = (errors ?? []).filter((error) => error.keyword !== "if")
  const branches = all
    .filter((error) => error.keyword === "anyOf")
    .map((error) => `${error.schemaPath}/`)
  const kept = all.filter(
    (error) => !branches.some((prefix) => error.schemaPath.startsWith(prefix)),
  )
  const words = kept.map((error) => {
    const where = error.instancePath || "/"
    if (error.keyword === "anyOf") return `${where} matches none of its allowed forms`
    if (error.keyword === "additionalProperties") {
      return `${where} has ${String(error.params["additionalProperty"])}, which its schema does not allow`
    }
    if (error.keyword === "required")
      return `${where} needs ${String(error.params["missingProperty"])}`
    return `${where} ${error.message ?? "is invalid"}`
  })
  return [...new Set(words)]
}
