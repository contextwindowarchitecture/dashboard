import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"
import { excludedByStage } from "../model/inspector"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const load = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "events", `${id}.json`), "utf8")) as AssemblyEventV1

// An assembled event whose rows fall under at least two stages, and a refused one with rows.
const twoStages = index.events.find(
  (row) => row.outcome === "assembled" && excludedByStage(load(row.event_id)).length >= 2,
)!.event_id
const refusedWithRows = index.events.find(
  (row) => row.outcome === "refused" && row.reason_codes.length > 0,
)!.event_id
const quiet = index.events.find(
  (row) => row.outcome === "assembled" && row.reason_codes.length === 0,
)!.event_id

async function openExcluded(path: string) {
  const app = renderApp(path)
  const panel = await screen.findByRole("tabpanel", { name: "Excluded" })
  return { ...app, panel }
}
const headings = (panel: HTMLElement) =>
  within(panel)
    .queryAllByRole("heading", { level: 3 })
    .map((h) => h.textContent)
const current = (panel: HTMLElement) =>
  within(panel)
    .queryAllByRole("heading", { level: 3 })
    .filter((h) => h.getAttribute("aria-current") === "step")
    .map((h) => h.textContent)

describe("the stage walk", () => {
  it("is offered only where the trace has stages to walk", async () => {
    const { panel } = await openExcluded(`/traces/${quiet}?tab=excluded`)
    expect(within(panel).queryByRole("group", { name: "Stage walk" })).toBeNull()
  })

  it("steps through the stages, showing those reached, with the current one in the URL", async () => {
    const user = userEvent.setup()
    const { panel, router } = await openExcluded(`/traces/${twoStages}?tab=excluded`)
    const all = headings(panel)
    const walk = within(panel).getByRole("group", { name: "Stage walk" })
    expect(within(walk).getByRole("button", { name: "Step back" })).toHaveAttribute(
      "aria-disabled",
      "true",
    )

    await user.click(within(walk).getByRole("button", { name: "Step forward" }))
    expect(headings(panel)).toEqual(all.slice(0, 1))
    expect(current(panel)).toEqual(all.slice(0, 1))
    const first = excludedByStage(load(twoStages))[0]!.stage
    expect(new URLSearchParams(router.state.location.search).get("stage")).toBe(first)
    expect(within(walk).getByRole("status")).toHaveTextContent(
      `Stage 1 of ${all.length}: ${all[0]}`,
    )

    await user.click(within(walk).getByRole("button", { name: "Step forward" }))
    expect(headings(panel)).toEqual(all.slice(0, 2))
    expect(current(panel)).toEqual([all[1]])

    await user.click(within(walk).getByRole("button", { name: "Step back" }))
    expect(headings(panel)).toEqual(all.slice(0, 1))

    await user.click(within(walk).getByRole("button", { name: "Show all" }))
    expect(headings(panel)).toEqual(all)
    expect(current(panel)).toEqual([])
    expect(new URLSearchParams(router.state.location.search).get("stage")).toBeNull()
  })

  it("opens at the stage the URL names, and shows everything for a stage the trace does not have", async () => {
    const stages = excludedByStage(load(twoStages))
    const first = await openExcluded(`/traces/${twoStages}?tab=excluded&stage=${stages[1]!.stage}`)
    const { panel } = first
    expect(current(panel)).toHaveLength(1)
    expect(headings(panel)).toHaveLength(2)

    first.unmount()
    const other = await openExcluded(`/traces/${quiet}?tab=excluded&stage=fitting`)
    expect(current(other.panel)).toEqual([])
  })

  it("steps with the arrow keys", async () => {
    const user = userEvent.setup()
    const { panel } = await openExcluded(`/traces/${twoStages}?tab=excluded`)
    const all = headings(panel)
    within(panel).getByRole("button", { name: "Step forward" }).focus()
    await user.keyboard("{ArrowRight}{ArrowRight}")
    expect(current(panel)).toEqual([all[1]])
    await user.keyboard("{ArrowLeft}")
    expect(current(panel)).toEqual([all[0]])
  })

  it("ends a refused trace on its refusal, after every stage", async () => {
    const user = userEvent.setup()
    const event = load(refusedWithRows)
    const { panel } = await openExcluded(`/traces/${refusedWithRows}?tab=excluded`)
    const all = headings(panel)
    const forward = within(panel).getByRole("button", { name: "Step forward" })
    for (let i = 0; i <= all.length; i += 1) await user.click(forward)
    expect(forward).toHaveAttribute("aria-disabled", "true")
    expect(headings(panel)).toEqual(all)
    const refusal = within(panel).getByRole("region", { name: "Refusal" })
    expect(refusal).toHaveTextContent(event.trace!.refused.reason!)
    expect(within(panel).getByRole("status")).toHaveTextContent(
      `Refused: ${event.trace!.refused.reason!}`,
    )
  })
})
