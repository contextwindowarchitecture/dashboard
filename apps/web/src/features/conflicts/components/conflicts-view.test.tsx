import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"
import { conflictEvents, conflictForest } from "../model/conflicts"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const { rows, counts } = conflictEvents(index)
const CHAIN = "01M4YZT6M0TMR0MJ171Q2W6C1M"
const event = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "events", `${id}.json`), "utf8")) as AssemblyEventV1

describe("the conflicts page", () => {
  it("lists the window's events that resolved one item against another, with each code's count", async () => {
    renderApp("/conflicts")
    expect(await screen.findByRole("heading", { level: 1, name: "Conflicts" })).toBeInTheDocument()
    const table = await screen.findByRole("table", { name: "Events" })
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(rows.length)
    const status = screen.getByRole("status", { name: "Conflicts status" })
    expect(status).toHaveTextContent(`${rows.length} of ${index.events.length} events`)
    expect(status).toHaveTextContent("/data")
    const list = screen.getByRole("list", { name: "Codes" })
    for (const { code, events } of counts) {
      const link = within(list).getByRole("link", { name: new RegExp(`^${code}`) })
      expect(link).toHaveAttribute("href", `/traces?reason=${code}`)
      expect(link).toHaveTextContent(String(events))
    }
  })

  it("draws a chosen event's forest, with its links and groups as tables", async () => {
    const { router } = renderApp("/conflicts")
    const table = await screen.findByRole("table", { name: "Events" })
    const user = userEvent.setup()
    await user.click(within(table).getByRole("link", { name: CHAIN }))
    await waitFor(() => expect(router.state.location.search).toBe(`?event=${CHAIN}`))
    const forest = conflictForest(event(CHAIN))
    const chart = await screen.findByRole("img", { name: /Conflict forest/ })
    expect(chart).toHaveAccessibleName(expect.stringContaining(`${forest.edges.length} links`))
    const links = screen.getByRole("table", { name: "Links" })
    expect(within(links).getAllByRole("row").slice(1)).toHaveLength(forest.edges.length)
    expect(links).toHaveTextContent("wiki:refund-paraphrase")
    expect(links).toHaveTextContent("duplicate_content")
    expect(screen.getByRole("link", { name: /Open in the inspector/ })).toHaveAttribute(
      "href",
      `/traces/${CHAIN}?tab=conflicts`,
    )
  })

  it("shows an event's conflict groups, a group with no winner said so", async () => {
    renderApp("/conflicts?event=01M4YYZN0GKV7ZPC9NYXPXTX31")
    const groups = await screen.findByRole("table", { name: "Conflict groups" })
    expect(groups).toHaveTextContent("g-cite")
    expect(groups).toHaveTextContent("surfaced")
    expect(groups).toHaveTextContent("no winner")
  })

  it("says when no event in the window resolved anything", async () => {
    const quiet = { ...index, events: index.events.filter((r) => !rows.includes(r)) }
    renderApp("/conflicts", {
      overrides: { "/data/events/index.json": { status: 200, body: JSON.stringify(quiet) } },
    })
    expect(await screen.findByText(/No item was resolved against another/)).toBeInTheDocument()
    expect(screen.queryByRole("table", { name: "Events" })).not.toBeInTheDocument()
  })

  it("says a chosen event is not there", async () => {
    renderApp("/conflicts?event=01M5ZZZZZZZZZZZZZZZZZZZZZY")
    expect(await screen.findByText(/01M5ZZZZZZZZZZZZZZZZZZZZZY is not there/)).toBeInTheDocument()
  })

  it("draws no forest for a trace whose links loop, and says so, keeping the tables", async () => {
    const looped = event(CHAIN)
    looped.trace!.excluded.push({
      item_id: "kb:a",
      reason: "duplicate_content",
      stage: "assembler",
      duplicate_of: "wiki:refund",
    })
    renderApp(`/conflicts?event=${CHAIN}`, {
      overrides: { [`/data/events/${CHAIN}.json`]: { status: 200, body: JSON.stringify(looped) } },
    })
    expect(await screen.findByText(/links loop/)).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: /Conflict forest/ })).not.toBeInTheDocument()
    expect(screen.getByRole("table", { name: "Links" })).toBeInTheDocument()
  })
})
