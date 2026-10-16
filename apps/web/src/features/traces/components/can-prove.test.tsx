import { readFileSync } from "node:fs"
import { join } from "node:path"

import { SCOPE } from "@cwa-dashboard/contract/data"
import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { reasonInfo } from "../../../lib/reasons"
import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { renderApp } from "../../../test/render-app"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const load = (id: string) =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, "events", `${id}.json`), "utf8")) as AssemblyEventV1
const REFUSED = index.events.find(
  (row) => row.session?.id === "intake-12" && row.session.turn_index === 2,
)!.event_id

describe("what this trace can prove", () => {
  it("gives each requirement behind the trace's codes its scope, in assembler-scope.json's words", async () => {
    const event = load(REFUSED)
    const codes = [...event.trace!.excluded.map((row) => row.reason), event.trace!.refused.reason!]
    const rules = [...new Set(codes.map((code) => reasonInfo(code)!.rule))]
    renderApp(`/traces/${REFUSED}?tab=context`)
    const note = await screen.findByRole("region", { name: "What this trace can prove" })
    for (const rule of rules) {
      const entry = SCOPE.find((s) => s.id === rule)!
      const item = within(note).getByRole("listitem", { name: rule })
      expect(item).toHaveTextContent(entry.scope)
      expect(item).toHaveTextContent(entry.note)
    }
  })

  it("names the requirements that are the application's, which no trace can show", async () => {
    renderApp(`/traces/${REFUSED}?tab=context`)
    const note = await screen.findByRole("region", { name: "What this trace can prove" })
    const application = SCOPE.filter((s) => s.scope === "application").map((s) => s.id)
    expect(application.length).toBeGreaterThan(0)
    for (const id of application) expect(note).toHaveTextContent(id)
  })
})
