import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"
import { sessionRows } from "../model/sessions-list"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1

async function openList() {
  renderApp("/sessions")
  return screen.findByRole("table", { name: "Sessions" })
}
const rowOf = (table: HTMLElement, id: string) =>
  within(table).getByRole("link", { name: id }).closest("tr")!

describe("the sessions list", () => {
  it("lists every session, newest first, each linked to its page", async () => {
    const table = await openList()
    const links = within(table).getAllByRole("link")
    expect(links.map((l) => l.textContent)).toEqual(sessionRows(index.events).map((r) => r.id))
    expect(links[0]).toHaveAttribute("href", `/sessions/${links[0]!.textContent}`)
  })

  it("says each session's outcomes in words beside the strip", async () => {
    const table = await openList()
    expect(rowOf(table, "intake-12")).toHaveTextContent("2 assembled · 1 refused")
    expect(rowOf(table, "fixture-c1")).toHaveTextContent("1 assembled · 1 rejected")
  })

  it("names the turn of the first inflection and what it was", async () => {
    const table = await openList()
    expect(rowOf(table, "refund-7")).toHaveTextContent("turn 3 · over_budget")
    expect(rowOf(table, "desk-agent-12")).toHaveTextContent("turn 0 · refused")
    expect(rowOf(table, "agent-run-412")).toHaveTextContent("none")
  })

  it("reads part reuse from each session's document, and says when none could be compared", async () => {
    const table = await openList()
    await waitFor(() =>
      expect(rowOf(table, "refund-7")).toHaveTextContent("25 of 66 parts · 4 turns compared"),
    )
    await waitFor(() => expect(rowOf(table, "fixture-c1")).toHaveTextContent("Not available"))
  })

  it("says when the index holds no session", async () => {
    renderApp("/sessions", {
      overrides: {
        "/data/events/index.json": {
          status: 200,
          body: JSON.stringify({
            ...index,
            events: index.events.filter((row) => row.session === undefined),
          }),
        },
      },
    })
    expect(await screen.findByRole("heading", { name: "No sessions yet" })).toBeInTheDocument()
  })

  it("is in the navigation, current on the list and on a session", async () => {
    renderApp("/sessions")
    const nav = await screen.findByRole("navigation", { name: "Dashboard" })
    expect(within(nav).getByRole("link", { name: "Sessions" })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })
})
