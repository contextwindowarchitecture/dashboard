// The session player's state (STYLE.md 7, Play the session): the turn is the URL's; whether the
// session has been played, whether it is playing and at what speed are the reader's, kept here.
// Until Play is pressed the chart shows every turn; once played, the turns after the cursor wait.

import { useState } from "react"

import type { SessionModel, Turn } from "../model/session"
import { sessionTimeline } from "../model/session-timeline"

export const SPEEDS = [0.5, 1, 2] as const
export type Speed = (typeof SPEEDS)[number]

export function usePlayer(model: SessionModel, turn: Turn, go: (turn: number) => void) {
  const [played, setPlayed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)
  const steps = sessionTimeline(model)
  const at = steps.findIndex((step) => step.turn === turn.turn)
  const last = steps.length - 1
  return {
    steps,
    at,
    played,
    playing,
    speed,
    setSpeed,
    /** Move to step i by the reader's hand, which pauses the play. */
    step: (i: number) => {
      const step = steps[i]
      if (step === undefined) return
      setPlaying(false)
      go(step.turn)
    },
    play: () => {
      if (at >= last && steps[0]) go(steps[0].turn)
      setPlayed(true)
      setPlaying(true)
    },
    pause: () => setPlaying(false),
    showAll: () => {
      setPlaying(false)
      setPlayed(false)
    },
    /** One beat on: the next turn, or the end of the play. */
    advance: () => {
      if (at < last) go(steps[at + 1]!.turn)
      else setPlaying(false)
    },
  }
}

export type Player = ReturnType<typeof usePlayer>
