// The visual pass (dashboard-plan.md DP-7, 10.1; STYLE.md 11): every page type, in both themes, at a
// phone (375px), at 1280px under 200% zoom (640px), at a small laptop (1024px) and at a desktop
// (1440px), with no sideways scroll once its data has arrived, and every table inside the page's
// gutter. The long content (a 400-row trace, a 60-turn session) is the performance tests'
// (e2e-perf/); the style tests are unit tests.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, expectNoSidewaysScroll, test } from "./support"

interface Row {
  event_id: string
  outcome: string
  route?: string
  route_policy_version?: string
  profile?: { id: string; version: number }
}
const rows = (
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures/events/index.json"),
      "utf8",
    ),
  ) as { events: Row[] }
).events
const first = (outcome: string) => rows.find((row) => row.outcome === outcome)!.event_id
const routed = rows.find((row) => row.route && row.profile)!

const PAGES = [
  "/",
  "/traces",
  `/traces/${first("assembled")}`,
  `/traces/${first("refused")}?tab=excluded`,
  `/traces/${first("rejected")}`,
  "/sessions",
  "/sessions/refund-7",
  "/sources",
  "/conflicts",
  "/finops",
  "/conflicts?event=01M4YZXVT0N9BECJFQPP1EDDVP",
  "/guardrails",
  "/guardrails/05",
  "/registry/policies",
  `/registry/policies/${encodeURIComponent(routed.route!)}/${encodeURIComponent(routed.route_policy_version!)}`,
  "/registry/profiles",
  `/registry/profiles/${encodeURIComponent(routed.profile!.id)}/${routed.profile!.version}`,
  "/fleet",
  "/fleet/typescript",
  `/sandbox?event=${first("assembled")}`,
  "/glossary",
  "/telemetry",
  "/about",
  "/nowhere",
]
const WIDTHS = [375, 640, 1024, 1440]

for (const theme of ["light", "dark"] as const) {
  for (const path of PAGES) {
    test(`${path} fits every width in the ${theme} theme`, async ({ page }) => {
      await page.addInitScript((value) => window.localStorage.setItem("cwa-theme", value), theme)
      await page.goto(path)
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await page.waitForLoadState("networkidle")
      // The page's gutter: no table or scrolling region starts left of the title, and a status
      // line's text starts where the title does.
      await page.setViewportSize({ width: 1440, height: 900 })
      const outside = await page.evaluate(() => {
        const gutter = document.querySelector("h1")!.getBoundingClientRect().left
        const regions = [
          ...document.querySelectorAll("main table, main [data-slot='scroll-region']"),
        ]
          .filter((element) => element.getBoundingClientRect().left < gutter - 1)
          .map((element) => element.getAttribute("aria-label") ?? element.tagName)
        const statuses = [...document.querySelectorAll("main [data-slot='status-region']")]
          .filter((element) => {
            const text = element.firstElementChild ?? element
            return Math.abs(text.getBoundingClientRect().left - gutter) > 1
          })
          .map((element) => element.getAttribute("aria-label") ?? "status")
        return [...regions, ...statuses]
      })
      expect(outside, "tables and status lines off the page's gutter").toEqual([])
      for (const width of WIDTHS) {
        await test.step(`${width}px`, async () => {
          await page.setViewportSize({ width, height: 900 })
          await expectNoSidewaysScroll(page)
        })
      }
    })
  }
}

// A word in a table cell never breaks across lines (a hyphen or a slash may end a line); a table
// wider than its panel scrolls in its region instead. A chip in a cell holds one line.
for (const [path, table] of [
  ["/traces?outcome=refused", "Trace stream"],
  ["/fleet", "Conformance"],
  ["/fleet", "Services"],
] as const) {
  test(`${table} keeps its words and chips whole on a desktop`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(path)
    const element = page.getByRole("table", { name: table })
    await element.getByRole("row").nth(1).waitFor()
    const broken = await element.evaluate((root) => {
      const found: string[] = []
      const walker = document.createTreeWalker(root.querySelector("tbody")!, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        for (const match of (node.textContent ?? "").matchAll(/[^\s\-/]+[-/]?/g)) {
          const range = document.createRange()
          range.setStart(node, match.index)
          range.setEnd(node, match.index + match[0].length)
          const tops = new Set(
            [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
          )
          if (tops.size > 1) found.push(match[0])
        }
      }
      for (const chip of root.querySelectorAll("tbody [data-slot='badge']")) {
        const line = parseFloat(getComputedStyle(chip).lineHeight) || 12
        if (chip.getBoundingClientRect().height > 2 * line + 8) found.push(chip.textContent ?? "")
      }
      return found
    })
    expect(broken).toEqual([])
    await expectNoSidewaysScroll(page)
  })
}

test("the overview's metrics fill their rows, each value on one line", async ({ page }) => {
  await page.goto("/")
  const grid = page.getByRole("list", { name: "Metrics" })
  await grid.waitFor()
  for (const width of [1440, 1024, 375]) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: 900 })
      const layout = await grid.evaluate((list) => ({
        columns: getComputedStyle(list).gridTemplateColumns.split(" ").length,
        cells: list.children.length,
        broken: [...list.querySelectorAll("[data-slot='metric-value']")]
          .filter(
            (value) =>
              value.getBoundingClientRect().height >
              1.5 * parseFloat(getComputedStyle(value).lineHeight),
          )
          .map((value) => value.textContent),
      }))
      expect(
        layout.cells % layout.columns,
        `${layout.cells} cells in ${layout.columns} columns`,
      ).toBe(0)
      expect(layout.broken).toEqual([])
    })
  }
})
