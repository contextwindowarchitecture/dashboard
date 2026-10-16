import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { FleetReportV1 } from "@cwa-dashboard/telemetry/types"
import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

const fleet = JSON.parse(readFileSync(join(FIXTURES_DIR, "fleet.json"), "utf8")) as FleetReportV1
const short = (commit: string) => commit.slice(0, 7)
const lock = short(fleet.contract.commit)
const withFleet = (doc: unknown) => ({
  overrides: { "/data/fleet.json": { status: 200, body: JSON.stringify(doc) } },
})

describe("the fleet page", () => {
  it("counts each implementation's conformance run, linked to its cases", async () => {
    renderApp("/fleet")
    const table = await screen.findByRole("table", { name: "Conformance" })
    for (const implementation of fleet.implementations) {
      const link = within(table).getByRole("link", { name: implementation.language })
      expect(link).toHaveAttribute("href", `/fleet/${implementation.language}`)
      const passed = implementation.report.cases.filter((c) => c.outcome === "passed").length
      expect(link.closest("tr")).toHaveTextContent(`${passed} passed`)
    }
  })

  it("names the contract each run used beside the one the lock pins", async () => {
    renderApp("/fleet")
    const table = await screen.findByRole("table", { name: "Conformance" })
    for (const implementation of fleet.implementations) {
      const row = within(table).getByRole("link", { name: implementation.language }).closest("tr")!
      const ran = short(implementation.report.contract.commit)
      expect(row).toHaveTextContent(
        ran === lock ? `${ran} · the lock's` : `${ran} · not the lock's ${lock}`,
      )
    }
  })

  it("names what each implementation provides, and says when it does not say", async () => {
    renderApp("/fleet")
    const table = await screen.findByRole("table", { name: "Conformance" })
    const row = (language: string) =>
      within(table).getByRole("link", { name: language }).closest("tr")!
    expect(row("typescript")).toHaveTextContent("estimate-utf8/v1")
    expect(row("go")).toHaveTextContent("not stated")
  })

  it("lists the services whose contract is not the lock's in a drift note", async () => {
    renderApp("/fleet")
    const drifted = fleet.services.filter((s) => s.contract_commit !== fleet.contract.commit)
    expect(drifted.length).toBeGreaterThan(0)
    const note = await screen.findByRole("region", { name: "Contract drift" })
    for (const service of drifted) expect(note).toHaveTextContent(service.name)
  })

  it("shows each service's latency as its wrapper measured it, and Not available where it measured none", async () => {
    const quiet = structuredClone(fleet)
    quiet.services[0]!.latency_ms = { samples: 0 }
    renderApp("/fleet", withFleet(quiet))
    const table = await screen.findByRole("table", { name: "Services" })
    const row = (name: string) => within(table).getByRole("rowheader", { name }).closest("tr")!
    expect(row(quiet.services[0]!.name)).toHaveTextContent("Not available")
    expect(row(quiet.services[1]!.name)).toHaveTextContent(
      `n ${quiet.services[1]!.latency_ms.samples}`,
    )
  })

  it("draws the latency chart with a row per service, said in words", async () => {
    renderApp("/fleet")
    const chart = await screen.findByRole("img", { name: /P50, P95 and P99/ })
    expect(chart).toHaveAccessibleName(expect.stringContaining("the wrappers' measurements"))
    expect(chart.querySelectorAll("[data-service]")).toHaveLength(fleet.services.length)
  })

  it("is in the navigation", async () => {
    renderApp("/fleet")
    const nav = await screen.findByRole("navigation", { name: "Dashboard" })
    expect(within(nav).getByRole("link", { name: "Fleet" })).toHaveAttribute("aria-current", "page")
  })
})

describe("an implementation's cases", () => {
  const typescript = fleet.implementations.find((i) => i.language === "typescript")!
  const total = typescript.report.cases.length + typescript.report.rejections!.length

  it("lists every case and rejection with its outcome and rules", async () => {
    renderApp("/fleet/typescript")
    const table = await screen.findByRole("table", { name: "Cases" })
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(total)
  })

  it("filters by a rule from the URL, and a rule chip sets it", async () => {
    const user = userEvent.setup()
    const { router } = renderApp("/fleet/typescript")
    const table = await screen.findByRole("table", { name: "Cases" })
    await user.click(within(table).getAllByRole("link", { name: "R-26" })[0]!)
    expect(new URLSearchParams(router.state.location.search).get("rule")).toBe("R-26")
    const exercising = [...typescript.report.cases, ...typescript.report.rejections!].filter((c) =>
      c.rules.includes("R-26"),
    )
    expect(
      within(screen.getByRole("table", { name: "Cases" }))
        .getAllByRole("row")
        .slice(1),
    ).toHaveLength(exercising.length)
    expect(screen.getByRole("status", { name: "Cases status" })).toHaveTextContent(
      `${exercising.length} of ${total} exercise R-26`,
    )
  })

  it("says an implementation the report does not hold is not there", async () => {
    renderApp("/fleet/cobol")
    expect(
      await screen.findByText("The fleet report holds no implementation cobol."),
    ).toBeInTheDocument()
  })
})
