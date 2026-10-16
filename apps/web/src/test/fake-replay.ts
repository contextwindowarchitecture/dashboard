// A replay client for page tests: it records each snapshot it is sent and answers as the test tells
// it, by default with the recorded event's own trace and payload, as a faithful service would. What
// the real service answers is apps/ingest's to test, through the real assembler.

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"

import type { ReplayAnswer, ReplayClient } from "../features/sandbox/api/replay"

export const recordedAnswer = (event: AssemblyEventV1): ReplayAnswer => ({
  kind: "replayed",
  outcome: event.outcome === "refused" ? "refused" : "assembled",
  trace: event.trace,
  payloadHash: event.payload?.hash ?? null,
  payloadBytes: event.payload?.bytes ?? null,
  snapshotDigest: event.trace!.context.snapshot_digest,
})

export function fakeReplay(answer: (snapshot: unknown) => ReplayAnswer) {
  const sent: unknown[] = []
  const client: ReplayClient = {
    async replay(snapshot) {
      sent.push(snapshot)
      return answer(snapshot)
    },
    async components() {
      return {
        tokenizers: [{ id: "fixture-whitespace/v1", required: true, provided: true }],
        renderers: [{ id: "cwa-messages/v1", required: true, provided: true }],
      }
    },
  }
  return { client, sent }
}
