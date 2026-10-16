import { CONTRACT_SOURCE, MODEL, REASONS, REQUIREMENTS } from "@cwa-dashboard/contract/data"
import { render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import { ReasonChip } from "../../../components/dashboard/reason-chip"
import { SlotBadge } from "../../../components/dashboard/slot-badge"
import { glossaryHref, glossaryId } from "../../../lib/glossary"
import { renderApp } from "../../../test/render-app"

async function openGlossary() {
  renderApp("/glossary")
  return screen.findByRole("heading", { level: 1, name: "Glossary" })
}
const byId = (id: string) => document.getElementById(id)

describe("the glossary", () => {
  it("gives every reason code, requirement, slot, plane and authority value an anchor", async () => {
    await openGlossary()
    for (const reason of REASONS)
      expect(byId(glossaryId("reason", reason.code)), reason.code).not.toBeNull()
    for (const requirement of REQUIREMENTS)
      expect(byId(glossaryId("rule", requirement.id)), requirement.id).not.toBeNull()
    for (const slot of MODEL.slots)
      expect(byId(glossaryId("slot", slot.id)), slot.id).not.toBeNull()
    for (const plane of MODEL.planes)
      expect(byId(glossaryId("plane", plane.id)), plane.id).not.toBeNull()
    for (const authority of MODEL.authority)
      expect(byId(glossaryId("authority", authority.value)), authority.value).not.toBeNull()
  })

  it("links each reason to the requirement that defines it, in the contract's words", async () => {
    await openGlossary()
    const reason = REASONS.find((r) => r.code === "expired")!
    const entry = byId(glossaryId("reason", reason.code))!
    expect(entry).toHaveTextContent(reason.text)
    expect(within(entry).getByRole("link", { name: reason.rule })).toHaveAttribute(
      "href",
      glossaryHref("rule", reason.rule),
    )
  })

  it("says which contract it was written from", async () => {
    await openGlossary()
    expect(screen.getByRole("main")).toHaveTextContent(CONTRACT_SOURCE.commit.slice(0, 7))
  })

  it("is in the navigation", async () => {
    await openGlossary()
    const nav = screen.getByRole("navigation", { name: "Dashboard" })
    expect(within(nav).getByRole("link", { name: "Glossary" })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })
})

describe("the chips", () => {
  it("link a reason code to its entry, an instance code to the code it instances", () => {
    render(
      <MemoryRouter>
        <ReasonChip code="expired" />
        <ReasonChip code="missing_field:relevance" />
        <ReasonChip code="ITEM_EXPIRED" />
      </MemoryRouter>,
    )
    expect(screen.getByRole("link", { name: /^expired/ })).toHaveAttribute(
      "href",
      glossaryHref("reason", "expired"),
    )
    expect(screen.getByRole("link", { name: /^missing_field:relevance/ })).toHaveAttribute(
      "href",
      glossaryHref("reason", "missing_field:<name>"),
    )
    // A code outside the contract has no entry to link to.
    expect(screen.queryByRole("link", { name: /ITEM_EXPIRED/ })).toBeNull()
  })

  it("link a slot to its entry, unless asked not to", () => {
    render(
      <MemoryRouter>
        <SlotBadge slot="evidence.knowledge" />
        <SlotBadge slot="state.user" link={false} />
      </MemoryRouter>,
    )
    expect(screen.getByRole("link", { name: "evidence.knowledge" })).toHaveAttribute(
      "href",
      glossaryHref("slot", "evidence.knowledge"),
    )
    expect(screen.queryByRole("link", { name: "state.user" })).toBeNull()
    expect(screen.getByText("state.user")).toBeInTheDocument()
  })
})
