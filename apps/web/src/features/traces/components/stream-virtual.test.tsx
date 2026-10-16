import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

const demo = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1

// A large index from the demo's rows under new ids, newest first, so the stream has more than it draws.
function large(count: number): EventsIndexV1 {
  const events = Array.from({ length: count }, (_, i) => ({
    ...demo.events[i % demo.events.length]!,
    event_id: `01MZ${String(count - i).padStart(22, "0")}`,
    recorded_at: new Date(Date.parse("2026-10-15T12:00:00.000Z") - i * 1000).toISOString(),
  }))
  return { ...demo, events }
}
const withIndex = (index: EventsIndexV1) => ({
  overrides: { "/data/events/index.json": { status: 200, body: JSON.stringify(index) } },
})

describe("the stream at volume", () => {
  it("draws only the rows near the view when the window holds more than 500, and says how many there are", async () => {
    renderApp("/traces", withIndex(large(1000)))
    const table = await screen.findByRole("table", { name: "Trace stream" })
    await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(1))
    const drawn = within(table)
      .getAllByRole("row")
      .filter((r) => r.hasAttribute("aria-rowindex"))
    expect(drawn.length).toBeGreaterThan(5)
    expect(drawn.length).toBeLessThan(100)
    expect(table).toHaveAttribute("aria-rowcount", "1001")
    expect(drawn[0]).toHaveAttribute("aria-rowindex", "2")
    expect(screen.getByRole("status", { name: "Stream status" })).toHaveTextContent(
      "1,000 of 1,000 events",
    )
  })

  it("draws the rows the reader scrolls to", async () => {
    renderApp("/traces", withIndex(large(1000)))
    const table = await screen.findByRole("table", { name: "Trace stream" })
    await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(1))
    await act(async () => {
      Object.defineProperty(window, "scrollY", { configurable: true, value: 44 * 990 })
      fireEvent.scroll(window)
    })
    await waitFor(() =>
      expect(
        within(table).getByRole("link", { name: `01MZ${"1".padStart(22, "0")}` }),
      ).toBeInTheDocument(),
    )
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 })
  })

  it("draws every row of a window of 500 or fewer, as before", async () => {
    renderApp("/traces", withIndex(large(500)))
    const table = await screen.findByRole("table", { name: "Trace stream" })
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(501))
    expect(table).not.toHaveAttribute("aria-rowcount")
  })
})
