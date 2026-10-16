// Replay (dashboard-plan.md 7.8, D12): one snapshot through the pinned TypeScript assembler, as the
// sandbox asks for it. It returns what the assembler decided and nothing else: the trace, the
// payload's SHA-256 and size, and the snapshot digest the trace records; or, for a snapshot the
// checks reject, their problems; or, for a tokenizer or renderer the assembler does not provide,
// that it does not (R-16). A replay is a cross-implementation check against a recorded event only
// when the event's own assembler was another (R-23); the caller says so, not this.

import { createHash } from "node:crypto"

import {
  SnapshotRejectedError,
  UnsupportedComponentError,
  assemble,
} from "@cwa-dashboard/assembler"

export type ReplayResult =
  | {
      readonly status: 200
      readonly body: {
        readonly ok: true
        readonly outcome: "assembled" | "refused"
        readonly trace: unknown
        /** Null for a refusal, which has no payload. */
        readonly payload_hash: string | null
        readonly payload_bytes: number | null
        readonly snapshot_digest: string
      }
    }
  | {
      readonly status: 400
      readonly body: { readonly ok: false; readonly kind: "rejected"; readonly problems: string[] }
    }
  | {
      readonly status: 422
      readonly body: {
        readonly ok: false
        readonly kind: "unsupported-component"
        readonly problems: string[]
      }
    }

export function replay(snapshot: unknown): ReplayResult {
  let assembly: ReturnType<typeof assemble>
  try {
    assembly = assemble(snapshot, {})
  } catch (error) {
    if (error instanceof SnapshotRejectedError) {
      return { status: 400, body: { ok: false, kind: "rejected", problems: [...error.problems] } }
    }
    if (error instanceof UnsupportedComponentError) {
      return {
        status: 422,
        body: { ok: false, kind: "unsupported-component", problems: [error.message] },
      }
    }
    throw error
  }
  const { trace, payload } = assembly
  const refused = trace.refused.bool || payload === null
  return {
    status: 200,
    body: {
      ok: true,
      outcome: refused ? "refused" : "assembled",
      trace,
      payload_hash: refused ? null : createHash("sha256").update(payload).digest("hex"),
      payload_bytes: refused ? null : payload.length,
      snapshot_digest: trace.context.snapshot_digest,
    },
  }
}
