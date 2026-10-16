import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { EventsIndexV1, SessionV1 } from "@cwa-dashboard/telemetry/types"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"
import { codeCounts, GUARDRAILS, guardrailCounts, guardrailRows } from "../model/guardrails"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const sessions = readdirSync(join(FIXTURES_DIR, "sessions")).map(
  (name) => JSON.parse(readFileSync(join(FIXTURES_DIR, "sessions", name), "utf8")) as SessionV1,
)
const displacement = GUARDRAILS.find((g) => g.number === "05")!

describe("the guardrails' per-code model", () => {
  it("counts each code's events as the stream's reason filter would find them", () => {
    for (const guardrail of GUARDRAILS) {
      for (const { code, events } of codeCounts(guardrail, index.events)) {
        expect(events, code).toBe(
          index.events.filter((r) => r.reason_codes.includes(code) || r.refused_reason === code)
            .length,
        )
      }
    }
  })

  it("lists the events behind a card's count, newest first", () => {
    for (const guardrail of GUARDRAILS.filter((g) => g.codes.length > 0)) {
      // The index is newest first already; reversed, the order has to come from the model.
      const rows = guardrailRows(guardrail, [...index.events].reverse())
      expect(rows.length).toBe(guardrailCounts(index.events).get(guardrail.number))
      expect(rows.map((r) => r.recorded_at)).toEqual(
        [...rows.map((r) => r.recorded_at)].sort().reverse(),
      )
    }
  })
})

describe("the guardrails page", () => {
  it("shows the seven cards, each linked to its own page", async () => {
    renderApp("/guardrails")
    const list = await screen.findByRole("list", { name: "Guardrails" })
    for (const guardrail of GUARDRAILS) {
      const link = within(list).getByRole("link", {
        name: `${guardrail.number} · ${guardrail.name}`,
      })
      expect(link).toHaveAttribute("href", `/guardrails/${guardrail.number}`)
    }
  })

  it("is in the navigation", async () => {
    renderApp("/guardrails")
    const nav = await screen.findByRole("navigation", { name: "Dashboard" })
    expect(within(nav).getByRole("link", { name: "Guardrails" })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })
})

describe("a guardrail's page", () => {
  it("counts each of its codes, and each count's link opens the stream on the same events", async () => {
    const user = userEvent.setup()
    const counts = codeCounts(displacement, index.events)
    const { router } = renderApp("/guardrails/05")
    const table = await screen.findByRole("table", { name: "Codes" })
    const busiest = [...counts].sort((a, b) => b.events - a.events)[0]!
    const row = within(table).getByRole("rowheader", { name: busiest.code }).closest("tr")!
    expect(row).toHaveTextContent(String(busiest.events))
    await user.click(within(row).getByRole("link"))
    expect(router.state.location.pathname).toBe("/traces")
    expect(new URLSearchParams(router.state.location.search).get("reason")).toBe(busiest.code)
    expect(await screen.findByRole("status", { name: "Stream status" })).toHaveTextContent(
      `${busiest.events} of ${index.events.length} events`,
    )
  })

  it("lists the events behind its count, each linked to the inspector", async () => {
    renderApp("/guardrails/05")
    const table = await screen.findByRole("table", { name: "Events" })
    const rows = guardrailRows(displacement, index.events)
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(rows.length)
    expect(within(table).getByRole("link", { name: rows[0]!.event_id })).toHaveAttribute(
      "href",
      `/traces/${rows[0]!.event_id}`,
    )
  })

  it("measures redundant re-reading as part reuse over every session, with how many", async () => {
    const compared = sessions.filter((s) => s.part_reuse.compared_turns > 0)
    const reused = compared.reduce((n, s) => n + s.part_reuse.reused_parts, 0)
    const parts = compared.reduce((n, s) => n + s.part_reuse.parts, 0)
    renderApp("/guardrails/06")
    const measure = await screen.findByRole("region", { name: "Measure" })
    await waitFor(() =>
      expect(measure).toHaveTextContent(
        `${reused} of ${parts} parts reused · ${compared.length} sessions`,
      ),
    )
  })

  it("says a guardrail that does not exist is not there", async () => {
    renderApp("/guardrails/99")
    expect(await screen.findByText("There is no guardrail 99.")).toBeInTheDocument()
  })
})
