import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { SourcesReportV1 } from "@cwa-dashboard/telemetry/types"
import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

const report = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "sources.json"), "utf8"),
) as SourcesReportV1
const withReport = (doc: unknown) => ({
  overrides: { "/data/sources.json": { status: 200, body: JSON.stringify(doc) } },
})
const table = async () => screen.findByRole("table", { name: "Producers" })

describe("the sources page", () => {
  it("says which window, how many events and where from, and lists every producer", async () => {
    renderApp("/sources")
    expect(await screen.findByRole("heading", { level: 1, name: "Sources" })).toBeInTheDocument()
    const rows = within(await table())
      .getAllByRole("row")
      .slice(1)
    expect(rows).toHaveLength(report.producers.length)
    const status = screen.getByRole("status", { name: "Sources status" })
    expect(status).toHaveTextContent(`${report.producers.length} producers`)
    expect(status).toHaveTextContent(`${report.window.events} events`)
    expect(status).toHaveTextContent("/data")
  })

  it("shows a producer's counts, its kind in words, and each exclusion as a link to the stream", async () => {
    renderApp("/sources")
    const wiki = report.producers.find((p) => p.id === "wiki-corpus")!
    const row = within(await table())
      .getAllByRole("row")
      .find((r) => within(r).queryByText("wiki-corpus") !== null)!
    expect(row).toHaveTextContent(wiki.kind)
    for (const count of [wiki.events, wiki.submitted, wiki.admitted, wiki.included_tokens]) {
      expect(row).toHaveTextContent(String(count))
    }
    const [first] = wiki.excluded
    const link = within(row)
      .getAllByRole("link")
      .find((a) => a.textContent?.includes(first!.reason))!
    expect(link).toHaveAttribute("href", `/traces?reason=${first!.reason}`)
  })

  it("says tokens kept out are not available, and why, for every producer", async () => {
    renderApp("/sources")
    const rows = within(await table())
      .getAllByRole("row")
      .slice(1)
    for (const row of rows) expect(row).toHaveTextContent("Not available")
    expect(screen.getByRole("region", { name: "Tokens kept out" })).toHaveTextContent(
      /records no cost for an excluded item/,
    )
  })

  it("says when no producer sent anything in the window", async () => {
    renderApp(
      "/sources",
      withReport({ ...report, producers: [], window: { ...report.window, events: 0 } }),
    )
    expect(await screen.findByText(/No producer sent anything/)).toBeInTheDocument()
    expect(screen.queryByRole("table", { name: "Producers" })).not.toBeInTheDocument()
  })

  it("says when the report cannot be read, is of another kind, or is invalid", async () => {
    const { unmount } = renderApp("/sources", {
      overrides: { "/data/sources.json": { status: 503 } },
    })
    expect(await screen.findByRole("button", { name: /Retry/ })).toBeInTheDocument()
    unmount()
    const other = renderApp(
      "/sources",
      withReport({ ...report, $schema: "cwa-dashboard/sources-report/v9" }),
    )
    expect(await screen.findByText(/sources-report\/v9/)).toBeInTheDocument()
    other.unmount()
    renderApp("/sources", withReport({ ...report, producers: [{ id: "x" }] }))
    expect(await screen.findByText(/does not match its schema/)).toBeInTheDocument()
  })
})
