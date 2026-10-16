import { readFileSync } from "node:fs"
import { join } from "node:path"

import { REASONS } from "@cwa-dashboard/contract/data"
import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const load = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "events", `${id}.json`), "utf8")) as AssemblyEventV1
const byService = (service: string, turn = 0) =>
  index.events
    .filter((row) => row.service === service)
    .sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : 1))[turn]!.event_id
const bySession = (session: string, turn: number) =>
  index.events.find((row) => row.session?.id === session && row.session.turn_index === turn)!
    .event_id

describe("the Excluded tab", () => {
  it("groups the excluded rows by stage, in pipeline order, each with its code, rule and the contract's words", async () => {
    const id = index.events.find((row) =>
      row.reason_codes.includes("source_diversity_cap"),
    )!.event_id
    const event = load(id)
    renderApp(`/traces/${id}?tab=excluded`)
    const panel = await screen.findByRole("tabpanel", { name: "Excluded" })
    const headings = within(panel)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent)
    expect(headings).toEqual(expect.arrayContaining(["Admission", "Source diversity"]))
    expect(headings.indexOf("Admission")).toBeLessThan(headings.indexOf("Source diversity"))
    const rows = within(panel).getAllByRole("listitem")
    expect(rows).toHaveLength(event.trace!.excluded.length)
    const capped = rows.find((row) => row.textContent?.includes("source_diversity_cap"))!
    const reason = REASONS.find((r) => r.code === "source_diversity_cap")!
    expect(capped).toHaveTextContent(reason.rule)
    expect(capped).toHaveTextContent(reason.text)
  })

  it("links a superseded row to the item that superseded it", async () => {
    const id = bySession("agent-run-412", 1)
    const row = load(id).trace!.excluded.find((r) => r.reason === "superseded")!
    renderApp(`/traces/${id}?tab=excluded`)
    const panel = await screen.findByRole("tabpanel", { name: "Excluded" })
    const link = within(panel).getByRole("link", { name: row.superseded_by! })
    expect(link).toHaveAttribute(
      "href",
      `/traces/${id}?tab=items#item-${encodeURIComponent(row.superseded_by!)}`,
    )
  })

  it("lands such a link on the kept item's row", async () => {
    const id = bySession("agent-run-412", 1)
    const row = load(id).trace!.excluded.find((r) => r.reason === "superseded")!
    renderApp(`/traces/${id}`)
    const list = await screen.findByRole("list", { name: "Included items" })
    const target = list.querySelector(`#${CSS.escape(`item-${row.superseded_by!}`)}`)
    expect(target).not.toBeNull()
    expect(target).toHaveTextContent(row.superseded_by!)
  })

  it("marks a row a producer reported as the producer's", async () => {
    const id = index.events.find((row) => {
      const event = load(row.event_id)
      return event.trace?.excluded.some((r) => r.stage === "producer")
    })!.event_id
    renderApp(`/traces/${id}?tab=excluded`)
    const panel = await screen.findByRole("tabpanel", { name: "Excluded" })
    expect(
      within(panel).getByRole("heading", { level: 3, name: "Reported by producers" }),
    ).toBeInTheDocument()
    expect(panel).toHaveTextContent("· producer")
  })

  it("says when nothing was excluded", async () => {
    const id = index.events.find(
      (row) => row.outcome === "assembled" && row.reason_codes.length === 0,
    )!.event_id
    renderApp(`/traces/${id}?tab=excluded`)
    const panel = await screen.findByRole("tabpanel", { name: "Excluded" })
    expect(panel).toHaveTextContent("Nothing was excluded.")
  })
})

describe("the Conflicts tab", () => {
  it("shows a fact group decided by the route's precedence, with the chain and the winner", async () => {
    const id = byService("support-assistant", 5)
    const event = load(id)
    const conflict = event.trace!.conflicts[0]!
    expect(conflict.kind).toBe("fact")
    renderApp(`/traces/${id}?tab=conflicts`)
    const panel = await screen.findByRole("tabpanel", { name: "Conflicts" })
    const card = within(panel).getByRole("article", { name: conflict.group_id })
    expect(card).toHaveTextContent(
      `fact · ${conflict.resolution} · decided by ${conflict.decided_by}`,
    )
    expect(card).toHaveTextContent(`winner ${conflict.winner}`)
    expect(card).toHaveTextContent("policy-corpus → wiki-corpus")
  })

  it("shows an instruction group that escalated, with the route's policy for it", async () => {
    const id = bySession("desk-agent-12", 0)
    const conflict = load(id).trace!.conflicts[0]!
    renderApp(`/traces/${id}?tab=conflicts`)
    const card = within(await screen.findByRole("tabpanel", { name: "Conflicts" })).getByRole(
      "article",
      { name: conflict.group_id },
    )
    expect(card).toHaveTextContent(
      `instruction · ${conflict.resolution} · decided by ${conflict.decided_by}`,
    )
    expect(card).toHaveTextContent("on_unresolved_instruction request_context")
  })

  it("says when no conflict group was declared", async () => {
    renderApp(`/traces/${bySession("refund-7", 0)}?tab=conflicts`)
    expect(await screen.findByRole("tabpanel", { name: "Conflicts" })).toHaveTextContent(
      "No conflict group was declared.",
    )
  })
})
