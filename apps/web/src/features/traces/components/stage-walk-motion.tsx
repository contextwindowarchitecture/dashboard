// Walk the trace (STYLE.md 7): the one choreography on the Excluded tab, loaded only when a walk
// starts. The rows of the stage reached rise into place, and while the walk plays the next stage
// comes one turn later. GSAP owns only the rows' opacity and transform, inside a useGSAP scope that
// reverts on every change of stage or play state and on unmount, so nothing is left running; under
// reduced motion nothing is tweened and each step is the page's state at once.

import { useLayoutEffect, useRef, type RefObject } from "react"

import { EASE, MOTION, REDUCED_MOTION, gsap, useGSAP } from "../../../lib/motion"

interface Props {
  /** The element holding the stage groups; the tweens reach nothing outside it. */
  readonly scope: RefObject<HTMLElement | null>
  /** The step reached, as the URL names it. */
  readonly stage: string
  readonly playing: boolean
  /** Called one turn after a step while playing. */
  readonly onAdvance: () => void
}

export default function StageWalkMotion({ scope, stage, playing, onAdvance }: Props) {
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
          const rows = scope.current?.querySelectorAll(
            '[data-current] [data-slot="excluded-row"], [data-slot="note"][data-current]',
          )
          if (!rows?.length) return
          gsap.from(rows, {
            opacity: 0,
            y: 8,
            duration: MOTION.step,
            ease: EASE,
            stagger: MOTION.marker,
          })
        },
      )
      if (playing) gsap.delayedCall(MOTION.turn, () => advance.current())
      return () => mm.revert()
    },
    { scope, dependencies: [stage, playing], revertOnUpdate: true },
  )

  return null
}
