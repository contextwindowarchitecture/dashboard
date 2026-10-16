import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { gsap } from "../../../lib/motion"
import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { prefer, running, withMotionClock } from "../../../test/motion"
import { renderApp } from "../../../test/render-app"
import { excludedByStage } from "../model/inspector"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const load = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "events", `${id}.json`), "utf8")) as AssemblyEventV1
const twoStages = index.events.find(
  (row) => row.outcome === "assembled" && excludedByStage(load(row.event_id)).length >= 2,
)!.event_id

withMotionClock()

async function openWalk(strict = false) {
  const app = renderApp(`/traces/${twoStages}?tab=excluded`, {}, { strict })
  const panel = await screen.findByRole("tabpanel", { name: "Excluded" })
  const walk = within(panel).getByRole("group", { name: "Stage walk" })
  const all = within(panel)
    .getAllByRole("heading", { level: 3 })
    .map((h) => h.textContent)
  const current = () =>
    within(panel)
      .queryAllByRole("heading", { level: 3 })
      .filter((h) => h.getAttribute("aria-current") === "step")
      .map((h) => h.textContent)
  const button = (name: string) => within(walk).getByRole("button", { name })
  const rows = () => [...panel.querySelectorAll('[data-current] [data-slot="excluded-row"]')]
  return { ...app, panel, walk, all, current, button, rows }
}

describe("the played stage walk", () => {
  it("plays one stage per turn from the first, and stops at the last", async () => {
    prefer(false)
    const user = userEvent.setup()
    const { all, current, button } = await openWalk()
    expect(button("Play")).toHaveAttribute("aria-pressed", "false")
    expect(button("Pause")).toHaveAttribute("aria-pressed", "true")
    await user.click(button("Play"))
    expect(button("Play")).toHaveAttribute("aria-pressed", "true")
    expect(button("Pause")).toHaveAttribute("aria-pressed", "false")
    expect(current()).toEqual([all[0]])
    await waitFor(() => expect(current()).toEqual([all[1]]))
    await waitFor(() => expect(current()).toEqual([all.at(-1)]))
    await waitFor(() => expect(button("Play")).toHaveAttribute("aria-pressed", "false"))
    expect(current()).toEqual([all.at(-1)])
  })

  it("holds the stage while paused, and stepping pauses", async () => {
    prefer(false)
    const user = userEvent.setup()
    const { all, current, button } = await openWalk()
    // Nearly stopped while the controls are pressed, then far faster than a turn once paused.
    gsap.globalTimeline.timeScale(0.001)
    await user.click(button("Play"))
    await user.click(button("Pause"))
    gsap.globalTimeline.timeScale(1000)
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(current()).toEqual([all[0]])
    gsap.globalTimeline.timeScale(0.001)
    await user.click(button("Play"))
    await user.click(button("Step forward"))
    expect(button("Play")).toHaveAttribute("aria-pressed", "false")
    expect(current()).toEqual([all[1]])
  })

  it("plays and pauses with Space, without also pressing the focused control", async () => {
    prefer(false)
    const user = userEvent.setup()
    const { all, current, button } = await openWalk()
    button("Step forward").focus()
    await user.keyboard(" ")
    expect(button("Play")).toHaveAttribute("aria-pressed", "true")
    expect(current()).toEqual([all[0]])
    await user.keyboard(" ")
    expect(button("Play")).toHaveAttribute("aria-pressed", "false")
  })

  it("tweens the rows of the stage reached", async () => {
    prefer(false)
    const user = userEvent.setup()
    const { button, rows } = await openWalk()
    // Slowed, so the tween is still running when it is looked for.
    gsap.globalTimeline.timeScale(0.01)
    await user.click(button("Step forward"))
    await waitFor(() => expect(gsap.getTweensOf(rows()).length).toBeGreaterThan(0))
  })

  it("sets every step at once under reduced motion, the controls kept", async () => {
    prefer(true)
    const user = userEvent.setup()
    const { all, current, button, rows } = await openWalk()
    await user.click(button("Play"))
    await waitFor(() => expect(current()).toEqual([all[1]]))
    expect(gsap.getTweensOf(rows())).toHaveLength(0)
    for (const row of rows()) expect(row).not.toHaveAttribute("style")
  })

  it("leaves no timeline running after a route change, under Strict Mode", async () => {
    prefer(false)
    const user = userEvent.setup()
    const { all, current, button, router } = await openWalk(true)
    await user.click(button("Play"))
    await waitFor(() => expect(running().length).toBeGreaterThan(0))
    await waitFor(() => expect(current()).toEqual([all[1]]))
    await act(() => router.navigate("/traces"))
    await screen.findByRole("heading", { level: 1, name: "Trace stream" })
    expect(running()).toHaveLength(0)
  })
})
