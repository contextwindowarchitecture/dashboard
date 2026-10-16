// The session player's controls (STYLE.md 7, Play the session): Play and Pause, Step back and Step
// forward, the arrow keys, Space, a scrubber and a speed control. The turn lives in the URL and the
// turn reached is announced once per change; Show all ends a play. The page is complete without
// touching any of them.

import type { ChangeEvent, KeyboardEvent } from "react"

import { formatCount } from "../../../lib/format"
import type { Turn } from "../model/session"
import { SPEEDS, type Player } from "./use-player"

function turnStatus(turn: Turn, at: number, steps: number) {
  const outcome = turn.refusedReason ? `refused · ${turn.refusedReason}` : turn.outcome
  return `Turn ${turn.turn} · step ${formatCount(at + 1)} of ${formatCount(steps)} · ${outcome}`
}

export function SessionPlayer({ player, turn }: { readonly player: Player; readonly turn: Turn }) {
  const { steps, at, played, playing, speed } = player
  const canBack = at > 0
  const canForward = at < steps.length - 1
  const back = () => canBack && player.step(at - 1)
  const forward = () => canForward && player.step(at + 1)
  const onKeyDown = (e: KeyboardEvent) => {
    // The scrubber moves itself with the arrow keys; stepping too would move it twice.
    if (e.target instanceof HTMLInputElement) return
    if (e.key === "ArrowLeft") back()
    else if (e.key === "ArrowRight") forward()
    else if (e.key === " ") {
      if (playing) player.pause()
      else player.play()
    } else return
    e.preventDefault()
  }
  const onScrub = (e: ChangeEvent<HTMLInputElement>) => player.step(Number(e.target.value))
  return (
    <div role="group" aria-label="Session player" data-slot="walk-controls" onKeyDown={onKeyDown}>
      <button type="button" data-slot="ghost-button" aria-pressed={playing} onClick={player.play}>
        Play
      </button>
      <button type="button" data-slot="ghost-button" aria-pressed={!playing} onClick={player.pause}>
        Pause
      </button>
      <button type="button" data-slot="ghost-button" aria-disabled={!canBack} onClick={back}>
        Step back
      </button>
      <button type="button" data-slot="ghost-button" aria-disabled={!canForward} onClick={forward}>
        Step forward
      </button>
      <button
        type="button"
        data-slot="ghost-button"
        aria-disabled={!played}
        onClick={() => played && player.showAll()}
      >
        Show all
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
      <div role="group" aria-label="Speed" data-slot="segmented">
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            data-slot="ghost-button"
            aria-pressed={speed === value}
            onClick={() => player.setSpeed(value)}
          >
            {value}×
          </button>
        ))}
      </div>
      <p role="status" data-slot="walk-status">
        {turnStatus(turn, at, steps.length)}
      </p>
    </div>
  )
}
