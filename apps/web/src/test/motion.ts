// For the choreographies' tests (STYLE.md 7): the reader's motion preference as the page's media
// queries see it, and GSAP's clock run faster than reading time. Call withMotionClock() at the top
// of a describe file; it restores matchMedia and the clock after each test.

import { afterEach, beforeEach, vi } from "vitest"

import { gsap, REDUCED_MOTION } from "../lib/motion"

const NO_PREFERENCE = "(prefers-reduced-motion: no-preference)"

/** The media the page sees: the reader's motion preference, and nothing else matching. */
export function prefer(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === (reduce ? REDUCED_MOTION : NO_PREFERENCE),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

/** Every tween and delayed call still on GSAP's clock. */
export const running = () => gsap.globalTimeline.getChildren(true, true, true)

export function withMotionClock() {
  const original = window.matchMedia
  beforeEach(() => {
    // Four times as fast: a turn of 150ms, slow enough that a waitFor polling every 50ms sees each
    // step, fast enough that a played choreography takes test time, not reading time.
    gsap.globalTimeline.timeScale(4)
  })
  afterEach(() => {
    gsap.globalTimeline.timeScale(1)
    window.matchMedia = original
  })
}
