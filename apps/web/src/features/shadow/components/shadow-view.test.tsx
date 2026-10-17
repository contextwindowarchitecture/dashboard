// The shadow page's states. What a real report shows is a browser test (e2e/smoke.spec.ts), against
// the ingest service over a frozen corpus, since only it replays.

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import { fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import type { Override } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

const WITH_API = { config: { dataRoot: "/data", source: "file" as const, apiBase: "/api" } }
const json = (status: number, body: unknown): Override => ({ status, body: JSON.stringify(body) })
const CORPORA = json(200, {
  corpora: [{ name: "chat", created_at: "2026-10-16T09:00:00.000Z", events: 12 }],
})
const at = (path: string, overrides: Record<string, Override> = {}, requests: string[] = []) =>
  renderApp(
    path,
    {
      overrides: { "/api/corpora.json": CORPORA, ...overrides },
      onRequest: (url) => requests.push(url),
    },
    WITH_API,
  )

async function shadowWith(text: string) {
  const box = await screen.findByLabelText("Candidate JSON")
  fireEvent.change(box, { target: { value: text } })
  await userEvent.click(screen.getByRole("button", { name: "Shadow" }))
}

describe("the shadow page", () => {
  it("says the service is not configured when config.json names no API", async () => {
    const requests: string[] = []
    renderApp("/shadow", { onRequest: (url) => requests.push(url) })
    expect(await screen.findByRole("heading", { level: 1, name: "Shadow" })).toBeInTheDocument()
    expect(await screen.findByText(/names no/)).toHaveTextContent("apiBase")
    expect(requests.some((url) => url.startsWith("/api/"))).toBe(false)
  })

  it("lists the frozen corpora to choose from", async () => {
    at("/shadow")
    const table = await screen.findByRole("table", { name: "Corpora" })
    expect(within(table).getByRole("link", { name: "chat" })).toHaveAttribute(
      "href",
      "/shadow?corpus=chat",
    )
    expect(within(table).getByText("12")).toBeInTheDocument()
  })

  it("says how to freeze a corpus when none is", async () => {
    at("/shadow", { "/api/corpora.json": json(200, { corpora: [] }) })
    const empty = await screen.findByRole("region", { name: "No corpus" })
    expect(empty).toHaveTextContent("POST /corpora")
    expect(empty).toHaveTextContent("INGEST_TOKEN")
  })

  it("names the setting when the service has no store", async () => {
    at("/shadow", {
      "/api/corpora.json": json(503, {
        kind: "not-configured",
        problems: ["No event store: set DATABASE_URL or EVENTS_DIR."],
      }),
    })
    expect(await screen.findByRole("region", { name: "Corpora" })).toHaveTextContent("DATABASE_URL")
  })

  it("says a corpus the service does not hold is not there, and offers no run", async () => {
    at("/shadow?corpus=gone")
    expect(await screen.findByText(/is frozen/)).toHaveTextContent("No corpus gone is frozen.")
    expect(screen.queryByLabelText("Candidate JSON")).toBeNull()
  })

  it("starts a candidate from the registry", async () => {
    at("/shadow?corpus=chat")
    const profile = REGISTRY.profiles[0]!
    await userEvent.click(await screen.findByRole("combobox", { name: "Start from" }))
    await userEvent.click(
      screen.getByRole("option", {
        name: `Profile ${profile.id} v${profile.version} · ${profile.route}`,
      }),
    )
    expect(
      JSON.parse((screen.getByLabelText("Candidate JSON") as HTMLTextAreaElement).value),
    ).toEqual({ profile })
  })

  it("says what is wrong with a candidate before asking the service", async () => {
    const requests: string[] = []
    at("/shadow?corpus=chat", {}, requests)
    await shadowWith('{"budget": {}}')
    expect(await screen.findByRole("alert")).toHaveTextContent(/route_policy, a profile, or both/)
    expect(requests).not.toContain("/api/shadow")
  })

  it("says the service is busy with another run", async () => {
    at("/shadow?corpus=chat", {
      "/api/shadow": json(503, {
        kind: "busy",
        problems: ["A shadow run is under way; try again shortly."],
      }),
    })
    await shadowWith(JSON.stringify({ profile: REGISTRY.profiles[0] }))
    expect(await screen.findByRole("alert")).toHaveTextContent("A shadow run is under way")
  })

  it("gives the service's problems with a request it refuses", async () => {
    at("/shadow?corpus=chat", {
      "/api/shadow": json(404, { kind: "not-found", problems: ["No corpus chat."] }),
    })
    await shadowWith(JSON.stringify({ profile: REGISTRY.profiles[0] }))
    expect(await screen.findByRole("alert")).toHaveTextContent("No corpus chat.")
  })

  it("calls a report it cannot read so, rather than show part of it", async () => {
    at("/shadow?corpus=chat", {
      "/api/shadow": json(200, { $schema: "cwa-dashboard/shadow-report/v1" }),
    })
    await shadowWith(JSON.stringify({ profile: REGISTRY.profiles[0] }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /not a shadow report this dashboard reads/,
    )
  })

  it("asks for the corpora and the run of the tenant the page reads", async () => {
    const requests: string[] = []
    at(
      "/shadow?corpus=chat&tenant=northwind",
      {
        "/api/corpora.json?tenant=northwind": CORPORA,
        "/api/shadow?tenant=northwind": json(503, { kind: "busy", problems: ["Busy."] }),
      },
      requests,
    )
    await shadowWith(JSON.stringify({ profile: REGISTRY.profiles[0] }))
    await screen.findByRole("alert")
    expect(requests).toContain("/api/corpora.json?tenant=northwind")
    expect(requests).toContain("/api/shadow?tenant=northwind")
  })
})
