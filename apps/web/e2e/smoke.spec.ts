// The smoke test: the built app loads under the production Content Security Policy in both themes,
// axe finds nothing, and nothing scrolls sideways at a phone's width. It grows with every page.

import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import type { Page } from "@playwright/test"

import { E2E_CORPUS } from "./env"
import { expect, expectAccessible, expectNoSidewaysScroll, test } from "./support"

// The demo tree's event count, from its index, so the tests follow the tree when it grows.
const TOTAL = (
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures/events/index.json"),
      "utf8",
    ),
  ) as { events: unknown[] }
).events.length

const bodyBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)

test("the app loads under the production policy, in the light theme by default", async ({
  page,
}) => {
  const response = await page.goto("/")
  const policy = response?.headers()["content-security-policy"] ?? ""
  expect(policy).toContain("script-src 'self';")
  expect(policy).not.toContain("unsafe-eval")
  await expect(page).toHaveTitle("Overview — CWA dashboard")
  await expect(page.getByRole("main")).toHaveCount(1)
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible()
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

test("the trace stream lists the demo events and filters them through the URL", async ({
  page,
}) => {
  await page.goto("/traces")
  const table = page.getByRole("table", { name: "Trace stream" })
  await expect(table.getByRole("row")).toHaveCount(TOTAL + 1)
  await expect(page.getByRole("status", { name: "Stream status" })).toContainText(
    `${TOTAL} of ${TOTAL} events`,
  )
  await page.goto("/traces?outcome=refused")
  await expect(page.getByRole("status", { name: "Stream status" })).toContainText(
    new RegExp(`^\\d+ of ${TOTAL} events`),
  )
  const refusedRows = table.getByRole("row")
  await expect(refusedRows.nth(1)).toContainText("refused")
  await expectAccessible(page)
})

test("the trace stream reads in the dark theme and at a phone's width", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("cwa-theme", "dark"))
  await page.setViewportSize({ width: 400, height: 800 })
  await page.goto("/traces")
  await expect(page.getByRole("table", { name: "Trace stream" })).toBeVisible()
  await expectNoSidewaysScroll(page)
  await expectAccessible(page)
})

// The plan's DP-2 path: the stream, then an assembled, a refused and a rejected event, axe on each.
test("the inspector opens an assembled, a refused and a rejected event from the stream", async ({
  page,
}) => {
  for (const [filter, words] of [
    ["outcome=assembled", "assembled ·"],
    ["outcome=refused", "refused ·"],
    ["outcome=rejected", "rejected ·"],
  ] as const) {
    await page.goto(`/traces?${filter}`)
    const table = page.getByRole("table", { name: "Trace stream" })
    await table.getByRole("row").nth(1).getByRole("link").click()
    await expect(page).toHaveURL(/\/traces\/[0-9A-Z]{26}$/)
    await expect(page.getByRole("region", { name: "Outcome" })).toContainText(words)
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused()
    await expectAccessible(page)
    for (const tab of ["Excluded", "Conflicts", "Context", "Raw"]) {
      const trigger = page.getByRole("tab", { name: tab })
      if ((await trigger.count()) === 0) continue
      await trigger.click()
      await expect(page.getByRole("tabpanel", { name: tab })).toBeVisible()
      await expectAccessible(page)
    }
    // The title is the event's id: one line on a desktop, broken anywhere only at a phone's width.
    const title = page.getByRole("heading", { level: 1 })
    const lines = await title.evaluate(
      (h1) => h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight),
    )
    expect(Math.round(lines)).toBe(1)
    await page.setViewportSize({ width: 400, height: 800 })
    await expectNoSidewaysScroll(page)
    await page.setViewportSize({ width: 1280, height: 720 })
  }
})

// R-DASH-1 and R-DASH-2 in the browser: a full, a scrubbed and a digested event, bodies open.
test("the inspector shows bodies in each redaction mode, and passes axe with them open", async ({
  page,
}) => {
  for (const [session, words] of [
    ["refund-7", "body ·"],
    ["intake-12", "body scrubbed at source"],
    ["agent-run-412", "body redacted · digest_only"],
  ] as const) {
    await page.goto(`/traces?session=${session}&outcome=assembled`)
    await page
      .getByRole("table", { name: "Trace stream" })
      .getByRole("row")
      .nth(1)
      .getByRole("link")
      .click()
    const items = page.getByRole("list", { name: "Included items" })
    await expect(items.getByText(words).first()).toBeVisible()
    for (const summary of await items.locator("summary").all()) await summary.click()
    await expectAccessible(page)
  }
})

test("the overview sums the window and reads in both themes and at a phone's width", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("list", { name: "Metrics" })).toContainText(String(TOTAL))
  await expect(
    page.getByRole("list", { name: "Guardrails" }).getByRole("heading", { level: 3 }),
  ).toHaveCount(7)
  await expectAccessible(page)
  await page.addInitScript(() => window.localStorage.setItem("cwa-theme", "dark"))
  await page.setViewportSize({ width: 400, height: 800 })
  await page.goto("/")
  await expect(page.getByRole("list", { name: "Guardrails" })).toBeVisible()
  await expectNoSidewaysScroll(page)
  await expectAccessible(page)
})

// STYLE.md 7, Walk the trace: the lazily loaded choreography loads under the policy, plays a refused
// trace to its refusal with the stage in the URL, and under reduced motion still plays, instantly.
test("the stage walk plays a refused trace to its refusal, in both motion preferences", async ({
  page,
}) => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion })
    await page.goto("/traces?outcome=refused&reason=over_budget")
    await page
      .getByRole("table", { name: "Trace stream" })
      .getByRole("row")
      .nth(1)
      .getByRole("link")
      .click()
    await page.getByRole("tab", { name: "Excluded" }).click()
    const walk = page.getByRole("group", { name: "Stage walk" })
    await walk.getByRole("button", { name: "Play" }).click()
    await expect(page).toHaveURL(/[?&]stage=/)
    await expect(page.getByRole("region", { name: "Refusal" })).toBeVisible()
    await expect(page).toHaveURL(/[?&]stage=refusal/)
    await expect(walk.getByRole("button", { name: "Play" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    await expectAccessible(page)
  }
})

test("the sessions list reads in both themes and at a phone's width", async ({ page }) => {
  await page.goto("/sessions")
  const table = page.getByRole("table", { name: "Sessions" })
  await expect(table.getByRole("link", { name: "refund-7" })).toBeVisible()
  await expect(table).toContainText("25 of 66 parts")
  await expectAccessible(page)
  await page.addInitScript(() => window.localStorage.setItem("cwa-theme", "dark"))
  await page.setViewportSize({ width: 400, height: 800 })
  await page.goto("/sessions")
  await expect(table).toContainText("25 of 66 parts")
  await expectNoSidewaysScroll(page)
  await expectAccessible(page)
})

test("the sources page reads in both themes and at a phone's width, and links to the stream", async ({
  page,
}) => {
  await page.goto("/sources")
  const table = page.getByRole("table", { name: "Producers" })
  await expect(table.getByRole("rowheader", { name: "wiki-corpus" })).toBeVisible()
  await expectAccessible(page)
  await table
    .getByRole("link", { name: /duplicate_content/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/traces\?reason=duplicate_content$/)
  await page.addInitScript(() => window.localStorage.setItem("cwa-theme", "dark"))
  await page.setViewportSize({ width: 400, height: 800 })
  await page.goto("/sources")
  await expect(table.getByRole("rowheader", { name: "wiki-corpus" })).toBeVisible()
  await expectNoSidewaysScroll(page)
  await expectAccessible(page)
})

test("the conflicts page draws an event's forest, and reads in both themes and at 400px", async ({
  page,
}) => {
  await page.goto("/conflicts")
  const events = page.getByRole("table", { name: "Events" })
  await events.getByRole("link", { name: "01M4YZXVT0N9BECJFQPP1EDDVP" }).click()
  await expect(page.getByRole("img", { name: /Conflict forest/ })).toBeVisible()
  await expect(page.getByRole("table", { name: "Links" })).toContainText("conflict_lost")
  await expectAccessible(page)
  await page.addInitScript(() => window.localStorage.setItem("cwa-theme", "dark"))
  await page.setViewportSize({ width: 400, height: 800 })
  await page.goto("/conflicts?event=01M4YZXVT0N9BECJFQPP1EDDVP")
  await expect(page.getByRole("img", { name: /Conflict forest/ })).toBeVisible()
  await expectNoSidewaysScroll(page)
  await expectAccessible(page)
})

test("the FinOps page says money is not available without prices, in both themes and at 400px", async ({
  page,
}) => {
  await page.goto("/finops")
  await expect(page.getByRole("table", { name: "Routes" })).toContainText("support-chat")
  await expect(page.getByRole("region", { name: "Prices" })).toContainText(
    "per_million_input_tokens",
  )
  await expectAccessible(page)
  await page.addInitScript(() => window.localStorage.setItem("cwa-theme", "dark"))
  await page.setViewportSize({ width: 400, height: 800 })
  await page.goto("/finops")
  await expect(page.getByRole("table", { name: "Routes" })).toContainText("support-chat")
  await expectNoSidewaysScroll(page)
  await expectAccessible(page)
})

test("a compliance bundle shows what it proves, and verifies offline with the served key", async ({
  page,
  request,
}) => {
  const id = (
    JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures/events/index.json"),
        "utf8",
      ),
    ) as { events: { event_id: string; outcome: string; redaction_mode: string }[] }
  ).events.find((row) => row.outcome === "assembled" && row.redaction_mode === "full")!.event_id
  await page.goto(`/compliance?event=${id}`)
  const bundle = page.getByRole("region", { name: "Bundle" })
  await expect(bundle).toContainText("match")
  await expect(bundle).toContainText("Ed25519")
  await expectAccessible(page)
  // Offline: the bundle and the key as a reader would download them, and the repository's script.
  const dir = mkdtempSync(join(tmpdir(), "cwa-e2e-bundle-"))
  writeFileSync(
    join(dir, "bundle.json"),
    await (await request.get(`/api/bundles/${id}.json`)).body(),
  )
  writeFileSync(join(dir, "key.pem"), await (await request.get("/api/signing-key.pem")).body())
  const verified = spawnSync(
    process.execPath,
    [
      resolve(import.meta.dirname, "../../../deploy/verify-bundle.mjs"),
      join(dir, "bundle.json"),
      join(dir, "key.pem"),
    ],
    { encoding: "utf8" },
  )
  expect(verified.stdout).toContain("valid")
  expect(verified.status).toBe(0)
  await page.addInitScript(() => window.localStorage.setItem("cwa-theme", "dark"))
  await page.setViewportSize({ width: 400, height: 800 })
  await page.goto(`/compliance?event=${id}`)
  await expect(bundle).toContainText("match")
  await expectNoSidewaysScroll(page)
  await expectAccessible(page)
})

test("a shadow run shows what a candidate profile changes, in both themes and at 400px", async ({
  page,
}) => {
  test.skip(!!process.env["PLAYWRIGHT_BASE_URL"], "needs the corpus e2e/corpus.setup.ts freezes")
  await page.goto("/shadow")
  await page.getByRole("table", { name: "Corpora" }).getByRole("link", { name: E2E_CORPUS }).click()
  await expect(page).toHaveURL(new RegExp(`[?&]corpus=${E2E_CORPUS}$`))
  await page.getByRole("combobox", { name: "Start from" }).click()
  await page.getByRole("option", { name: /^Profile policy-first-chat v1/ }).click()
  await page.getByRole("button", { name: "Shadow" }).click()
  const report = page.getByRole("region", { name: "Shadow report" })
  await expect(report.getByRole("status", { name: "Shadow status" })).toContainText(
    "candidate profile policy-first-chat v1",
  )
  await expect(report.getByRole("table", { name: "Events" })).toContainText(
    "the same items, in another order",
  )
  await expect(report).toContainText("Every baseline replay reproduces what was recorded.")
  await expect(
    report
      .getByRole("listitem", { name: "Placement changed" })
      .locator('[data-slot="metric-value"]'),
  ).not.toHaveText("0")
  await expectAccessible(page)
  await page.addInitScript(() => window.localStorage.setItem("cwa-theme", "dark"))
  await page.setViewportSize({ width: 400, height: 800 })
  await page.reload()
  await page.getByRole("combobox", { name: "Start from" }).click()
  await page.getByRole("option", { name: /^Profile policy-first-chat v1/ }).click()
  await page.getByRole("button", { name: "Shadow" }).click()
  await expect(report.getByRole("table", { name: "Events" })).toContainText("changed")
  await expectNoSidewaysScroll(page)
  await expectAccessible(page)
})

test("a session opens from the list, selects a turn, and reads in both themes and at 400px", async ({
  page,
}) => {
  await page.goto("/sessions")
  await page
    .getByRole("table", { name: "Sessions" })
    .getByRole("link", { name: "refund-7" })
    .click()
  await expect(page).toHaveURL(/\/sessions\/refund-7$/)
  await expect(page.getByRole("img", { name: /5 turns/ })).toBeVisible()
  await expect(page.getByRole("region", { name: "Turn 4" })).toBeVisible()
  await page.getByRole("table", { name: "Turns" }).getByRole("link", { name: "Turn 3" }).click()
  await expect(page).toHaveURL(/[?&]turn=3/)
  await expect(page.getByRole("region", { name: "Turn 3" })).toContainText("over_budget")
  const player = page.getByRole("group", { name: "Session player" })
  await player.getByRole("button", { name: "Step back" }).focus()
  await page.keyboard.press("ArrowLeft")
  await expect(page).toHaveURL(/[?&]turn=2/)
  await expect(player.getByRole("button", { name: "Step back" })).toBeFocused()
  await expect(page.getByRole("region", { name: "Turn 2" })).toBeVisible()
  await expectAccessible(page)
  await page.addInitScript(() => window.localStorage.setItem("cwa-theme", "dark"))
  await page.setViewportSize({ width: 400, height: 800 })
  await page.goto("/sessions/intake-12?turn=2")
  await expect(page.getByRole("region", { name: "Turn 2" })).toBeVisible()
  // Drawn at its column's width, not clipped from the fallback's.
  await expect
    .poll(async () =>
      Number(await page.locator("[data-slot=chart-frame] svg").getAttribute("width")),
    )
    .toBeLessThan(400)
  await expectNoSidewaysScroll(page)
  await expectAccessible(page)
})

// STYLE.md 7, Play the session: the lazily loaded choreography loads under the policy and plays a
// session to its last turn, the firsts' markers appearing, in both motion preferences.
test("a session plays to its last turn, in both motion preferences", async ({ page }) => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion })
    await page.goto("/sessions/refund-7")
    const player = page.getByRole("group", { name: "Session player" })
    await player.getByRole("group", { name: "Speed" }).getByRole("button", { name: "2×" }).click()
    await player.getByRole("button", { name: "Play" }).click()
    await expect(page).toHaveURL(/[?&]turn=0/)
    await expect(page).toHaveURL(/[?&]turn=4/)
    await expect(player.getByRole("button", { name: "Play" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    await expect(page.getByRole("list", { name: "Markers" })).toContainText("first compressed")
    await expect(player.getByRole("status")).toContainText("Turn 4 · step 5 of 5")
    await expectAccessible(page)
  }
})

test("the registry's pages read in both themes and at a phone's width", async ({ page }) => {
  await page.goto("/registry/policies")
  await expect(page.getByRole("region", { name: "Drift", exact: true })).toBeVisible()
  await page
    .getByRole("table", { name: "Route policies" })
    .getByRole("link", { name: "support-chat illustrative/v1" })
    .click()
  await expect(page).toHaveURL(/\/registry\/policies\/support-chat\/illustrative%2Fv1$/)
  await expect(page.getByRole("table", { name: "Slot rules" })).toBeVisible()
  await expectAccessible(page)
  await page.addInitScript(() => window.localStorage.setItem("cwa-theme", "dark"))
  await page.setViewportSize({ width: 400, height: 800 })
  for (const path of [
    "/registry/policies",
    "/registry/policies/support-chat/conflict-fact%2Fv1",
    "/registry/profiles",
    "/registry/profiles/cache-first-chat/1",
  ]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expectNoSidewaysScroll(page)
    await expectAccessible(page)
  }
})

test("the fleet and an implementation's cases read in both themes and at a phone's width", async ({
  page,
}) => {
  await page.goto("/fleet")
  await expect(page.getByRole("table", { name: "Conformance" })).toBeVisible()
  await expect(page.getByRole("img", { name: /P50, P95 and P99/ })).toBeVisible()
  await expectAccessible(page)
  await page
    .getByRole("table", { name: "Conformance" })
    .getByRole("link", { name: "typescript" })
    .click()
  await page
    .getByRole("table", { name: "Cases" })
    .getByRole("link", { name: "R-26" })
    .first()
    .click()
  await expect(page).toHaveURL(/\/fleet\/typescript\?rule=R-26$/)
  await expect(page.getByRole("status", { name: "Cases status" })).toContainText("exercise R-26")
  await expectAccessible(page)
  await page.addInitScript(() => window.localStorage.setItem("cwa-theme", "dark"))
  await page.setViewportSize({ width: 400, height: 800 })
  for (const path of ["/fleet", "/fleet/typescript"]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expectNoSidewaysScroll(page)
    await expectAccessible(page)
  }
})

test("the guardrails and a guardrail's page read in both themes and at a phone's width", async ({
  page,
}) => {
  await page.goto("/guardrails")
  await page.getByRole("link", { name: "05 · Displacement under budget" }).click()
  await expect(page).toHaveURL(/\/guardrails\/05$/)
  await expect(page.getByRole("table", { name: "Codes" })).toBeVisible()
  await expectAccessible(page)
  await page.addInitScript(() => window.localStorage.setItem("cwa-theme", "dark"))
  await page.setViewportSize({ width: 400, height: 800 })
  for (const path of ["/guardrails", "/guardrails/05", "/guardrails/06"]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expectNoSidewaysScroll(page)
    await expectAccessible(page)
  }
})

test("the sandbox says when the replay service is not configured, and reads in both themes", async ({
  page,
}) => {
  // The deployment's own config.json without its apiBase, wherever its documents are.
  await page.route("**/config.json", async (route) => {
    const { apiBase: _apiBase, ...config } = await (await route.fetch()).json()
    await route.fulfill({ json: config })
  })
  await page.goto("/traces?outcome=assembled")
  await page
    .getByRole("table", { name: "Trace stream" })
    .getByRole("row")
    .nth(1)
    .getByRole("link")
    .click()
  await page.getByRole("link", { name: "Replay in the sandbox →" }).click()
  await expect(page).toHaveURL(/\/sandbox\?event=[0-9A-Z]{26}$/)
  await expect(page.getByRole("region", { name: "Replay service" })).toContainText("not configured")
  await expectAccessible(page)
  await page.addInitScript(() => window.localStorage.setItem("cwa-theme", "dark"))
  await page.setViewportSize({ width: 400, height: 800 })
  await page.reload()
  await expect(page.getByRole("region", { name: "Replay service" })).toBeVisible()
  await expectNoSidewaysScroll(page)
  await expectAccessible(page)
})

// DP-5: a demo event replays through the real assembler on the replay service to the hash it
// recorded; a budget too small for its protected content refuses; a service that does not answer
// is said not to.
const REFUND_TURN = (
  JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        "../../../packages/demo-traffic/fixtures/sessions/refund-7.json",
      ),
      "utf8",
    ),
  ) as { turns: { event_id: string }[] }
).turns[0]!.event_id
const recordedHash = (
  JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        `../../../packages/demo-traffic/fixtures/events/${REFUND_TURN}.json`,
      ),
      "utf8",
    ),
  ) as { payload: { hash: string } }
).payload.hash

test("the sandbox replays an event to the hash it recorded, through the service", async ({
  page,
}) => {
  await page.goto(`/sandbox?event=${REFUND_TURN}`)
  await page.getByRole("button", { name: "Replay" }).click()
  const parity = page.getByRole("region", { name: "Parity" })
  await expect(parity).toContainText("Parity · equal")
  await expect(parity).toContainText(recordedHash)
  await expect(page.getByRole("region", { name: "Trace diff lines" })).toContainText("No change")
  await expectAccessible(page)
})

test("the sandbox refuses a budget too small for the protected content, and says so", async ({
  page,
}) => {
  await page.goto(`/sandbox?event=${REFUND_TURN}`)
  await page.getByRole("spinbutton", { name: "budget.input" }).fill("10")
  await expect(page).toHaveURL(/[?&]input=10/)
  await page.getByRole("button", { name: "Replay" }).click()
  const result = page.getByRole("region", { name: "Replay result" })
  await expect(result).toContainText("refused")
  await expect(result).toContainText("protected_content_over_budget")
  await expect(page.getByRole("region", { name: "Parity" })).toContainText("no parity claimed")
  await expectAccessible(page)
  await page.setViewportSize({ width: 400, height: 800 })
  await expectNoSidewaysScroll(page)
})

test("the sandbox says so when the replay service does not answer", async ({
  page,
  pageErrors: seen,
}) => {
  await page.route("**/api/replay", (route) => route.abort())
  await page.goto(`/sandbox?event=${REFUND_TURN}`)
  await page.getByRole("button", { name: "Replay" }).click()
  await expect(page.getByRole("region", { name: "Replay result" })).toContainText("did not answer")
  // The request this test aborts is logged as a failed load; that one error is expected, no other.
  const expected = seen.filter((message) =>
    /Failed to load resource: net::ERR_FAILED/.test(message),
  )
  expect(expected).toHaveLength(1)
  seen.splice(seen.indexOf(expected[0]!), 1)
})

test("the sandbox replays a pasted snapshot through the service, and offers the results", async ({
  page,
}) => {
  const snapshot = readFileSync(
    resolve(
      import.meta.dirname,
      "../../../packages/contract/vendor/cwa/conformance/cases/budget-margin/snapshot.json",
    ),
    "utf8",
  )
  await page.goto("/sandbox")
  await page.getByRole("textbox", { name: "Snapshot JSON" }).fill(snapshot)
  await page.getByRole("button", { name: "Replay" }).click()
  const result = page.getByRole("region", { name: "Replay result" })
  await expect(result).toContainText("No recorded event to compare with")
  await expect(result.getByRole("link", { name: "Download the trace" })).toHaveAttribute(
    "download",
    "snapshot.replay.trace.json",
  )
  await expectAccessible(page)
  await page.setViewportSize({ width: 400, height: 800 })
  await expectNoSidewaysScroll(page)
})

test("a reason chip lands on its glossary entry, and the glossary reads at a phone's width", async ({
  page,
}) => {
  await page.goto("/traces?reason=expired")
  await page
    .getByRole("table", { name: "Trace stream" })
    .getByRole("row")
    .nth(1)
    .getByRole("link")
    .click()
  await page.getByRole("tab", { name: "Excluded" }).click()
  await page
    .getByRole("tabpanel", { name: "Excluded" })
    .getByRole("link", { name: /^expired/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/glossary#reason-expired$/)
  await expect(page.locator("#reason-expired")).toBeInViewport()
  await expectAccessible(page)
  await page.setViewportSize({ width: 400, height: 800 })
  await page.goto("/glossary#rule-R-16")
  await expect(page.locator("#rule-R-16")).toBeInViewport()
  await expectNoSidewaysScroll(page)
  await expectAccessible(page)
})

test("the telemetry and about pages read in both themes and at a phone's width", async ({
  page,
}) => {
  for (const path of ["/telemetry", "/about"]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expectAccessible(page)
  }
  await page.addInitScript(() => window.localStorage.setItem("cwa-theme", "dark"))
  await page.setViewportSize({ width: 400, height: 800 })
  for (const path of ["/telemetry", "/about"]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expectNoSidewaysScroll(page)
    await expectAccessible(page)
  }
})
