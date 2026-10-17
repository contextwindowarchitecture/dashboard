// The demo tree as a store keeps it once its window has moved on: the same events, the index
// re-windowed to the newest `hours` with the derivations a store uses, older rows closed into their
// day's index, listed under `windows`. A temporary copy, for the stream's paging tests.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { indexFromRows, windowRows } from "@cwa-dashboard/telemetry/derive"
import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"

import { FIXTURES_DIR } from "./fixture-fetch"

export function windowedTree(hours: number) {
  const dir = mkdtempSync(join(tmpdir(), "cwa-windowed-"))
  cpSync(FIXTURES_DIR, dir, { recursive: true })
  const all = JSON.parse(readFileSync(join(dir, "events/index.json"), "utf8")) as EventsIndexV1
  const { current, closed } = windowRows(all.events, { hours, max: 20_000 })
  const generatedAt = all.generated_at
  mkdirSync(join(dir, "events/index"), { recursive: true })
  const windows = [...closed]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, rows]) => {
      writeFileSync(
        join(dir, `events/index/${day}.json`),
        JSON.stringify(indexFromRows(rows, generatedAt)),
      )
      return { day, path: `index/${day}.json`, events: rows.length }
    })
  const index = { ...indexFromRows(current, generatedAt), windows }
  writeFileSync(join(dir, "events/index.json"), JSON.stringify(index))
  return { dir, current, closed, windows }
}
