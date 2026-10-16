import { REGISTRY } from "@cwa-dashboard/contract/registry"
import { screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { renderApp } from "../../../test/render-app"
import { policyPath, profilePath } from "../model/paths"

const cacheFirst = REGISTRY.profiles.find((p) => p.id === "cache-first-chat")!

describe("the profiles list", () => {
  it("lists every profile the registry holds with the route policy it binds and its evaluation", async () => {
    renderApp("/registry/profiles")
    const table = await screen.findByRole("table", { name: "Profiles" })
    for (const profile of REGISTRY.profiles) {
      const link = within(table).getByRole("link", { name: `${profile.id} v${profile.version}` })
      expect(link).toHaveAttribute("href", profilePath(profile.id, profile.version))
      const row = link.closest("tr")!
      expect(row).toHaveTextContent("unevaluated")
      expect(
        within(row).getByRole("link", { name: `${profile.route} ${profile.route_policy_version}` }),
      ).toHaveAttribute("href", policyPath(profile.route, profile.route_policy_version))
    }
  })

  it("lists the profiles events ran that the registry does not hold", async () => {
    renderApp("/registry/profiles")
    const table = await screen.findByRole("table", { name: "Not in the registry" })
    expect(table).toHaveTextContent("budget-droppable-order v1")
    expect(table).not.toHaveTextContent("cache-first-chat")
  })

  it("is in the navigation", async () => {
    renderApp("/registry/profiles")
    const nav = await screen.findByRole("navigation", { name: "Dashboard" })
    expect(within(nav).getByRole("link", { name: "Profiles" })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })
})

describe("a profile's page", () => {
  it("shows its placement in order, each slot with its wrap", async () => {
    renderApp(profilePath("cache-first-chat", 1))
    const placement = await screen.findByRole("list", { name: "Placement" })
    const items = within(placement).getAllByRole("listitem")
    expect(items.map((li) => li.textContent)).toEqual(
      cacheFirst.placement.map((p) => `${p.slot}${p.wrap}`),
    )
  })

  it("states that an unevaluated profile cannot be promoted (R-19)", async () => {
    renderApp(profilePath("cache-first-chat", 1))
    const evaluation = await screen.findByRole("region", { name: "Evaluation" })
    expect(evaluation).toHaveTextContent("unevaluated")
    expect(evaluation).toHaveTextContent("Not promotable for a deployment (R-19)")
  })

  it("links the route policy it binds (R-20)", async () => {
    renderApp(profilePath("cache-first-chat", 1))
    const facts = await screen.findByRole("list", { name: "Profile facts" })
    expect(
      within(facts).getByRole("link", { name: "support-chat illustrative/v1" }),
    ).toHaveAttribute("href", policyPath("support-chat", "illustrative/v1"))
  })

  it("measures part reuse over the sessions that ran it, and says how many", async () => {
    renderApp(profilePath("cache-first-chat", 1))
    const facts = await screen.findByRole("list", { name: "Profile facts" })
    await waitFor(() =>
      expect(facts).toHaveTextContent("25 of 66 parts · 4 turns compared · 1 session"),
    )
  })

  it("says part reuse is not available when no session that ran it could be compared", async () => {
    renderApp(profilePath("fixture-three-slot", 1))
    const facts = await screen.findByRole("list", { name: "Profile facts" })
    await waitFor(() => expect(facts).toHaveTextContent("part reuse Not available"))
  })

  it("says so when no session ran it at all", async () => {
    renderApp(profilePath("policy-first-chat", 1))
    const facts = await screen.findByRole("list", { name: "Profile facts" })
    expect(facts).toHaveTextContent("part reuse Not available · no session ran it")
  })

  it("says a profile the registry does not hold is not there", async () => {
    renderApp(profilePath("nowhere", 3))
    expect(
      await screen.findByText("Profile nowhere v3 is not in the registry."),
    ).toBeInTheDocument()
  })
})
