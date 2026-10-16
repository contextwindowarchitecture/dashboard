import { CONTRACT_SOURCE } from "@cwa-dashboard/contract/data"
import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { renderApp } from "../test/render-app"

afterEach(() => {
  document.documentElement.setAttribute("data-theme", "light")
  localStorage.clear()
})

describe("the shell", () => {
  it("has one banner, navigation, main and footer, and a skip link to main first", async () => {
    renderApp("/traces")
    expect(await screen.findByRole("banner")).toBeInTheDocument()
    expect(screen.getAllByRole("main")).toHaveLength(1)
    expect(screen.getByRole("contentinfo")).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "Dashboard" })).toBeInTheDocument()
    const skip = screen.getByRole("link", { name: "Skip to content" })
    expect(skip).toHaveAttribute("href", "#main")
    expect(screen.getByRole("main")).toHaveAttribute("id", "main")
    await userEvent.tab()
    expect(skip).toHaveFocus()
  })

  it("marks the current page in the sidebar, records under their section included", async () => {
    renderApp("/traces/01JA2B3C4D5E6F7G8H9JKMNPQR")
    const nav = await screen.findByRole("navigation", { name: "Dashboard" })
    expect(within(nav).getByRole("link", { name: "Traces" })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })

  it("titles the document and the breadcrumbs by the route", async () => {
    renderApp("/traces")
    await waitFor(() => expect(document.title).toBe("Trace stream — CWA dashboard"))
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(within(crumbs).getByText("Traces")).toHaveAttribute("aria-current", "page")
  })

  it("answers an unknown address with a page that says so", async () => {
    renderApp("/nowhere")
    expect(
      await screen.findByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe("Page not found — CWA dashboard"))
  })

  it("moves focus to the page title when the route changes", async () => {
    const { router } = renderApp("/nowhere")
    await screen.findByRole("heading", { level: 1, name: "Page not found" })
    await act(() => router.navigate("/traces"))
    const title = await screen.findByRole("heading", { level: 1, name: "Trace stream" })
    await waitFor(() => expect(title).toHaveFocus())
  })

  it("keeps focus where it is when only the query changes", async () => {
    const { router } = renderApp("/traces")
    await screen.findByRole("heading", { level: 1, name: "Trace stream" })
    const toggle = screen.getByRole("button", { name: "dark" })
    toggle.focus()
    await act(() => router.navigate("/traces?outcome=refused", { replace: true }))
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))))
    expect(toggle).toHaveFocus()
  })

  it("toggles the theme, names the theme it would switch to, and keeps the choice", async () => {
    renderApp("/traces")
    const toggle = await screen.findByRole("button", { name: "dark" })
    await userEvent.click(toggle)
    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    expect(localStorage.getItem("cwa-theme")).toBe("dark")
    expect(screen.getByRole("button", { name: "light" })).toBeInTheDocument()
  })

  it("names the contract the lock pins in the footer", async () => {
    renderApp("/traces")
    const footer = await screen.findByRole("contentinfo")
    expect(
      within(footer).getByText(new RegExp(CONTRACT_SOURCE.commit.slice(0, 7))),
    ).toBeInTheDocument()
  })
})
