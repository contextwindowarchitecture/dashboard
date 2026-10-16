import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { gsap, MOTION } from "../../../lib/motion"
import { prefer, running, withMotionClock } from "../../../test/motion"
import { renderApp } from "../../../test/render-app"

withMotionClock()

async function openPlayer(path = "/sessions/refund-7", strict = false) {
  const app = renderApp(path, {}, { strict })
  const player = await screen.findByRole("group", { name: "Session player" })
  const chart = screen.getByRole("img", { name: /turns/ })
  const button = (name: string) => within(player).getByRole("button", { name })
  const turn = () => new URLSearchParams(app.router.state.location.search).get("turn")
  const bars = () =>
    [...chart.querySelectorAll("[data-turn]")].map((g) => g.getAttribute("data-turn"))
  const marker = (kind: string) => chart.querySelector(`[data-marker="${kind}"]`)
  return { ...app, player, chart, button, turn, bars, marker }
}

describe("the played session", () => {
  it("shows every turn while the player is idle", async () => {
    prefer(false)
    const { bars } = await openPlayer()
    expect(bars()).toEqual(["0", "1", "2", "3", "4"])
  })

  it("plays from the first turn, growing a bar and revealing each first per turn, and stops at the last", async () => {
    prefer(false)
    const user = userEvent.setup()
    const { button, turn, bars, marker } = await openPlayer()
    await user.click(button("Play"))
    expect(button("Play")).toHaveAttribute("aria-pressed", "true")
    expect(turn()).toBe("0")
    expect(bars()).toEqual(["0"])
    await waitFor(() => expect(turn()).toBe("2"))
    expect(bars()).toEqual(["0", "1", "2"])
    expect(marker("overBudget")).toBeNull()
    await waitFor(() => expect(turn()).toBe("3"))
    expect(marker("overBudget")).not.toBeNull()
    expect(marker("compressed")).toBeNull()
    await waitFor(() => expect(button("Play")).toHaveAttribute("aria-pressed", "false"))
    expect(turn()).toBe("4")
    expect(bars()).toEqual(["0", "1", "2", "3", "4"])
    expect(marker("compressed")).not.toBeNull()
  })

  it("holds the turn while paused, steps pause it, and Show all ends it", async () => {
    prefer(false)
    const user = userEvent.setup()
    const { button, turn, bars } = await openPlayer()
    gsap.globalTimeline.timeScale(0.001)
    await user.click(button("Play"))
    await user.click(button("Pause"))
    gsap.globalTimeline.timeScale(1000)
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(turn()).toBe("0")
    expect(bars()).toEqual(["0"])
    gsap.globalTimeline.timeScale(0.001)
    await user.click(button("Play"))
    await user.click(button("Step forward"))
    expect(button("Play")).toHaveAttribute("aria-pressed", "false")
    expect(bars()).toEqual(["0", "1"])
    await user.click(button("Show all"))
    expect(bars()).toEqual(["0", "1", "2", "3", "4"])
    expect(turn()).toBe("1")
  })

  it("plays and pauses with Space", async () => {
    prefer(false)
    const user = userEvent.setup()
    const { button } = await openPlayer()
    gsap.globalTimeline.timeScale(0.001)
    button("Step back").focus()
    await user.keyboard(" ")
    expect(button("Play")).toHaveAttribute("aria-pressed", "true")
    await user.keyboard(" ")
    expect(button("Play")).toHaveAttribute("aria-pressed", "false")
  })

  it("plays a turn per beat at the speed chosen", async () => {
    prefer(false)
    const user = userEvent.setup()
    const { player, button } = await openPlayer()
    gsap.globalTimeline.timeScale(0.001)
    const speed = within(player).getByRole("group", { name: "Speed" })
    expect(within(speed).getByRole("button", { name: "1×" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await user.click(within(speed).getByRole("button", { name: "2×" }))
    expect(within(speed).getByRole("button", { name: "2×" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await user.click(button("Play"))
    await waitFor(() => expect(running().some((t) => t.data === "beat")).toBe(true))
    const beat = running().find((t) => t.data === "beat")!
    expect(beat.delay()).toBeCloseTo(MOTION.turn / 2)
  })

  it("grows the bar reached under no preference, and sets it at once under reduced motion", async () => {
    prefer(false)
    const user = userEvent.setup()
    const first = await openPlayer()
    gsap.globalTimeline.timeScale(0.01)
    await user.click(first.button("Play"))
    const grown = () => [...first.chart.querySelectorAll('[data-turn="0"] rect[data-segment]')]
    await waitFor(() => expect(gsap.getTweensOf(grown()).length).toBeGreaterThan(0))
    first.unmount()

    prefer(true)
    gsap.globalTimeline.timeScale(4)
    const second = await openPlayer()
    await user.click(second.button("Play"))
    await waitFor(() => expect(second.turn()).toBe("1"))
    const rects = [...second.chart.querySelectorAll("rect[data-segment]")]
    expect(gsap.getTweensOf(rects)).toHaveLength(0)
    for (const rect of rects) expect(rect).not.toHaveAttribute("style")
  })

  it("leaves nothing on GSAP's clock after a route change, under Strict Mode", async () => {
    prefer(false)
    const user = userEvent.setup()
    const { button, turn, router } = await openPlayer("/sessions/refund-7", true)
    await user.click(button("Play"))
    await waitFor(() => expect(running().length).toBeGreaterThan(0))
    await waitFor(() => expect(turn()).toBe("1"))
    await act(() => router.navigate("/sessions"))
    await screen.findByRole("table", { name: "Sessions" })
    expect(running()).toHaveLength(0)
  })
})
