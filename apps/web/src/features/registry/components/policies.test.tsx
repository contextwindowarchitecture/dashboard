import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"
import { SLOT_RULE_FIELDS } from "../model/registry"
import { policyPath } from "../model/paths"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const schema = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      "../../../../../../packages/contract/vendor/cwa/schema/route_policy.schema.json",
    ),
    "utf8",
  ),
) as { $defs: { slot_rules: { properties: Record<string, unknown> } } }
const canary = index.events.filter((row) => row.service === "support-assistant-canary")

describe("the route policies list", () => {
  it("lists every route policy the registry holds, each linked to its page", async () => {
    renderApp("/registry/policies")
    const table = await screen.findByRole("table", { name: "Route policies" })
    for (const policy of REGISTRY.route_policies) {
      const link = within(table).getByRole("link", { name: `${policy.route} ${policy.version}` })
      expect(link).toHaveAttribute("href", policyPath(policy.route, policy.version))
    }
  })

  it("says which events ran a pinned version with other content", async () => {
    renderApp("/registry/policies")
    const drift = await screen.findByRole("region", { name: "Drift" })
    expect(drift).toHaveTextContent("support-chat illustrative/v1")
    for (const row of canary)
      expect(within(drift).getByRole("link", { name: row.event_id })).toBeInTheDocument()
  })

  it("lists the route policies events ran that the registry does not hold", async () => {
    renderApp("/registry/policies")
    const table = await screen.findByRole("table", { name: "Not in the registry" })
    expect(table).toHaveTextContent("budget-droppable-order/v1")
    expect(table).not.toHaveTextContent("illustrative/v1")
  })

  it("is where /registry leads", async () => {
    renderApp("/registry")
    expect(await screen.findByRole("table", { name: "Route policies" })).toBeInTheDocument()
  })

  it("is in the navigation", async () => {
    renderApp("/registry/policies")
    const nav = await screen.findByRole("navigation", { name: "Dashboard" })
    expect(within(nav).getByRole("link", { name: "Route policies" })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })
})

describe("a route policy's page", () => {
  it("lays out every slot rule the schema defines, a dash where the policy sets none", async () => {
    expect([...SLOT_RULE_FIELDS].sort()).toEqual(
      Object.keys(schema.$defs.slot_rules.properties).sort(),
    )
    renderApp(policyPath("support-chat", "illustrative/v1"))
    const table = await screen.findByRole("table", { name: "Slot rules" })
    const heads = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent)
    expect(heads).toEqual(["slot", ...SLOT_RULE_FIELDS])
    const knowledge = within(table)
      .getByRole("rowheader", { name: "evidence.knowledge" })
      .closest("tr")!
    const cells = within(knowledge)
      .getAllByRole("cell")
      .map((c) => c.textContent)
    expect(cells[SLOT_RULE_FIELDS.indexOf("min_relevance")]).toBe("0.5")
    expect(cells[SLOT_RULE_FIELDS.indexOf("priority")]).toBe("—")
  })

  it("lists the producers it admits with their kind and slots", async () => {
    renderApp(policyPath("support-chat", "illustrative/v1"))
    const table = await screen.findByRole("table", { name: "Producers" })
    const policy = REGISTRY.route_policies.find(
      (p) => p.version === "illustrative/v1" && p.route === "support-chat",
    )!
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(
      Object.keys(policy.producers).length,
    )
    const crm = within(table).getByRole("rowheader", { name: "crm-mcp" }).closest("tr")!
    expect(crm).toHaveTextContent("mcp")
    expect(crm).toHaveTextContent("evidence.tool_results")
  })

  it("names the events that ran it with other content, and the lock's digest", async () => {
    renderApp(policyPath("support-chat", "illustrative/v1"))
    const drift = await screen.findByRole("region", { name: "Drift" })
    for (const row of canary)
      expect(within(drift).getByRole("link", { name: row.event_id })).toBeInTheDocument()
    const pinned = REGISTRY.lock.route_policies.find(
      (e) => e.route === "support-chat" && e.version === "illustrative/v1",
    )!.sha256
    expect(screen.getByRole("list", { name: "Route policy facts" })).toHaveTextContent(pinned)
  })

  it("orders each fact's precedence as the policy does", async () => {
    renderApp(policyPath("support-chat", "conflict-fact/v1"))
    const table = await screen.findByRole("table", { name: "Facts" })
    const row = within(table).getByRole("rowheader", { name: "refund.window" }).closest("tr")!
    const order = within(row)
      .getAllByRole("listitem")
      .map((li) => li.textContent)
    expect(order).toEqual(["policy-corpus", "wiki-corpus"])
  })

  it("says a route policy the registry does not hold is not there", async () => {
    renderApp(policyPath("support-chat", "nowhere/v1"))
    expect(
      await screen.findByText("Route policy support-chat nowhere/v1 is not in the registry."),
    ).toBeInTheDocument()
  })
})
