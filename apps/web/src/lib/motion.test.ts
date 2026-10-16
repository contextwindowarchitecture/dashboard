import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { sourceFiles } from "../test/source-files"
import { EASE, MOTION, gsap } from "./motion"

const style = readFileSync(resolve(import.meta.dirname, "../../../../STYLE.md"), "utf8")

// The point at parameter t on the CSS curve cubic-bezier(x1, y1, x2, y2).
function bezier(t: number, p1: number, p2: number) {
  return 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3
}

describe("lib/motion", () => {
  it("holds STYLE.md 7's durations, in seconds for GSAP", () => {
    const rule =
      /Durations are the site's: `(\d+)ms` per step with `cubic-bezier\(([^)]+)\)`, `(\d+)ms` for a cursor move, `(\d+)ms` for a marker\. A played session runs one turn per `(\d+)ms`/.exec(
        style,
      )
    expect(rule).not.toBeNull()
    const [, step, curve, cursor, marker, turn] = rule!
    expect(MOTION).toEqual({
      step: Number(step) / 1000,
      cursor: Number(cursor) / 1000,
      marker: Number(marker) / 1000,
      turn: Number(turn) / 1000,
    })
    expect(curve).toBe(".2,.8,.25,1")
  })

  it("eases as the site's cubic-bezier(.2,.8,.25,1)", () => {
    const ease = gsap.parseEase(EASE)
    for (let i = 1; i < 20; i += 1) {
      const t = i / 20
      const x = bezier(t, 0.2, 0.25)
      expect(ease(x)).toBeCloseTo(bezier(t, 0.8, 1), 2)
    }
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
  })
})

// STYLE.md 7 and 9: GSAP runs only in the three choreographies, through lib/motion, and the
// illustration player only in its wrapper, so neither reaches a chunk that does not need it.
// A choreography module is added to this list by name when it lands.
const CHOREOGRAPHIES: string[] = [
  "features/sessions/components/session-player-motion.tsx",
  "features/traces/components/stage-walk-motion.tsx",
]
const ILLUSTRATION = "components/dashboard/illustration.tsx"

describe("motion and illustration stay where STYLE.md 7 names them", () => {
  const importers = (pattern: RegExp) =>
    sourceFiles()
      .filter((file) => pattern.test(file.text))
      .map((file) => file.name)

  it("imports GSAP only in lib/motion", () => {
    expect(importers(/from\s+["'](?:gsap|@gsap\/[\w-]+)(?:\/[\w./-]*)?["']/)).toEqual([
      "lib/motion.ts",
    ])
  })

  it("imports lib/motion only in the choreographies", () => {
    expect(importers(/from\s+["'](?:@\/lib\/motion|(?:\.\.?\/)+(?:lib\/)?motion)["']/)).toEqual(
      CHOREOGRAPHIES,
    )
  })

  it("imports the illustration player only in its wrapper", () => {
    for (const name of importers(/from\s+["']@lottiefiles\/dotlottie-react["']/)) {
      expect(name).toBe(ILLUSTRATION)
    }
  })
})
