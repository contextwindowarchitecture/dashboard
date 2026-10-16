import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { RegionState } from "../../data/region"
import { DataRegion } from "./data-region"

function show(region: RegionState<{ rows: number }>) {
  return render(
    <DataRegion
      region={region}
      label="the trace stream"
      empty={{ title: "No events yet", body: "Nothing has been recorded." }}
    >
      {(data) => <p>{data.rows} rows</p>}
    </DataRegion>,
  )
}

// STYLE.md 6, Data regions: every state told apart by words, never by colour alone.
describe("DataRegion", () => {
  it("is a still placeholder while loading, announced as loading", () => {
    show({ status: "loading" })
    expect(screen.getByRole("status")).toHaveAccessibleName("Loading the trace stream…")
  })

  it("says what failed and offers a retry", async () => {
    const retry = vi.fn()
    show({ status: "error", error: new Error("/data/events/index.json answered 503"), retry })
    expect(screen.getByRole("alert")).toHaveTextContent("/data/events/index.json answered 503")
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it("says a listed document is not there", () => {
    show({ status: "not-found", what: "Event 01JA2B3C4D5E6F7G8H9JKMNPQR" })
    expect(screen.getByText("Event 01JA2B3C4D5E6F7G8H9JKMNPQR is not there.")).toBeInTheDocument()
  })

  it("names the schema of a document it cannot read", () => {
    show({
      status: "unsupported",
      schema: "cwa-dashboard/events-index/v2",
      path: "/data/events/index.json",
    })
    const note = screen.getByRole("alert")
    expect(note).toHaveTextContent("cwa-dashboard/events-index/v2")
    expect(note).toHaveTextContent("/data/events/index.json")
    show({ status: "unsupported", schema: null, path: "/data/fleet.json" })
    expect(screen.getAllByRole("alert")[1]).toHaveTextContent("no $schema")
  })

  it("lists the first problems of an invalid document, and how many more", () => {
    const issues = Array.from(
      { length: 8 },
      (_, i) => `/events/${i}/outcome must be equal to one of the allowed values`,
    )
    show({ status: "invalid", issues, path: "/data/events/index.json" })
    const note = screen.getByRole("alert")
    expect(note).toHaveTextContent("/events/0/outcome")
    expect(note).toHaveTextContent("/events/4/outcome")
    expect(note).not.toHaveTextContent("/events/5/outcome")
    expect(note).toHaveTextContent("and 3 more")
  })

  it("says the region is empty in its own words", () => {
    show({ status: "empty", data: { rows: 0 } })
    expect(screen.getByRole("heading", { level: 3, name: "No events yet" })).toBeInTheDocument()
    expect(screen.getByText("Nothing has been recorded.")).toBeInTheDocument()
  })

  it("renders the data when it has it", () => {
    show({ status: "ok", data: { rows: 111 }, updating: false })
    expect(screen.getByText("111 rows")).toBeInTheDocument()
  })
})
