// What the page does with what the API refuses or withholds (ADR-0011): a region refused for want of
// sign-in offers it, one refused for want of a role says so, a withheld body is named as withheld
// with its metadata in view, and signing out forgets every document read while signed in.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR, type Override } from "../../test/fixture-fetch"
import { renderApp } from "../../test/render-app"
import { withheld } from "../../test/withheld"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const load = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "events", `${id}.json`), "utf8")) as AssemblyEventV1
const FULL = load(
  index.events.find((r) => r.redaction_mode === "full" && r.outcome === "assembled")!.event_id,
)
const ROUTE = FULL.snapshot!.route_policy.route
const WITH_API = { config: { dataRoot: "/data", source: "file" as const, apiBase: "/api" } }
const json = (status: number, body: unknown): Override => ({ status, body: JSON.stringify(body) })
const ME_OUT = json(200, { sign_in: "configured", signed_in: false, roles: [] })

describe("a region the API refuses", () => {
  it("offers sign-in when the reader has not signed in, returning them here", async () => {
    renderApp(
      "/traces?outcome=refused",
      {
        overrides: { "/data/events/index.json": json(401, { kind: "sign-in" }), "/api/me": ME_OUT },
      },
      WITH_API,
    )
    const main = await screen.findByRole("main")
    const prompt = await within(main).findByRole("region", { name: "Sign in to read" })
    expect(within(prompt).getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/api/auth/login?return=%2Ftraces%3Foutcome%3Drefused",
    )
  })

  it("says the reader's roles do not reach, when they have signed in", async () => {
    renderApp(
      `/traces/${FULL.event_id}`,
      { overrides: { [`/data/events/${FULL.event_id}.json`]: json(403, { kind: "forbidden" }) } },
      WITH_API,
    )
    expect(await screen.findByText("Your roles do not include this.")).toBeInTheDocument()
  })
})

describe("a body withheld from the reader's role", () => {
  it("is named as withheld, with its digest and the setting that grants it, the metadata in view", async () => {
    const served = withheld(FULL)
    renderApp(
      `/traces/${FULL.event_id}`,
      { overrides: { [`/data/events/${FULL.event_id}.json`]: json(200, served) } },
      WITH_API,
    )
    const list = await screen.findByRole("list", { name: "Included items" })
    const [first] = within(list).getAllByRole("listitem")
    expect(first).toHaveTextContent("body withheld · your role")
    expect(first).toHaveTextContent(`owner:${ROUTE}`)
    const digest = (served.snapshot!.batches[0]!.items[0] as { body: { content_sha256: string } })
      .body.content_sha256
    expect(list).toHaveTextContent(digest)
    // R-DASH-1: the metadata is shown whatever happened to the body.
    expect(first).toHaveTextContent("authority")
    expect(first).toHaveTextContent("trust")
  })
})

describe("signing out", () => {
  it("forgets every document read while signed in", async () => {
    const overrides: Record<string, Override> = {
      "/api/me": json(200, {
        sign_in: "configured",
        signed_in: true,
        name: "Ada",
        groups: [],
        roles: ["owner:*"],
      }),
      "/api/auth/logout": { status: 204 },
    }
    const requests: string[] = []
    renderApp(
      `/traces/${FULL.event_id}`,
      { overrides, onRequest: (url) => requests.push(url) },
      WITH_API,
    )
    await screen.findByRole("list", { name: "Included items" })
    const before = requests.filter((url) => url.endsWith(`${FULL.event_id}.json`)).length
    overrides["/api/me"] = ME_OUT
    await userEvent.click(screen.getByRole("button", { name: "Account: Ada" }))
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }))
    await screen.findByRole("link", { name: "sign in" })
    await screen.findByRole("list", { name: "Included items" })
    expect(requests.filter((url) => url.endsWith(`${FULL.event_id}.json`)).length).toBeGreaterThan(
      before,
    )
  })
})
