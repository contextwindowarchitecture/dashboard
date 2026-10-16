// The accessibility pass (dashboard-plan.md DP-7, 10.1): the skip link, the keyboard on the stream's
// rows and its filters, focus restored when a sheet or a list closes, the sidebar's three states,
// and forced colours. Axe runs in the smoke test on every page type; zoom is the visual pass's widths
// (1280px at 200% is 640px). A screen reader run is manual and is not here.

import type { Page } from "@playwright/test"

import { expect, expectAccessible, test } from "./support"

/** Tabs until the focus lands inside `inside` (at most `max` presses), returning the focused element. */
async function tabInto(page: Page, inside: string, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab")
    const there = await page.evaluate(
      (selector) => document.activeElement?.closest(selector) !== null,
      inside,
    )
    if (there) return page.locator(":focus")
  }
  throw new Error(`Tab never reached ${inside}`)
}

const outline = (page: Page) =>
  page.evaluate(() => {
    const style = getComputedStyle(document.activeElement!)
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }
  })

test("the skip link is the first stop and moves the next one into the content", async ({
  page,
}) => {
  await page.goto("/traces")
  await page.getByRole("table", { name: "Trace stream" }).waitFor()
  await page.keyboard.press("Tab")
  const skip = page.getByRole("link", { name: "Skip to content" })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  await page.keyboard.press("Enter")
  await page.keyboard.press("Tab")
  expect(await page.evaluate(() => document.activeElement?.closest("main") !== null)).toBe(true)
})

test("the keyboard reaches the stream's rows, each focus ring visible", async ({ page }) => {
  await page.goto("/traces")
  await page.getByRole("table", { name: "Trace stream" }).waitFor()
  const focused = await tabInto(page, '[aria-label="Trace stream"] tbody')
  await expect(focused).toHaveAttribute("href", /^\/traces\/[0-9A-Z]{26}$/)
  const ring = await outline(page)
  expect(ring.style).not.toBe("none")
  expect(ring.width).toBeGreaterThanOrEqual(2)
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/traces\/[0-9A-Z]{26}$/)
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused()
})

test("a filter chosen by keyboard returns the focus to its trigger", async ({ page }) => {
  await page.goto("/traces")
  const trigger = page.getByRole("combobox", { name: "Outcome" })
  await trigger.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("listbox")).toBeVisible()
  // The list moves the focus to the chosen option once it has opened.
  await expect(page.getByRole("option", { name: "All outcomes" })).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("option", { name: "All outcomes" })).not.toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("listbox")).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(page).toHaveURL(/outcome=/)
})

test("the sidebar's sheet traps the focus and gives it back to the menu button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 400, height: 800 })
  await page.goto("/traces")
  const menu = page.getByRole("button", { name: "menu" })
  await menu.click()
  const sheet = page.getByRole("dialog")
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole("link", { name: "Sessions" })).toBeVisible()
  // Axe reads colours as they are drawn, so it waits for the sheet's slide and the overlay's fade.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)))
  await expectAccessible(page)
  await page.keyboard.press("Escape")
  await expect(sheet).toBeHidden()
  await expect(menu).toBeFocused()
  // Following a link closes the sheet and focuses the new page's title.
  await menu.click()
  await page.getByRole("dialog").getByRole("link", { name: "Sessions" }).click()
  await expect(page.getByRole("dialog")).toBeHidden()
  await expect(page.getByRole("heading", { level: 1, name: "Sessions" })).toBeFocused()
})

test("the sidebar collapses to its icons on a desktop, every link still named", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/traces")
  const nav = page.getByRole("navigation", { name: "Dashboard" })
  const sessions = nav.getByRole("link", { name: "Sessions" })
  await expect(sessions).toBeVisible()
  const wide = (await nav.boundingBox())!.width
  const menu = page.getByRole("button", { name: "menu" })
  await expect(menu).toHaveAttribute("aria-expanded", "true")
  await menu.click()
  await expect(menu).toHaveAttribute("aria-expanded", "false")
  await expect.poll(async () => (await nav.boundingBox())!.width).toBeLessThan(wide / 2)
  await expect(sessions).toBeVisible()
  await expectAccessible(page)
  await sessions.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { level: 1, name: "Sessions" })).toBeFocused()
  await menu.click()
  await expect(menu).toHaveAttribute("aria-expanded", "true")
})

test("in forced colours the budget bar keeps its planes, and the inspector passes axe", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" })
  await page.goto("/traces?outcome=assembled&session=refund-7")
  await page
    .getByRole("table", { name: "Trace stream" })
    .getByRole("row")
    .nth(1)
    .getByRole("link")
    .click()
  await page.getByRole("figure", { name: /Budget/ }).waitFor()
  const colours = await page.evaluate(() => {
    const canvas = getComputedStyle(document.body).backgroundColor
    const segments = [
      ...document.querySelectorAll('[data-slot="budget-bar"] > [data-segment]:not([data-ghost])'),
    ].map((segment) => getComputedStyle(segment).backgroundColor)
    return { canvas, segments }
  })
  expect(colours.segments.length).toBeGreaterThan(2)
  for (const colour of colours.segments) expect(colour).not.toBe(colours.canvas)
  expect(new Set(colours.segments).size).toBe(colours.segments.length)
  await expectAccessible(page, { forcedColors: true })
})
