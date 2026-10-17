// What the performance specs share: the stream's filter change, timed in the page from the option's
// pointerup to the status naming the new count, and the phone-width check.

import { expect, type Page } from "@playwright/test"

export async function measureFilterChange(page: Page): Promise<number> {
  await page.getByRole("combobox", { name: "Outcome" }).click()
  const option = page.getByRole("option", { name: /^refused/ })
  await option.waitFor()
  await page.evaluate(() => {
    const status = document.querySelector('[aria-label="Stream status"]')!
    const before = status.textContent
    const target = window as unknown as { measured: Promise<number> }
    target.measured = new Promise((done) => {
      document.addEventListener(
        "pointerup",
        () => {
          const start = performance.now()
          new MutationObserver((_, observer) => {
            if (status.textContent === before) return
            observer.disconnect()
            done(performance.now() - start)
          }).observe(status, { subtree: true, childList: true, characterData: true })
        },
        { once: true, capture: true },
      )
    })
  })
  await option.click()
  return page.evaluate(() => (window as unknown as { measured: Promise<number> }).measured)
}

export async function expectNoSidewaysScroll(page: Page) {
  await page.setViewportSize({ width: 400, height: 800 })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}
