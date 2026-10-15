// The wrapper's logic: what a wrapper around a conformant assembler does with one assemble() call,
// as docs/otel-semantic-conventions.md defines it. It times the call, redacts bodies by the route's
// mode, and builds an assembly event v1 around the snapshot and the trace. It never changes what
// the assembler decides. The demo-traffic generator is its first user; the TypeScript wrapper of
// Phase 2 is extracted from it (D10).

import { createHash } from "node:crypto"
import { performance } from "node:perf_hooks"

import {
  BUILT_ASSEMBLER,
  SnapshotRejectedError,
  TOKENIZERS,
  UnsupportedComponentError,
  assemble,
} from "@cwa-dashboard/assembler"
import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"

export type RedactionMode = AssemblyEventV1["redaction_mode"]

export interface Recording {
  /** The event's ULID. */
  readonly eventId: string
  /** When the wrapper recorded the call, as an ISO 8601 instant. */
  readonly recordedAt: string
  readonly service: AssemblyEventV1["service"]
  readonly session?: AssemblyEventV1["session"]
  /** The route's redaction mode, and for pii_scrubbed the terms its scrubber replaces. */
  readonly redaction: { readonly mode: RedactionMode; readonly scrub?: readonly string[] }
  /** The trace's id; the assembler picks a random one when absent (R-23). */
  readonly traceId?: string
}

/** Records one assemble() call over `snapshot` as an assembly event. */
export function record(snapshot: unknown, recording: Recording): AssemblyEventV1 {
  const start = performance.now()
  let assembly: ReturnType<typeof assemble> | undefined
  let problems: string[] | undefined
  try {
    assembly = assemble(
      snapshot,
      recording.traceId === undefined ? {} : { traceId: recording.traceId },
    )
  } catch (error) {
    // A snapshot the checks reject, or one naming a tokenizer or renderer the assembler does not
    // provide, stops before assembly with no payload and no trace.
    if (error instanceof SnapshotRejectedError) problems = [...error.problems]
    else if (error instanceof UnsupportedComponentError) problems = [error.message]
    else throw error
  }
  const total = performance.now() - start

  const redacted = redactSnapshot(snapshot, recording.redaction.mode, recording.redaction.scrub)
  const envelope = {
    $schema: "cwa-dashboard/assembly-event/v1" as const,
    event_id: recording.eventId,
    recorded_at: recording.recordedAt,
    service: recording.service,
    assembler: {
      language: BUILT_ASSEMBLER.language,
      name: BUILT_ASSEMBLER.name,
      version: BUILT_ASSEMBLER.version,
    },
    contract: { ...BUILT_ASSEMBLER.contract },
    ...(recording.session === undefined ? {} : { session: recording.session }),
    redaction_mode: recording.redaction.mode,
    timings_ms: { total },
  }

  if (assembly === undefined) {
    return {
      ...envelope,
      outcome: "rejected",
      rejection: { problems: problems!, snapshot: redacted as Record<string, unknown> },
    }
  }
  const { trace, payload } = assembly
  if (trace.refused.bool || payload === null) {
    return { ...envelope, outcome: "refused", snapshot: redacted as never, trace }
  }
  return {
    ...envelope,
    outcome: "assembled",
    snapshot: redacted as never,
    trace,
    payload: { hash: sha256(payload), bytes: payload.length },
  }
}

// --- redaction -----------------------------------------------------------------------------------

const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex")

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The snapshot with every candidate's body and variant bodies as the mode leaves them, and every
 * other field untouched (R-DASH-1). Works on a copy, and on a rejected snapshot as far as its shape
 * allows: a batch, item or variant that is not an object is left as it is.
 */
export function redactSnapshot(
  snapshot: unknown,
  mode: RedactionMode,
  scrub: readonly string[] = [],
): unknown {
  const copy = structuredClone(snapshot)
  if (mode === "full" || !isRecord(copy) || !Array.isArray(copy["batches"])) return copy
  const tokenizer = typeof copy["tokenizer"] === "string" ? copy["tokenizer"] : undefined
  const redact = (body: unknown) => redactBody(body, mode, tokenizer, scrub)
  for (const batch of copy["batches"]) {
    if (!isRecord(batch) || !Array.isArray(batch["items"])) continue
    for (const item of batch["items"]) {
      if (!isRecord(item)) continue
      if ("body" in item) item["body"] = redact(item["body"])
      if (!Array.isArray(item["variants"])) continue
      for (const variant of item["variants"]) {
        if (isRecord(variant) && "body" in variant) variant["body"] = redact(variant["body"])
      }
    }
  }
  return copy
}

function redactBody(
  body: unknown,
  mode: Exclude<RedactionMode, "full">,
  tokenizer: string | undefined,
  scrub: readonly string[],
) {
  const isText = typeof body === "string"
  // The original's digest: its UTF-8 bytes when a string, its RFC 8785 serialization otherwise.
  const content_sha256 = sha256(isText ? body : canonicalJson(body))
  // The original's count under the snapshot's tokenizer, as the assembler would count it.
  const count = tokenizer === undefined ? undefined : TOKENIZERS[tokenizer]
  const token_counts: Record<string, number> =
    isText && tokenizer !== undefined && count !== undefined ? { [tokenizer]: count(body) } : {}
  if (mode === "digest_only") return { redacted: mode, content_sha256, token_counts }
  const text = isText ? scrubText(body, scrub) : ""
  return { redacted: mode, text, content_sha256, token_counts }
}

// The demo's scrubber: e-mail addresses, then the terms the route declares, longest first, so a
// full name goes before the first name inside it. A real wrapper plugs in its own.
const EMAIL = /[^\s@()<>"',;]+@[^\s@()<>"',;]+\.[A-Za-z]{2,}/g

function scrubText(text: string, terms: readonly string[]): string {
  let scrubbed = text.replace(EMAIL, "[email]")
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    if (term.length > 0) scrubbed = scrubbed.split(term).join("[name]")
  }
  return scrubbed
}

// --- RFC 8785 ------------------------------------------------------------------------------------

/**
 * The RFC 8785 (JSON Canonicalization Scheme) serialization of a JSON value: object members sorted
 * by their names' UTF-16 code units, at every depth, with no whitespace; strings and numbers as
 * ECMAScript's JSON.stringify writes them, which is what the scheme specifies.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (isRecord(value)) {
    const members = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    return `{${members.join(",")}}`
  }
  return JSON.stringify(value)
}

// --- ULID ----------------------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/**
 * A ULID: 48 bits of milliseconds since the epoch in its first ten characters, so ids sort by time,
 * then 80 bits from `random` (which returns values in [0, 1)) in the last sixteen.
 */
export function ulid(timeMs: number, random: () => number): string {
  let time = ""
  let rest = timeMs
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[rest % 32]! + time
    rest = Math.floor(rest / 32)
  }
  let tail = ""
  for (let i = 0; i < 16; i += 1) tail += CROCKFORD[Math.floor(random() * 32)]!
  return time + tail
}
