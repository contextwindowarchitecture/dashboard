// Play the session (STYLE.md 7): the third choreography, loaded only when a session is first
// played. The bar of the turn reached grows from the baseline and the markers of the firsts it
// reveals fade in; while playing, the next turn comes one beat later, a beat being STYLE.md 7's
// turn divided by the speed chosen. GSAP owns only the bars' transform and the markers' opacity,
// inside a useGSAP scope that reverts on every change of turn, play state or speed and on unmount,
// so nothing is left running; under reduced motion nothing is tweened and the play still steps.

import { useLayoutEffect, useRef, type RefObject } from "react"

import { EASE, MOTION, REDUCED_MOTION, gsap, useGSAP } from "../../../lib/motion"

interface Props {
  /** The element holding the chart; the tweens reach nothing outside it. */
  readonly scope: RefObject<HTMLElement | null>
  readonly turn: number
  readonly playing: boolean
  readonly speed: number
  /** Called one beat after a turn is reached while playing. */
  readonly onAdvance: () => void
}

export default function SessionPlayerMotion({ scope, turn, playing, speed, onAdvance }: Props) {
  const advance = useRef(onAdvance)
  useLayoutEffect(() => {
    advance.current = onAdvance
  })

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(
        { reduce: REDUCED_MOTION, full: "(prefers-reduced-motion: no-preference)" },
        (context) => {
          if (context.conditions?.["reduce"]) return
          const root = scope.current
          if (root === null) return
          const bar = root.querySelectorAll(
            `[data-turn="${turn}"] rect[data-segment], [data-turn="${turn}"] rect[data-refused]`,
          )
          if (bar.length > 0)
            gsap.from(bar, {
              scaleY: 0,
              transformOrigin: "50% 100%",
              duration: MOTION.step,
              ease: EASE,
            })
          const markers = root.querySelectorAll(`[data-marker-turn="${turn}"]`)
          if (markers.length > 0)
            gsap.from(markers, { opacity: 0, duration: MOTION.marker, delay: MOTION.step })
        },
      )
      if (playing) gsap.delayedCall(MOTION.turn / speed, () => advance.current()).data = "beat"
      return () => mm.revert()
    },
    { scope, dependencies: [turn, playing, speed], revertOnUpdate: true },
  )

  return null
}
