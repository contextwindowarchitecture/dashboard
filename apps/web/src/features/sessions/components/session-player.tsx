// The session player's controls (STYLE.md 7, Play the session): Step back and Step forward, the
// arrow keys and a scrubber move the turn shown, which lives in the URL, and the turn reached is
// announced once per change. The page is complete without touching them.

import type { ChangeEvent, KeyboardEvent } from "react"

import { formatCount } from "../../../lib/format"
import type { SessionModel, Turn } from "../model/session"
import { sessionTimeline } from "../model/session-timeline"

function turnStatus(turn: Turn, at: number, steps: number) {
  const outcome = turn.refusedReason ? `refused · ${turn.refusedReason}` : turn.outcome
  return `Turn ${turn.turn} · step ${formatCount(at + 1)} of ${formatCount(steps)} · ${outcome}`
}

export function SessionPlayer({
  model,
  turn,
  go,
}: {
  readonly model: SessionModel
  readonly turn: Turn
  readonly go: (turn: number) => void
}) {
  const steps = sessionTimeline(model)
  const at = steps.findIndex((step) => step.turn === turn.turn)
  const canBack = at > 0
  const canForward = at < steps.length - 1
  const back = () => canBack && go(steps[at - 1]!.turn)
  const forward = () => canForward && go(steps[at + 1]!.turn)
  const onKeyDown = (e: KeyboardEvent) => {
    // The scrubber moves itself with the arrow keys; stepping too would move it twice.
    if (e.target instanceof HTMLInputElement) return
    if (e.key === "ArrowLeft") back()
    else if (e.key === "ArrowRight") forward()
    else return
    e.preventDefault()
  }
  const onScrub = (e: ChangeEvent<HTMLInputElement>) => {
    const step = steps[Number(e.target.value)]
    if (step) go(step.turn)
  }
  return (
    <div role="group" aria-label="Session player" data-slot="walk-controls" onKeyDown={onKeyDown}>
      <button type="button" data-slot="ghost-button" aria-disabled={!canBack} onClick={back}>
        Step back
      </button>
      <button type="button" data-slot="ghost-button" aria-disabled={!canForward} onClick={forward}>
        Step forward
      </button>
      <input
        type="range"
        data-slot="scrubber"
        aria-label="Turn"
        min={0}
        max={Math.max(0, steps.length - 1)}
        step={1}
        value={Math.max(0, at)}
        aria-valuetext={`Turn ${turn.turn} · step ${formatCount(at + 1)} of ${formatCount(steps.length)}`}
        onChange={onScrub}
      />
      <p role="status" data-slot="walk-status">
        {turnStatus(turn, at, steps.length)}
      </p>
    </div>
  )
}
