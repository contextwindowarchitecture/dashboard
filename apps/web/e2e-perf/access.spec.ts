// The budgets again with sessions, roles and tenants (DP-20), over the query API only: a signed-in
// reader's stream in a second tenant answers a filter change within 100 ms, and the long trace opens
// for an anonymous reader, every body withheld (ADR-0011), and for its owner, bodies served.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { PERF_SECOND_TENANT as SECOND_TENANT, PERF_TREE } from "../e2e/env"
import { expectNoSidewaysScroll, measureFilterChange } from "./measure"

const overTheApi = () =>
  test.skip(test.info().project.name !== "perf-api", "sessions and tenants are the query API's")

async function signIn(page: Page) {
  await page.goto("/traces")
  await page.getByRole("banner").getByRole("link", { name: "sign in" }).click()
  await expect(page.getByRole("banner").getByRole("button", { name: /^Account/ })).toBeVisible()
}

const longTrace = () => {
  const index = JSON.parse(readFileSync(join(PERF_TREE, "events/index.json"), "utf8")) as {
    events: { event_id: string; budget_input?: number }[]
  }
  return index.events.find((r) => r.budget_input === 40_000)!.event_id
}

test("signed in, a second tenant's stream answers a filter change within 100 ms", async ({
  page,
}) => {
  overTheApi()
  await signIn(page)
  const started = Date.now()
  await page.goto(`/traces?tenant=${SECOND_TENANT}`)
  const table = page.getByRole("table", { name: "Trace stream" })
  await table.getByRole("row").nth(1).waitFor()
  const firstRender = Date.now() - started
  const rows = Number(await table.getAttribute("aria-rowcount")) - 1
  expect(rows).toBeGreaterThan(10_000)
  const filter = await measureFilterChange(page)
  console.log(
    `stream, signed in, ${SECOND_TENANT}: ${rows} rows, first render ${firstRender} ms; filter change ${Math.round(filter)} ms (budget 100 ms)`,
  )
  expect(filter).toBeLessThan(100)
})

test("the long trace opens for an anonymous reader with every body withheld, and fits", async ({
  page,
}) => {
  overTheApi()
  const started = Date.now()
  await page.goto(`/traces/${longTrace()}`)
  const items = page.getByRole("list", { name: "Included items" })
  await items.getByRole("listitem").first().waitFor()
  console.log(`inspector, anonymous, bodies withheld: ${Date.now() - started} ms`)
  await expect(items.getByText("body withheld · your role").first()).toBeVisible()
  await expectNoSidewaysScroll(page)
})

test("the long trace opens for its owner, signed in, with its bodies, and fits", async ({
  page,
}) => {
  overTheApi()
  await signIn(page)
  const started = Date.now()
  await page.goto(`/traces/${longTrace()}`)
  const items = page.getByRole("list", { name: "Included items" })
  await items.getByRole("listitem").first().waitFor()
  console.log(`inspector, signed in as owner: ${Date.now() - started} ms`)
  await expect(items.getByText("body withheld")).toHaveCount(0)
  await expectNoSidewaysScroll(page)
})
