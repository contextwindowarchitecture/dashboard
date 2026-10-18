import "@testing-library/jest-dom/vitest"
import { cleanup, configure } from "@testing-library/react"
import { afterEach, vi } from "vitest"

// A findBy or waitFor waits for its condition to hold, never for time to pass, so its limit only
// bounds a hung test. Testing Library's one second is too short on a shared CI runner while other
// packages' suites run beside it: the played session's turns, on GSAP's real clock, and two pages'
// first renders ran past it there.
configure({ asyncUtilTimeout: 10_000 })

afterEach(() => {
  cleanup()
})

// jsdom has no matchMedia, ResizeObserver or scrollIntoView, which the sidebar and the Radix
// primitives expect. These fill the gaps in the test environment only; at desktop width nothing
// matches a max-width query.
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  // Radix's Select captures the pointer while it is open.
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {}
}
