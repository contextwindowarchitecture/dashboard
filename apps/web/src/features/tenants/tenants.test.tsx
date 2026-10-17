// The page reads one tenant at a time (ADR-0012): ?tenant= chooses it, every link keeps it, the
// masthead offers the tenants the data root lists, and what only the API answers asks for the same
// tenant. Over the committed demo tree, whose second tenant is northwind.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../test/fixture-fetch"
import { renderApp } from "../../test/render-app"

const read = (path: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, path), "utf8")) as EventsIndexV1
const DEFAULT = read("events/index.json").events
const NORTHWIND = read("tenants/northwind/events/index.json").events
const WITH_API = { config: { dataRoot: "/data", source: "file" as const, apiBase: "/api" } }

const streamIds = async () => {
  const table = await screen.findByRole("table", { name: "Trace stream" })
  await within(table).findAllByRole("link")
  return within(table)
    .getAllByRole("link")
    .map((link) => link.textContent ?? "")
    .filter((text) => /^[0-9A-Z]{26}$/.test(text))
}

describe("the tenant a page reads", () => {
  it("is the default without ?tenant=, and northwind's events alone with it", async () => {
    renderApp("/traces?tenant=northwind")
    const ids = await streamIds()
    expect(new Set(ids)).toEqual(new Set(NORTHWIND.map((row) => row.event_id)))
  })

  it("is the default for a name no tenant can have", async () => {
    renderApp("/traces?tenant=Not%20One")
    const ids = await streamIds()
    expect(ids.every((id) => DEFAULT.some((row) => row.event_id === id))).toBe(true)
  })

  it("stays chosen as the reader follows a link", async () => {
    const { router } = renderApp("/traces?tenant=northwind")
    const [first] = await streamIds()
    await userEvent.click(screen.getByRole("link", { name: first! }))
    await screen.findByRole("list", { name: "Included items" })
    expect(router.state.location.pathname).toBe(`/traces/${first}`)
    expect(new URLSearchParams(router.state.location.search).get("tenant")).toBe("northwind")
  })

  it("is offered in the masthead, from the tenants the data root lists", async () => {
    const { router } = renderApp("/traces")
    const banner = await screen.findByRole("banner")
    await userEvent.click(await within(banner).findByRole("combobox", { name: "Tenant" }))
    await userEvent.click(await screen.findByRole("option", { name: /^northwind/ }))
    expect(new URLSearchParams(router.state.location.search).get("tenant")).toBe("northwind")
    await userEvent.click(within(banner).getByRole("combobox", { name: "Tenant" }))
    await userEvent.click(await screen.findByRole("option", { name: /^default/ }))
    expect(new URLSearchParams(router.state.location.search).get("tenant")).toBeNull()
  })

  it("asks the API for the same tenant's bundle", async () => {
    const requests: string[] = []
    renderApp(
      `/compliance?event=${NORTHWIND[0]!.event_id}&tenant=northwind`,
      { onRequest: (url) => requests.push(url) },
      WITH_API,
    )
    await screen.findByRole("heading", { level: 1, name: "Compliance" })
    await screen.findByText(/Read from/)
    expect(requests).toContain(`/api/bundles/${NORTHWIND[0]!.event_id}.json?tenant=northwind`)
  })
})
