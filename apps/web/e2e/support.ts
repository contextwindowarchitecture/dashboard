// What every browser spec checks: no console error or uncaught exception on the page (a Content
// Security Policy violation is a console error in Chromium), axe at WCAG 2.2 AA, and no sideways
// scroll. A spec takes `test` from here, whose automatic fixture fails a test that saw an error; a
// test that expects one takes `pageErrors` and removes it.

import { AxeBuilder } from "@axe-core/playwright"
import { test as base, expect, type Page } from "@playwright/test"

export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const seen: string[] = []
      page.on("console", (message) => {
        if (message.type() === "error") seen.push(message.text())
      })
      page.on("pageerror", (error) => seen.push(error.message))
      await use(seen)
      expect(seen, "errors on the page").toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

/**
 * Axe at WCAG 2.2 AA. Under forced colours the system's palette sets every contrast, and axe's
 * colour-contrast rule reads colours Chromium does not draw there (the GitHub pill's authored
 * paper-on-ink, where the computed style and the screen hold LinkText on Canvas), so that one rule
 * is left out of a forced-colours run.
 */
export async function expectAccessible(page: Page, options: { forcedColors?: boolean } = {}) {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"])
  if (options.forcedColors) builder.disableRules(["color-contrast"])
  const results = await builder.analyze()
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
}

export async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}
