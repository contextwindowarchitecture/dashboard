// What a replay of an event can show (dashboard-plan.md 7.8, Fidelity by mode; AGENTS.md, "Never let
// the sandbox claim more than it proves"). A full event replays as recorded, and its replay checks
// parity with the recorded hash and digest; a scrubbed event replays over the scrubbed text it
// holds and claims no parity, since its counts differ; a digested event holds no text and cannot
// replay; a rejected event replays its recorded snapshot, which may have lost what the checks
// rejected (a value JSON cannot hold). Parity says equal or different, never which assembler is wrong, and is a cross-
// implementation check only when another language's service recorded the event (R-23).

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"

// With its extension: apps/ingest runs this module under Node's resolution too (its tests).
import type { Snapshot } from "./controls.ts"

export type Replayable =
  | { readonly kind: "full"; readonly snapshot: Snapshot }
  | { readonly kind: "rejected"; readonly snapshot: Snapshot; readonly reason: string }
  | { readonly kind: "scrubbed"; readonly snapshot: Snapshot; readonly reason: string }
  | { readonly kind: "none"; readonly reason: string }

const SETTING = "routes.<route>.redaction_mode"

type Raw = Record<string, unknown>
const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** A scrubbed body's own text, which the event holds; any other body as it is. */
const unscrub = (body: unknown) =>
  isRecord(body) && body["redacted"] === "pii_scrubbed" && typeof body["text"] === "string"
    ? body["text"]
    : body

function overScrubbedText(snapshot: unknown): Snapshot {
  const copy = structuredClone(snapshot) as Raw
  for (const batch of (copy["batches"] ?? []) as Raw[]) {
    for (const item of (batch["items"] ?? []) as Raw[]) {
      item["body"] = unscrub(item["body"])
      for (const variant of (Array.isArray(item["variants"]) ? item["variants"] : []) as Raw[]) {
        if ("body" in variant) variant["body"] = unscrub(variant["body"])
      }
    }
  }
  return copy as unknown as Snapshot
}

export function replayable(event: AssemblyEventV1): Replayable {
  const snapshot = (event.snapshot ?? event.rejection?.snapshot) as unknown
  if (event.redaction_mode === "digest_only") {
    return {
      kind: "none",
      reason: `This event was recorded digest_only: its bodies are SHA-256 digests and token counts, not text, so there is nothing to assemble. The route's ${SETTING} setting in its wrapper decides what an event keeps.`,
    }
  }
  if (event.redaction_mode === "pii_scrubbed") {
    return {
      kind: "scrubbed",
      snapshot: overScrubbedText(snapshot),
      reason:
        "This event was recorded pii_scrubbed: it replays over the scrubbed text it holds, whose token counts differ from the original's, so the replay claims no parity.",
    }
  }
  if (event.outcome === "rejected") {
    return {
      kind: "rejected",
      snapshot: structuredClone(snapshot) as Snapshot,
      reason:
        "This is the snapshot as the event recorded it, in JSON. A value JSON cannot hold, such as a number outside the double range, is not in it, so a replay may not be rejected for the same problems.",
    }
  }
  return { kind: "full", snapshot: structuredClone(snapshot) as Snapshot }
}

export interface Replayed {
  readonly outcome: "assembled" | "refused"
  readonly payloadHash: string | null
  readonly snapshotDigest: string
}

interface Compared {
  readonly crossImplementation: boolean
  readonly recorded: { language: string; hash: string | null; digest: string | undefined }
  readonly replayed: { hash: string | null; digest: string }
  readonly note: string
}

export type Parity =
  | ({ readonly kind: "equal" } & Compared)
  | ({ readonly kind: "differ" } & Compared)
  | { readonly kind: "edited"; readonly note: string }
  | { readonly kind: "no-claim"; readonly note: string }

export function parity(
  event: AssemblyEventV1,
  replay: Replayed,
  { edited }: { readonly edited: boolean },
): Parity {
  if (event.redaction_mode !== "full") {
    return { kind: "no-claim", note: "A scrubbed event replays without a parity claim." }
  }
  if (edited) {
    return {
      kind: "edited",
      note: "The controls changed the snapshot, so there is nothing recorded to compare with.",
    }
  }
  const recorded = {
    language: event.assembler.language,
    hash: event.payload?.hash ?? null,
    digest: event.trace?.context.snapshot_digest,
  }
  const equal = recorded.hash === replay.payloadHash && recorded.digest === replay.snapshotDigest
  const crossImplementation = event.assembler.language !== "typescript"
  return {
    kind: equal ? "equal" : "differ",
    crossImplementation,
    recorded,
    replayed: { hash: replay.payloadHash, digest: replay.snapshotDigest },
    note: equal
      ? crossImplementation
        ? `Recorded by the ${recorded.language} assembler and replayed by the TypeScript assembler to the same payload and digest: the cross-implementation check R-23 promises.`
        : "Replayed by the TypeScript assembler to the payload and digest it recorded (R-23)."
      : "The replay's payload or digest is not the recorded one, so one of the two is non-conformant; a replay cannot say which.",
  }
}
