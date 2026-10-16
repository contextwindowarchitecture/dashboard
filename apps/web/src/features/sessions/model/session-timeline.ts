// Play the session's steps (STYLE.md 7, Choreographies): one per turn, in turn order, each naming
// the firsts that appear when it is reached. Built from the session model and nothing else.

import type { Firsts, SessionModel } from "./session"

export interface PlayStep {
  readonly turn: number
  /** The firsts whose marker appears at this turn. */
  readonly reveals: readonly (keyof Firsts)[]
}

const KINDS: readonly (keyof Firsts)[] = ["compressed", "overBudget", "refusal"]

export function sessionTimeline(model: SessionModel): PlayStep[] {
  return model.turns.map((turn) => ({
    turn: turn.turn,
    reveals: KINDS.filter((kind) => model.firsts[kind] === turn.turn),
  }))
}
