import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { renderApp } from "../../../test/render-app"

const table = () => screen.findByRole("table", { name: "Routes" })
const routeRow = async (route: string) =>
  within(await table())
    .getAllByRole("row")
    .find((row) => within(row).queryByText(route) !== null)!

describe("the FinOps page", () => {
  it("shows tokens per route, and money as Not available, naming the setting, without prices", async () => {
    renderApp("/finops")
    expect(await screen.findByRole("heading", { level: 1, name: "FinOps" })).toBeInTheDocument()
    const row = await routeRow("support-chat")
    expect(within(row).getAllByText("Not available").length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole("region", { name: "Prices" })).toHaveTextContent(
      "prices.per_million_input_tokens",
    )
    expect(screen.getByRole("status", { name: "FinOps status" })).toHaveTextContent("/data")
  })

  it("prices a route the configuration prices, in its currency, and no other", async () => {
    renderApp(
      "/finops",
      {},
      {
        config: {
          dataRoot: "/data",
          source: "file",
          prices: { currency: "EUR", per_million_input_tokens: { "support-chat": 3 } },
        },
      },
    )
    const chat = await routeRow("support-chat")
    expect(chat).toHaveTextContent("€")
    expect(
      within(await routeRow("document-qa")).getAllByText("Not available").length,
    ).toBeGreaterThan(0)
    expect(screen.queryByRole("region", { name: "Prices" })).not.toBeInTheDocument()
  })

  it("says what no trace can measure: tokens kept out, and the provider's cache", async () => {
    renderApp("/finops")
    const notes = await screen.findByRole("region", { name: "Not measured" })
    expect(notes).toHaveTextContent(/no cost for an excluded item/)
    expect(notes).toHaveTextContent(/RFC-D2/)
  })

  it("says when nothing was assembled in the window, and when the index cannot be read", async () => {
    const { unmount } = renderApp("/finops", {
      overrides: {
        "/data/events/index.json": {
          status: 200,
          body: JSON.stringify({
            $schema: "cwa-dashboard/events-index/v1",
            generated_at: "2026-10-17T00:00:00.000Z",
            window: { from: "2026-10-17T00:00:00.000Z", to: "2026-10-17T00:00:00.000Z" },
            events: [],
            facets: { outcome: {}, language: {}, route: {}, reason: {}, service: {} },
          }),
        },
      },
    })
    expect(await screen.findByText(/Nothing was assembled in this window/)).toBeInTheDocument()
    unmount()
    renderApp("/finops", { overrides: { "/data/events/index.json": { status: 503 } } })
    expect(await screen.findByRole("button", { name: /Retry/ })).toBeInTheDocument()
  })
})
