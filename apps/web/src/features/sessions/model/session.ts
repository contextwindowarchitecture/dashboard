// A session's view model (dashboard-plan.md 7.4): its turns in order, each with the tokens its
// planes took and its rendering overhead, the turn of the first compression, the first budget
// omission and the first refusal, and how many payload parts the turns reused. Read from the
// session document alone; nothing here is recomputed from the assembler's rules.

import type { SessionV1 } from "@cwa-dashboard/telemetry/types"

import type { PlaneKey } from "../../traces/model/inspector"

type SourceTurn = SessionV1["turns"][number]

export interface Turn {
  readonly turn: number
  readonly eventId: string
  readonly outcome: SourceTurn["outcome"]
  /** trace.result.input_tokens; undefined unless assembled. */
  readonly inputTokens: number | undefined
  /** snapshot.budget.input; undefined for a rejected turn. */
  readonly budget: number | undefined
  /** Included tokens by plane; undefined for a rejected turn, all zero for a refusal. */
  readonly byPlane: Readonly<Record<PlaneKey, number>> | undefined
  /** The payload's tokens beyond its items', never below zero; undefined unless assembled. */
  readonly overhead: number | undefined
  /** The items' tokens exceeded the payload's, so the overhead shown is clamped to zero. */
  readonly overheadNegative: boolean
  readonly compressed: number | undefined
  readonly overBudget: number | undefined
  readonly refusedReason: string | undefined
  readonly parts: number | undefined
  readonly reusedParts: number | undefined
}

/** The turn index of each first; absent when it never happened. */
export interface Firsts {
  readonly compressed?: number
  readonly overBudget?: number
  readonly refusal?: number
}

export interface SessionModel {
  readonly turns: readonly Turn[]
  readonly firsts: Firsts
  /** Over the turns that could be compared; undefined when none could. */
  readonly reuse: { comparedTurns: number; reusedParts: number; parts: number } | undefined
}

function turnOf(source: SourceTurn): Turn {
  const byPlane = source.by_plane
  const items = byPlane ? byPlane.gov + byPlane.state + byPlane.evid + byPlane.inter : 0
  const gap = source.input_tokens === undefined ? undefined : source.input_tokens - items
  return {
    turn: source.turn_index,
    eventId: source.event_id,
    outcome: source.outcome,
    inputTokens: source.input_tokens,
    budget: source.budget_input,
    byPlane,
    overhead: gap === undefined ? undefined : Math.max(0, gap),
    overheadNegative: gap !== undefined && gap < 0,
    compressed: source.compressed_count,
    overBudget: source.over_budget_count,
    refusedReason: source.refused_reason,
    parts: source.parts,
    reusedParts: source.reused_parts,
  }
}

export function sessionModel(session: SessionV1): SessionModel {
  const turns = [...session.turns].sort((a, b) => a.turn_index - b.turn_index).map(turnOf)
  const first = (test: (turn: Turn) => boolean) => turns.find(test)?.turn
  const compressed = first((t) => (t.compressed ?? 0) > 0)
  const overBudget = first((t) => (t.overBudget ?? 0) > 0)
  const refusal = first((t) => t.outcome === "refused")
  const { compared_turns, reused_parts, parts } = session.part_reuse
  return {
    turns,
    firsts: {
      ...(compressed === undefined ? {} : { compressed }),
      ...(overBudget === undefined ? {} : { overBudget }),
      ...(refusal === undefined ? {} : { refusal }),
    },
    reuse:
      compared_turns === 0
        ? undefined
        : { comparedTurns: compared_turns, reusedParts: reused_parts, parts },
  }
}
