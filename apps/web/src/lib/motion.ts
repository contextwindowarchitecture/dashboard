// The one place GSAP is set up (STYLE.md 7, 9): the plugins registered once and the site's motion
// tokens, re-exported so each choreography imports GSAP from here. Only the three choreographies
// (play the session, walk the trace, settle the replay) import this module, and the routes that
// carry them load lazily, so GSAP is in no other chunk.

import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { CustomEase } from "gsap/CustomEase"

gsap.registerPlugin(useGSAP, CustomEase)

/** STYLE.md 7's durations, in seconds for GSAP: a step, a cursor move, a marker, a played turn. */
export const MOTION = {
  step: 0.28,
  cursor: 0.18,
  marker: 0.12,
  turn: 0.6,
} as const

/** The site's ease, cubic-bezier(.2,.8,.25,1), registered under this name. */
export const EASE = "cwa"
CustomEase.create(EASE, ".2,.8,.25,1")

/** The query under which every step is instant: progress is set, never tweened (STYLE.md 7). */
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

export { gsap, useGSAP }
