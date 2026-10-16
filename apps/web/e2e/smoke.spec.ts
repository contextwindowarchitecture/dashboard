// The smoke test: the built app loads under the production Content Security Policy in both themes,
// axe finds nothing, and nothing scrolls sideways at a phone's width. It grows with every page.

import { AxeBuilder } from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

// A CSP violation is a console error in Chromium; one anywhere fails the test, as does any
// uncaught error on the page.
const problems = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
  const seen: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") seen.push(message.text())
  })
  page.on("pageerror", (error) => seen.push(error.message))
  problems.set(page, seen)
})

test.afterEach(({ page }) => {
  expect(problems.get(page) ?? [], "errors on the page").toEqual([])
})

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze()
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
}

const bodyBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test("the app loads under the production policy, in the light theme by default", async ({
  page,
}) => {
  const response = await page.goto("/")
  const policy = response?.headers()["content-security-policy"] ?? ""
  expect(policy).toContain("script-src 'self';")
  expect(policy).not.toContain("unsafe-eval")
  await expect(page).toHaveURL(/\/traces$/)
  await expect(page).toHaveTitle("Trace stream — CWA dashboard")
  await expect(page.getByRole("main")).toHaveCount(1)
  await expect(page.getByRole("heading", { level: 1, name: "Trace stream" })).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  // The website's paper, from tokens.css, wins over the generated stylesheet's white.
  expect(await bodyBackground(page)).toBe("oklch(0.985 0.004 90)")
  await expectAccessible(page)
})

test("the stored dark theme applies before the app renders", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("cwa-theme", "dark"))
  await page.goto("/")
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  expect(await bodyBackground(page)).toBe("oklch(0.175 0.008 80)")
  await expectAccessible(page)
})

test("the page never scrolls sideways at 400px", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 })
  await page.goto("/traces")
  await expect(page.getByRole("heading", { level: 1, name: "Trace stream" })).toBeVisible()
  await expectNoSidewaysScroll(page)
})

// The restyled shell, measured in the browser (STYLE.md 5, 6): what a unit test cannot see.
test("the shell wears the website's shapes and type", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/traces")
  const style = (selector: string, property: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property)
  expect(await style('[data-slot="masthead"]', "height")).toBe("68px")
  expect(await style('[data-slot="ghost-button"]', "border-top-left-radius")).toBe("999px")
  expect(await style('[data-slot="ghost-button"]', "font-family")).toContain("IBM Plex Mono")
  expect(await style('[data-slot="page-title"]', "font-family")).toContain("Space Grotesk")
  const current = '[data-slot="sidebar-menu-button"][data-active="true"]'
  expect(await style(current, "border-left-width")).toBe("3px")
  expect(await style(current, "border-left-color")).toBe(await style("[data-kicker]", "color"))
})
