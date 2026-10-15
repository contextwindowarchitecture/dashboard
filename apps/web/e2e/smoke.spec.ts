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
  await expect(page).toHaveTitle("CWA dashboard")
  await expect(page.getByRole("main")).toHaveCount(1)
  await expect(page.getByRole("heading", { level: 1, name: "CWA dashboard" })).toBeVisible()
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
  await page.goto("/")
  await expect(page.getByRole("main")).toBeVisible()
  await expectNoSidewaysScroll(page)
})
