// Long content for performance and visual checks (dashboard-plan.md DP-7), never for the committed
// tree: one call whose trace has more than 400 rows, and a session of 60 turns. Both start from the
// refund scenario's first turn and are run through the real assembler like every other call.

import type { Snapshot } from "@cwa-dashboard/contract/types"

import { knowledge, query, turn } from "./scenarios/build.ts"
import { SCENARIOS } from "./scenarios/index.ts"

export const LONG_SESSION = "long-60"

interface LongCall {
  readonly snapshot: Snapshot
  readonly recordedAt: string
  readonly session?: { readonly id: string; readonly turn_index: number }
}

const refund = SCENARIOS.find((scenario) => scenario.id === "refund-session")!
const first = refund.turns[0]!.snapshot

type Batch = Snapshot["batches"][number]
const withBatch = (
  snapshot: Snapshot,
  producer: string,
  edit: (items: Batch["items"]) => Batch["items"],
) => ({
  ...snapshot,
  batches: snapshot.batches.map((b) =>
    b.producer.id === producer ? { ...b, items: edit(b.items) } : b,
  ),
})

/** 420 retrieved chunks, each from its own source, under a budget that takes most of them. */
function wideCall(): LongCall {
  const chunks = Array.from({ length: 420 }, (_, i) =>
    knowledge(
      `kb-wide:${i}#p1`,
      `Refund policy note ${i}: refunds inside 30 days are returned to the original payment method.`,
      0.6 + (i % 40) / 100,
      {
        source: `kb-wide-${i}`,
        source_version: "2026-10-01",
        freshness: "2026-10-01T00:00:00Z",
        extra: { scope: { tenant: "northwind" } },
      },
    ),
  )
  const snapshot = withBatch(structuredClone(first), "policy-corpus", (items) => [
    ...items,
    ...chunks,
  ])
  return {
    snapshot: { ...snapshot, budget: { ...snapshot.budget, input: 40_000 } },
    recordedAt: "2026-10-15T23:00:00.000Z",
  }
}

/** 60 turns of one conversation, the history growing by a user and a model line each turn. */
function sessionCalls(): LongCall[] {
  return Array.from({ length: 60 }, (_, k) => {
    const at = Date.parse("2026-10-15T20:00:00.000Z") + k * 60_000
    const iso = (offset: number) => new Date(at + offset).toISOString().replace(".000Z", "Z")
    const history = Array.from({ length: 2 * k }, (_, i) =>
      turn(
        `turn:${i + 1}`,
        i % 2 === 0
          ? `Question ${i / 2 + 1} about order 8821.`
          : `Answer ${(i - 1) / 2 + 1} about order 8821.`,
        i % 2 === 0 ? "user" : "model",
        {
          source: `conversation:${LONG_SESSION}#${i + 1}`,
          freshness: new Date(at - (2 * k - i) * 1000).toISOString().replace(".000Z", "Z"),
        },
      ),
    )
    const snapshot = withBatch(
      {
        ...structuredClone(first),
        assembly_time: iso(30_000),
        scope: { ...first.scope, session: LONG_SESSION },
      },
      "conversation",
      () => [
        ...history,
        query(`turn:${2 * k + 1}`, `Question ${k + 1} about order 8821.`, {
          source: `conversation:${LONG_SESSION}#${2 * k + 1}`,
          freshness: iso(29_000),
          extra: { scope: { ...first.scope, session: LONG_SESSION } },
        }),
      ],
    )
    return {
      snapshot,
      recordedAt: new Date(at + 30_500).toISOString(),
      session: { id: LONG_SESSION, turn_index: k },
    }
  })
}

export function longCalls(): LongCall[] {
  return [wideCall(), ...sessionCalls()]
}
