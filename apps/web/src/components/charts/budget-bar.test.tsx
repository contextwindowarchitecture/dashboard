import { readFileSync } from "node:fs"
import { join } from "node:path"

import { MODEL } from "@cwa-dashboard/contract/data"
import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { placementRows, planeTotals } from "../../features/traces/model/inspector"
import { FIXTURES_DIR } from "../../test/fixture-fetch"
import { renderApp } from "../../test/render-app"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const load = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "events", `${id}.json`), "utf8")) as AssemblyEventV1
const bySession = (session: string, turn: number) =>
  index.events.find((row) => row.session?.id === session && row.session.turn_index === turn)!
    .event_id
const tokens = (n: number) => n.toLocaleString("en-US")

describe("the budget bar", () => {
  it("is an image named by its title and a summary of what the budget held", async () => {
    const id = bySession("refund-7", 4)
    const event = load(id)
    renderApp(`/traces/${id}`)
    const bar = await screen.findByRole("img", { name: /Budget/ })
    expect(bar).toHaveAccessibleName(
      expect.stringContaining(
        `${tokens(event.trace!.result!.input_tokens)} of ${tokens(event.snapshot!.budget.input)} tokens used`,
      ),
    )
    expect(bar).toHaveAccessibleName(
      expect.stringContaining(
        `${tokens(event.snapshot!.budget.reserved_output)} tokens reserved for output`,
      ),
    )
  })

  it("has a table of the same numbers beneath it, by the contract's plane names", async () => {
    const id = bySession("refund-7", 4)
    const totals = planeTotals(load(id).trace!)
    renderApp(`/traces/${id}`)
    const table = await screen.findByRole("table", { name: "Budget by plane" })
    for (const plane of MODEL.planes) {
      const short = (["gov", "state", "evid", "inter"] as const).find((key) =>
        plane.id.startsWith(key),
      )!
      const row = within(table).getByRole("row", { name: new RegExp(`^${plane.name}`) })
      expect(row).toHaveTextContent(tokens(totals.byPlane[short]))
    }
    expect(within(table).getByRole("row", { name: /^Rendering overhead/ })).toHaveTextContent(
      tokens(totals.overhead!),
    )
  })

  it("says a refusal rendered nothing", async () => {
    renderApp(`/traces/${bySession("intake-12", 2)}`)
    expect(await screen.findByRole("img", { name: /Budget/ })).toHaveAccessibleName(
      expect.stringContaining("The assembly refused: nothing was rendered"),
    )
  })
})

describe("the placement strip", () => {
  it("lists the profile's placements in order, each with its wrap and tokens", async () => {
    const id = bySession("refund-7", 4)
    const rows = placementRows(load(id))
    renderApp(`/traces/${id}`)
    const strip = await screen.findByRole("list", { name: "Placement" })
    const chips = within(strip).getAllByRole("listitem")
    expect(chips).toHaveLength(rows.placed.length + rows.unplaced.length)
    rows.placed.forEach((placement, i) => {
      expect(chips[i]).toHaveTextContent(placement.slot)
      expect(chips[i]).toHaveTextContent(placement.wrap)
      expect(chips[i]).toHaveTextContent(
        tokens(placement.occurrences.reduce((sum, o) => sum + o.tokens, 0)),
      )
    })
  })
})
