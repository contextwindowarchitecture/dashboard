import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { CONTRACT_SOURCE } from "@cwa-dashboard/contract/data"
import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { renderApp } from "../../../test/render-app"

const doc = readFileSync(
  resolve(import.meta.dirname, "../../../../../../docs/otel-semantic-conventions.md"),
  "utf8",
)
const section = doc.slice(
  doc.indexOf("\n## Attributes\n"),
  doc.indexOf("\n## ", doc.indexOf("\n## Attributes\n") + 1),
)
const attributes = [...section.matchAll(/^\| `([^`]+)` \| `([^`]+)` \|/gm)].map(
  (m) => [m[1]!, m[2]!] as const,
)

describe("the telemetry page", () => {
  it("maps every span attribute to its event field, as docs/otel-semantic-conventions.md does", async () => {
    renderApp("/telemetry")
    const table = await screen.findByRole("table", { name: "Span attributes" })
    const rows = within(table).getAllByRole("row").slice(1)
    expect(rows).toHaveLength(attributes.length)
    for (const [attribute, field] of attributes) {
      const row = within(table).getAllByText(attribute)[0]!.closest("tr")!
      expect(row).toHaveTextContent(field)
    }
  })

  it("shows the three redaction modes with what a body becomes, and the setting that chooses one", async () => {
    renderApp("/telemetry")
    const table = await screen.findByRole("table", { name: "Redaction modes" })
    for (const mode of ["full", "pii_scrubbed", "digest_only"])
      expect(table).toHaveTextContent(mode)
    expect(table).toHaveTextContent('"redacted": "digest_only"')
    expect(screen.getByRole("main")).toHaveTextContent("routes.<route>.redaction_mode")
  })

  it("says how an event arrives today, and names Phase 2's patterns without a figure nobody measured", async () => {
    renderApp("/telemetry")
    const today = await screen.findByRole("region", { name: "How events arrive" })
    expect(today).toHaveTextContent("POST /events")
    expect(today).toHaveTextContent("Authorization: Bearer")
    const later = screen.getByRole("region", { name: "Phase 2" })
    expect(later).toHaveTextContent("OpenTelemetry")
    expect(later.textContent).not.toMatch(/\d\s*(µs|μs|ms)\b/)
    expect(later).toHaveTextContent("Not available")
  })
})

describe("the about page", () => {
  it("says what the dashboard is, what it never does, and what it was built against", async () => {
    renderApp("/about")
    const never = await screen.findByRole("list", { name: "What the dashboard never does" })
    expect(within(never).getAllByRole("listitem").length).toBeGreaterThanOrEqual(5)
    expect(never).toHaveTextContent("assemble")
    expect(screen.getByRole("main")).toHaveTextContent(CONTRACT_SOURCE.commit.slice(0, 7))
    expect(screen.getByRole("main")).toHaveTextContent("demo")
  })

  it("puts both pages in the navigation", async () => {
    renderApp("/about")
    const nav = await screen.findByRole("navigation", { name: "Dashboard" })
    expect(within(nav).getByRole("link", { name: "About" })).toHaveAttribute("aria-current", "page")
    expect(within(nav).getByRole("link", { name: "Telemetry" })).toHaveAttribute(
      "href",
      "/telemetry",
    )
  })
})
