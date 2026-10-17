// The masthead's account control (ADR-0010): what /me answers decides it. Signing in is a navigation
// to the API, which the browser test follows through an issuer; here, each answer's state, and
// signing out.

import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import type { Override } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

const WITH_API = { config: { dataRoot: "/data", source: "file" as const, apiBase: "/api" } }
const json = (body: unknown): Override => ({ status: 200, body: JSON.stringify(body) })
const SIGNED_IN = {
  sign_in: "configured",
  signed_in: true,
  name: "Ada Lovelace",
  email: "ada@example.com",
  groups: ["cwa:owners"],
  expires_at: "2026-10-18T00:00:00.000Z",
}
const masthead = async () => {
  await screen.findByRole("heading", { level: 1 })
  return screen.getByRole("banner")
}

describe("the account control", () => {
  it("offers sign-in, returning the reader to the page they are on", async () => {
    renderApp(
      "/traces?outcome=refused",
      { overrides: { "/api/me": json({ sign_in: "configured", signed_in: false }) } },
      WITH_API,
    )
    const link = await within(await masthead()).findByRole("link", { name: "sign in" })
    expect(link).toHaveAttribute("href", "/api/auth/login?return=%2Ftraces%3Foutcome%3Drefused")
  })

  it("names the reader, and signs them out from its menu, the focus on sign-in after", async () => {
    const overrides: Record<string, Override> = {
      "/api/me": json(SIGNED_IN),
      "/api/auth/logout": { status: 204 },
    }
    const requests: { url: string; method: string }[] = []
    renderApp(
      "/traces",
      {
        overrides,
        onRequest: (url, init) => requests.push({ url, method: init?.method ?? "GET" }),
      },
      WITH_API,
    )
    const header = await masthead()
    await userEvent.click(
      await within(header).findByRole("button", { name: "Account: Ada Lovelace" }),
    )
    const menu = await screen.findByRole("menu")
    expect(menu).toHaveTextContent("ada@example.com")
    overrides["/api/me"] = json({ sign_in: "configured", signed_in: false })
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Sign out" }))
    const link = await within(header).findByRole("link", { name: "sign in" })
    expect(requests).toContainEqual({ url: "/api/auth/logout", method: "POST" })
    expect(link).toHaveFocus()
  })

  it("shows nothing when sign-in is not configured", async () => {
    renderApp(
      "/traces",
      { overrides: { "/api/me": json({ sign_in: "not-configured", signed_in: false }) } },
      WITH_API,
    )
    const header = await masthead()
    await new Promise((done) => setTimeout(done, 20))
    expect(within(header).queryByRole("link", { name: "sign in" })).toBeNull()
  })

  it("asks nothing and shows nothing without an API", async () => {
    const requests: string[] = []
    renderApp("/traces", { onRequest: (url) => requests.push(url) })
    const header = await masthead()
    expect(within(header).queryByRole("link", { name: "sign in" })).toBeNull()
    expect(requests).not.toContain("/api/me")
  })

  it("shows nothing when /me fails or answers something else", async () => {
    for (const answer of [
      { throws: "network" } as const,
      json({ who: "knows" }),
      // A failure, whatever its body says.
      { status: 500, body: JSON.stringify({ sign_in: "configured", signed_in: false }) },
    ]) {
      const { unmount } = renderApp("/traces", { overrides: { "/api/me": answer } }, WITH_API)
      const header = await masthead()
      await new Promise((done) => setTimeout(done, 20))
      expect(within(header).queryByRole("link", { name: "sign in" })).toBeNull()
      expect(within(header).queryByRole("button", { name: /^Account/ })).toBeNull()
      unmount()
    }
  })
})
