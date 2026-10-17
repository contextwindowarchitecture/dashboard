// The compliance page's states. What a real signed bundle shows is a browser test (e2e/smoke.spec.ts),
// against the ingest service with a signing key, since only it can sign one.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const ID = index.events.find((row) => row.outcome === "assembled")!.event_id
const WITH_API = { config: { dataRoot: "/data", source: "file" as const, apiBase: "/api" } }

describe("the compliance page", () => {
  it("offers the window's recent assembled events to bundle", async () => {
    renderApp("/compliance", {}, WITH_API)
    expect(await screen.findByRole("heading", { level: 1, name: "Compliance" })).toBeInTheDocument()
    const list = await screen.findByRole("list", { name: "Recent events" })
    expect(within(list).getByRole("link", { name: ID })).toHaveAttribute(
      "href",
      `/compliance?event=${ID}`,
    )
  })

  it("says the service is not configured when config.json names no API", async () => {
    renderApp(`/compliance?event=${ID}`)
    expect(await screen.findByText(/names no/)).toHaveTextContent("apiBase")
  })

  it("names the setting when the service has no signing key", async () => {
    renderApp(
      `/compliance?event=${ID}`,
      {
        overrides: {
          [`/api/bundles/${ID}.json`]: {
            status: 503,
            body: JSON.stringify({
              ok: false,
              kind: "not-configured",
              problems: ["No signing key: set SIGNING_KEY to sign compliance bundles."],
            }),
          },
        },
      },
      WITH_API,
    )
    expect(await screen.findByRole("region", { name: "Bundle" })).toHaveTextContent("SIGNING_KEY")
  })

  it("says an event the store does not hold is not there", async () => {
    renderApp(
      "/compliance?event=01M5ZZZZZZZZZZZZZZZZZZZZZY",
      {
        overrides: { "/api/bundles/01M5ZZZZZZZZZZZZZZZZZZZZZY.json": { status: 404, body: "{}" } },
      },
      WITH_API,
    )
    expect(await screen.findByText(/01M5ZZZZZZZZZZZZZZZZZZZZZY is not there/)).toBeInTheDocument()
  })

  it("asks nothing of the service for an id that names no event", async () => {
    const requests: string[] = []
    renderApp("/compliance?event=../fleet", { onRequest: (url) => requests.push(url) }, WITH_API)
    expect(await screen.findByText(/not an event id/)).toBeInTheDocument()
    expect(requests.some((url) => url.includes("/bundles/"))).toBe(false)
  })
})
