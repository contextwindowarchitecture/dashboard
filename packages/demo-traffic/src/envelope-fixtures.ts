// Writes packages/telemetry/fixtures/envelope/: for a handful of vendored cases, the envelope inputs
// (recording.json), the event a wrapper must emit for them in each redaction mode, and the bodies a
// route opted into the vault deposits (deposits.json, ADR-0009). They are the
// oracle every wrapper, in every language, reproduces, so wrappers never disagree on a digest, a
// count, a part or a redacted form (dashboard-plan.md 3). This wrapper is the first to pass them.
//
//   node src/envelope-fixtures.ts            write the fixtures
//   node src/envelope-fixtures.ts --check    write nothing; fail, naming each fixture that differs
//
// timings_ms.total is the wrapper's measurement: the fixtures hold 0 and comparisons ignore it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"

import {
  bodyDeposits,
  type BodyDeposit,
  type Recording,
  record,
  type RedactionMode,
} from "./wrapper.ts"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const VENDOR = join(ROOT, "packages/contract/vendor/cwa")
export const FIXTURES = join(ROOT, "packages/telemetry/fixtures/envelope")
export const MODES: readonly RedactionMode[] = ["full", "pii_scrubbed", "digest_only"]

/** The cases, chosen to span the renderers, the outcomes and the bodies redaction must handle. */
export const ENVELOPE_CASES = [
  "conformance/cases/fixture-three-slot",
  "conformance/cases/messages-render",
  "conformance/cases/blocks-render",
  "conformance/cases/budget-variant-choice",
  "conformance/cases/protected-over-budget",
  "conformance/cases/admission-reasons",
  "conformance/rejections/schema-missing-budget",
] as const

export interface FixtureRecording {
  /** The vendored case whose snapshot.json the wrapper is given. */
  readonly case: string
  readonly event_id: string
  readonly recorded_at: string
  readonly service: AssemblyEventV1["service"]
  readonly session?: AssemblyEventV1["session"]
  readonly trace_id: string
  /** The scrubber's declared terms, for pii_scrubbed. */
  readonly scrub: readonly string[]
}

export function recordingFor(path: string, i: number): FixtureRecording {
  const id = path.split("/").at(-1)!
  return {
    case: path,
    event_id: `01JA3000000000000000000${String(i).padStart(3, "0")}`,
    recorded_at: `2026-10-15T06:00:${String(i * 5).padStart(2, "0")}.000Z`,
    service: { name: "envelope-conformance", environment: "demo" },
    session: { id: "envelope-conformance", turn_index: i },
    trace_id: `envelope-${id}`,
    scrub: ["Pro", "Northwind"],
  }
}

/** The event a wrapper emits for the recording in a mode, with its measured timing set to 0. */
export function expectedEvent(recording: FixtureRecording, mode: RedactionMode): AssemblyEventV1 {
  const snapshot = JSON.parse(readFileSync(join(VENDOR, recording.case, "snapshot.json"), "utf8"))
  const inputs: Recording = {
    eventId: recording.event_id,
    recordedAt: recording.recorded_at,
    service: recording.service,
    ...(recording.session === undefined ? {} : { session: recording.session }),
    redaction: { mode, scrub: recording.scrub },
    traceId: recording.trace_id,
  }
  const event = record(snapshot, inputs)
  const trace = event.trace === undefined ? undefined : withoutTimings(event.trace)
  return { ...event, ...(trace === undefined ? {} : { trace }), timings_ms: { total: 0 } }
}

/** What a route opted into the vault deposits for the recording's snapshot, in any mode but full. */
export function expectedDeposits(recording: FixtureRecording): BodyDeposit[] {
  return bodyDeposits(
    JSON.parse(readFileSync(join(VENDOR, recording.case, "snapshot.json"), "utf8")),
  )
}

// An assembler's own per-stage timings are measurements too; the fixtures leave them out.
function withoutTimings<T extends object>(trace: T): T {
  const copy = { ...trace } as Record<string, unknown>
  delete copy["timings"]
  return copy as T
}

const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

function outputs(): Map<string, string> {
  const files = new Map<string, string>()
  ENVELOPE_CASES.forEach((path, i) => {
    const recording = recordingFor(path, i)
    const dir = path.split("/").at(-1)!
    files.set(`${dir}/recording.json`, text(recording))
    for (const mode of MODES) files.set(`${dir}/${mode}.json`, text(expectedEvent(recording, mode)))
    files.set(`${dir}/deposits.json`, text(expectedDeposits(recording)))
  })
  return files
}

function main() {
  const files = outputs()
  if (process.argv.includes("--check")) {
    const stale = [...files].filter(([name, content]) => {
      const path = join(FIXTURES, name)
      return !existsSync(path) || readFileSync(path, "utf8") !== content
    })
    if (stale.length > 0) {
      process.stderr.write(
        `envelope-fixtures: stale, regenerate: ${stale.map(([n]) => n).join(", ")}\n`,
      )
      process.exit(1)
    }
    process.stdout.write(`envelope-fixtures: ${files.size} files current\n`)
    return
  }
  for (const [name, content] of files) {
    const path = join(FIXTURES, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  process.stdout.write(
    `envelope-fixtures: wrote ${files.size} files into packages/telemetry/fixtures/envelope\n`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
