// Settle the replay (STYLE.md 7): the third choreography, loaded only when a replay answers. The
// replay's budget bar segments tween from the widths they had in the recorded assembly (a new one
// from nothing, a lost one, drawn as a ghost, to nothing), and the diff beneath fades in once the bar
// has settled. GSAP owns only the segments' flex-basis and the diff's opacity, inside a useGSAP scope
// that reverts on unmount, so nothing is left running; under reduced motion nothing is tweened, and
// the page never waits on it.

import type { RefObject } from "react"

import { EASE, MOTION, REDUCED_MOTION, gsap, useGSAP } from "../../../lib/motion"

interface Props {
  /** The element holding the replay's bar and diff; the tweens reach nothing outside it. */
  readonly scope: RefObject<HTMLElement | null>
  /** Each segment's starting width, as a share of the bar. */
  readonly from: Readonly<Record<string, number | undefined>>
}

export default function SettleMotion({ scope, from }: Props) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(
        { reduce: REDUCED_MOTION, full: "(prefers-reduced-motion: no-preference)" },
        (context) => {
          if (context.conditions?.["reduce"]) return
          const root = scope.current
          if (root === null) return
          const timeline = gsap.timeline()
          for (const [key, width] of Object.entries(from)) {
            const segment = root.querySelector(`[data-slot="budget-bar"] > [data-segment="${key}"]`)
            if (segment !== null && width !== undefined) {
              timeline.from(
                segment,
                { flexBasis: `${width}%`, duration: MOTION.step, ease: EASE },
                0,
              )
            }
          }
          const reveal = root.querySelector('[data-slot="settle-reveal"]')
          if (reveal !== null)
            timeline.from(reveal, { opacity: 0, duration: MOTION.step, ease: EASE })
        },
      )
      return () => mm.revert()
    },
    // By content, so a re-render with the same plan does not settle again.
    { scope, dependencies: [JSON.stringify(from)], revertOnUpdate: true },
  )
  return null
}
