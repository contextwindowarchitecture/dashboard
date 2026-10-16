import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { AssemblyEventV1, SessionV1 } from "@cwa-dashboard/telemetry/types"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

const session = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "sessions", `${id}.json`), "utf8")) as SessionV1
const event = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "events", `${id}.json`), "utf8")) as AssemblyEventV1
const turnEvent = (id: string, turn: number) =>
  event(session(id).turns.find((t) => t.turn_index === turn)!.event_id)

async function open(path: string, options = {}) {
  const app = renderApp(path, options)
  const chart = await screen.findByRole("img", { name: /turns/ })
  return { ...app, chart }
}
const detail = () => screen.findByRole("region", { name: /^Turn \d+$/ })
const search = (router: { state: { location: { search: string } } }) =>
  new URLSearchParams(router.state.location.search)

describe("the session page", () => {
  it("draws one bar per turn, and says what the chart shows in words", async () => {
    const { chart } = await open("/sessions/refund-7")
    expect(chart.querySelectorAll("[data-turn]")).toHaveLength(5)
    expect(chart).toHaveAccessibleName(expect.stringContaining("5 turns"))
    expect(chart).toHaveAccessibleName(expect.stringContaining("720 tokens"))
    expect(chart).toHaveAccessibleName(expect.stringContaining("over_budget at turn 3"))
    expect(chart).toHaveAccessibleName(expect.stringContaining("compressed at turn 4"))
  })

  it("lists every turn beneath the chart, with its tokens by plane", async () => {
    await open("/sessions/refund-7")
    const table = screen.getByRole("table", { name: "Turns" })
    const rows = within(table).getAllByRole("row").slice(1)
    expect(rows).toHaveLength(5)
    const first = session("refund-7").turns[0]!
    expect(rows[0]).toHaveTextContent(String(first.by_plane!.gov))
    expect(rows[0]).toHaveTextContent(String(first.input_tokens))
  })

  it("shows the last turn by default, and the turn the URL names", async () => {
    await open("/sessions/refund-7")
    expect(await detail()).toHaveAccessibleName("Turn 4")
  })

  it("selects a turn from the table, puts it in the URL, and the detail follows", async () => {
    const user = userEvent.setup()
    const { router } = await open("/sessions/refund-7")
    const table = screen.getByRole("table", { name: "Turns" })
    await user.click(within(table).getByRole("link", { name: "Turn 3" }))
    expect(search(router).get("turn")).toBe("3")
    expect(within(table).getByRole("link", { name: "Turn 3" })).toHaveAttribute(
      "aria-current",
      "true",
    )
    const region = await detail()
    expect(region).toHaveAccessibleName("Turn 3")
    const omitted = turnEvent("refund-7", 3).trace!.excluded.filter(
      (r) => r.reason === "over_budget",
    )
    for (const row of omitted)
      expect(await within(region).findByText(row.item_id)).toBeInTheDocument()
  })

  it("lists a turn's compressions with their tokens before and after", async () => {
    await open("/sessions/refund-7?turn=4")
    const region = await detail()
    const [row] = turnEvent("refund-7", 4).trace!.compressed
    const item = await within(region).findByText(row!.item_id)
    expect(item.closest("li")).toHaveTextContent(`${row!.from} → ${row!.to}`)
  })

  it("names a refused turn's code, and links every turn to the inspector", async () => {
    await open("/sessions/intake-12?turn=2")
    const region = await detail()
    const refused = turnEvent("intake-12", 2)
    expect(region).toHaveTextContent(refused.trace!.refused.reason!)
    expect(within(region).getByRole("link", { name: "Open in the inspector" })).toHaveAttribute(
      "href",
      `/traces/${refused.event_id}`,
    )
  })

  it("falls back to the last turn for a turn the session does not have", async () => {
    await open("/sessions/refund-7?turn=99")
    expect(await detail()).toHaveAccessibleName("Turn 4")
  })

  it("keeps the page when one turn's event is missing, and says so in its detail", async () => {
    const id = session("refund-7").turns[4]!.event_id
    await open("/sessions/refund-7", {
      overrides: { [`/data/events/${id}.json`]: { status: 404 } },
    })
    const region = await detail()
    await waitFor(() => expect(region).toHaveTextContent(`Event ${id} is not there`))
    expect(screen.getByRole("table", { name: "Turns" })).toBeInTheDocument()
  })

  it("says part reuse is not available when no turn could be compared", async () => {
    await open("/sessions/fixture-c1")
    expect(screen.getByRole("list", { name: "Session facts" })).toHaveTextContent(
      "part reuse Not available",
    )
  })

  it("says a session that does not exist was not found", async () => {
    renderApp("/sessions/no-such-session")
    expect(await screen.findByText(/Session no-such-session is not there/)).toBeInTheDocument()
  })
})
