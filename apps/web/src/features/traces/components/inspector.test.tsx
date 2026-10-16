import { readFileSync } from "node:fs"
import { join } from "node:path"

import { REASONS } from "@cwa-dashboard/contract/data"
import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const load = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "events", `${id}.json`), "utf8")) as AssemblyEventV1
const find = (test: (row: EventsIndexV1["events"][number]) => boolean) =>
  index.events.find(test)!.event_id

const ASSEMBLED = find((row) => row.session?.id === "refund-7" && row.session.turn_index === 4)
const REFUSED = find((row) => row.session?.id === "intake-12" && row.session.turn_index === 2)
const REJECTED = find((row) => row.session?.id === "fixture-c1" && row.session.turn_index === 1)

describe("the trace inspector", () => {
  it("names the event in the title, the document title and the breadcrumbs", async () => {
    renderApp(`/traces/${ASSEMBLED}`)
    expect(await screen.findByRole("heading", { level: 1, name: ASSEMBLED })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe(`${ASSEMBLED} — Traces — CWA dashboard`))
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(within(crumbs).getByRole("link", { name: "Traces" })).toHaveAttribute("href", "/traces")
    expect(within(crumbs).getByText(ASSEMBLED)).toHaveAttribute("aria-current", "page")
  })

  it("states an assembly's outcome with its tokens and payload hash, and the event's facts", async () => {
    const event = load(ASSEMBLED)
    renderApp(`/traces/${ASSEMBLED}`)
    const banner = await screen.findByRole("region", { name: "Outcome" })
    expect(banner).toHaveTextContent(
      `assembled · ${event.trace!.result!.input_tokens.toLocaleString("en-US")} tokens`,
    )
    expect(banner).toHaveTextContent(event.payload!.hash)
    const facts = screen.getByRole("list", { name: "Event facts" })
    for (const fact of [
      event.snapshot!.route_policy.route,
      event.snapshot!.route_policy.version,
      event.snapshot!.profile.id,
      event.snapshot!.tokenizer,
      event.snapshot!.renderer,
      event.assembler.version,
      event.service.name,
      event.redaction_mode,
      event.trace!.context.snapshot_digest,
      event.contract.commit.slice(0, 7),
    ]) {
      expect(facts).toHaveTextContent(fact)
    }
  })

  it("states a refusal by its code, the contract's words for it and the recovery", async () => {
    const event = load(REFUSED)
    const reason = REASONS.find((r) => r.code === event.trace!.refused.reason)!
    renderApp(`/traces/${REFUSED}`)
    const banner = await screen.findByRole("region", { name: "Outcome" })
    expect(banner).toHaveTextContent(`refused · ${reason.code}`)
    expect(banner).toHaveTextContent(reason.rule)
    expect(banner).toHaveTextContent(reason.text)
    if (event.trace!.recovery) expect(banner).toHaveTextContent(event.trace!.recovery.action)
  })

  it("states a rejection with its problems in words, and has no trace to show", async () => {
    const event = load(REJECTED)
    renderApp(`/traces/${REJECTED}`)
    const banner = await screen.findByRole("region", { name: "Outcome" })
    expect(banner).toHaveTextContent(`rejected · ${event.rejection!.problems.length} problem`)
    for (const problem of event.rejection!.problems) expect(banner).toHaveTextContent(problem)
  })

  it("says an event that is not in the tree is not there", async () => {
    renderApp("/traces/01JA2B3C4D5E6F7G8H9JKMNPQR")
    expect(
      await screen.findByText("Event 01JA2B3C4D5E6F7G8H9JKMNPQR is not there."),
    ).toBeInTheDocument()
  })

  it("keeps the tab in the URL", async () => {
    const { router } = renderApp(`/traces/${ASSEMBLED}`)
    await screen.findByRole("region", { name: "Outcome" })
    expect(screen.getByRole("tab", { name: "Items" })).toHaveAttribute("aria-selected", "true")
    await userEvent.click(screen.getByRole("tab", { name: "Raw" }))
    await waitFor(() => expect(router.state.location.search).toBe("?tab=raw"))
    expect(screen.getByRole("tab", { name: "Raw" })).toHaveAttribute("aria-selected", "true")
  })

  it("opens on the tab the URL names", async () => {
    renderApp(`/traces/${ASSEMBLED}?tab=context`)
    expect(await screen.findByRole("tab", { name: "Context" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })

  it("opens on Items when the URL names a tab it does not know", async () => {
    renderApp(`/traces/${ASSEMBLED}?tab=nonsense`)
    expect(await screen.findByRole("tab", { name: "Items" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })

  it("shows the context, with timings said to be measurements outside the hash", async () => {
    const event = load(ASSEMBLED)
    renderApp(`/traces/${ASSEMBLED}?tab=context`)
    const context = await screen.findByRole("tabpanel", { name: "Context" })
    expect(context).toHaveTextContent(event.trace!.context.assembly_time)
    expect(context).toHaveTextContent(/not deterministic/i)
  })

  it("shows the raw snapshot and trace as JSON", async () => {
    const event = load(ASSEMBLED)
    renderApp(`/traces/${ASSEMBLED}?tab=raw`)
    const raw = await screen.findByRole("tabpanel", { name: "Raw" })
    expect(raw).toHaveTextContent(event.trace!.trace_id)
  })
})
