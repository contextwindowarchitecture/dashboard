import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { act, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../test/fixture-fetch"
import { renderApp } from "../../test/render-app"
import { GUARDRAILS, guardrailCounts } from "../guardrails/model/guardrails"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1

describe("the overview", () => {
  it("is the home page, current in the sidebar", async () => {
    renderApp("/")
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe("Overview — CWA dashboard"))
    const nav = screen.getByRole("navigation", { name: "Dashboard" })
    expect(within(nav).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })

  it("shows the window's metrics, each naming its unit and window", async () => {
    renderApp("/")
    const metrics = await screen.findByRole("list", { name: "Metrics" })
    const assemblies = within(metrics).getByRole("listitem", { name: "Assemblies" })
    expect(assemblies).toHaveTextContent(String(index.events.length))
    expect(assemblies).toHaveTextContent("this window")
    expect(within(metrics).getByRole("listitem", { name: "Refusal rate" })).toHaveTextContent("%")
    expect(within(metrics).getByRole("listitem", { name: "Refusal rate" })).toHaveTextContent(
      "no earlier window",
    )
  })

  it("shows the seven guardrails with their counts, codes linking to the stream, and what each count does not show", async () => {
    renderApp("/")
    const counts = guardrailCounts(index.events)
    const grid = await screen.findByRole("list", { name: "Guardrails" })
    const cards = within(grid)
      .getAllByRole("listitem")
      .filter((item) => item.parentElement === grid)
    expect(cards).toHaveLength(7)
    GUARDRAILS.forEach((guardrail, i) => {
      const card = cards[i]!
      expect(card).toHaveTextContent(`${guardrail.number} · ${guardrail.name}`)
      expect(card).toHaveTextContent(guardrail.story)
      expect(card).toHaveTextContent(guardrail.caveat)
      const count = counts.get(guardrail.number)
      expect(card).toHaveTextContent(count === undefined ? "Not available" : `${count} event`)
      for (const code of guardrail.codes) {
        expect(within(card).getByRole("link", { name: new RegExp(`^${code}`) })).toHaveAttribute(
          "href",
          `/traces?reason=${encodeURIComponent(code)}`,
        )
      }
    })
  })

  it("opens the stream filtered by a guardrail's code", async () => {
    const { router } = renderApp("/")
    await screen.findByRole("list", { name: "Guardrails" })
    await act(() => router.navigate("/traces?reason=over_budget"))
    const status = await screen.findByRole("status", { name: "Stream status" })
    expect(status).toHaveTextContent(
      `${index.facets.reason["over_budget"]} of ${index.events.length} events`,
    )
  })

  it("lists the latest refusals and rejections, linking to each", async () => {
    renderApp("/")
    const table = await screen.findByRole("table", { name: "Latest refusals and rejections" })
    const rows = within(table).getAllByRole("row").slice(1)
    const expected = index.events.filter((row) => row.outcome !== "assembled").slice(0, 10)
    expect(rows).toHaveLength(expected.length)
    expect(within(rows[0]!).getByRole("link", { name: expected[0]!.event_id })).toHaveAttribute(
      "href",
      `/traces/${expected[0]!.event_id}`,
    )
  })
})
