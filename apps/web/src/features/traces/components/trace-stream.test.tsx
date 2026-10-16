import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const total = index.events.length
const rowsOf = async () => {
  const table = await screen.findByRole("table", { name: /Trace stream/ })
  return within(table).getAllByRole("row").slice(1)
}

describe("the trace stream", () => {
  it("lists every event of the window, newest first, saying how many and from where", async () => {
    renderApp("/traces")
    expect(await rowsOf()).toHaveLength(total)
    expect(screen.getByRole("status", { name: "Stream status" })).toHaveTextContent(
      `${total} of ${total} events`,
    )
    expect(screen.getByRole("status", { name: "Stream status" })).toHaveTextContent("/data")
    const first = index.events[0]!
    expect((await rowsOf())[0]).toHaveTextContent(first.event_id)
  })

  it("links each event to its inspector", async () => {
    renderApp("/traces")
    const first = index.events[0]!
    const link = within((await rowsOf())[0]!).getByRole("link", { name: first.event_id })
    expect(link).toHaveAttribute("href", `/traces/${first.event_id}`)
  })

  it("shows each outcome in words, and Not available where a row has no tokens", async () => {
    renderApp("/traces?outcome=rejected")
    const rows = await rowsOf()
    expect(rows).toHaveLength(index.facets.outcome["rejected"]!)
    for (const row of rows) {
      expect(row).toHaveTextContent(/rejected · \d+ problems?/)
      expect(row).toHaveTextContent("Not available")
    }
  })

  it("shows the first three reason codes and how many more", async () => {
    const busy = index.events.find((row) => row.reason_codes.length > 3)!
    renderApp("/traces")
    const row = (await rowsOf()).find((r) => r.textContent?.includes(busy.event_id))!
    for (const code of busy.reason_codes.slice(0, 3)) expect(row).toHaveTextContent(code)
    expect(row).toHaveTextContent(`+${busy.reason_codes.length - 3} more`)
  })

  it("filters from the URL, and changes the URL when a filter is chosen", async () => {
    const { router } = renderApp("/traces")
    await rowsOf()
    await userEvent.click(screen.getByRole("combobox", { name: "Outcome" }))
    await userEvent.click(await screen.findByRole("option", { name: /^refused/ }))
    await waitFor(() => expect(router.state.location.search).toBe("?outcome=refused"))
    const rows = await rowsOf()
    expect(rows).toHaveLength(index.facets.outcome["refused"]!)
    expect(screen.getByRole("status", { name: "Stream status" })).toHaveTextContent(
      `${rows.length} of ${total} events`,
    )
  })

  it("says when the filters match nothing, and clears them", async () => {
    const { router } = renderApp("/traces?route=nowhere&outcome=refused")
    expect(
      await screen.findByRole("heading", { level: 3, name: "No events match these filters" }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }))
    await waitFor(() => expect(router.state.location.search).toBe(""))
    expect(await rowsOf()).toHaveLength(total)
  })

  it("says when there are no events at all, apart from no results", async () => {
    renderApp("/traces", {
      overrides: {
        "/data/events/index.json": {
          status: 200,
          body: JSON.stringify({
            ...index,
            events: [],
            facets: { outcome: {}, language: {}, route: {}, reason: {}, service: {} },
          }),
        },
      },
    })
    expect(
      await screen.findByRole("heading", { level: 3, name: "No events yet" }),
    ).toBeInTheDocument()
  })

  it("says when the index cannot be read, with a retry", async () => {
    renderApp("/traces", { overrides: { "/data/events/index.json": { status: 503 } } })
    expect(await screen.findByRole("alert")).toHaveTextContent("503")
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })
})
