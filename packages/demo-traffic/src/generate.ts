// The demo event tree: every vendored conformance case and rejection, and every turn of the authored
// scenarios, run through the pinned assembler by the wrapper, with the documents derived from them.
// Nothing in the tree is typed by hand. Every event says demo and was produced by the TypeScript
// assembler, and says so.
//
//   node src/generate.ts                         write packages/demo-traffic/fixtures/
//   node src/generate.ts --check                 write nothing; fail when the committed tree differs
//   node src/generate.ts --out <dir> --events N --seed S
//                                                a larger tree: N more events, the scenarios' turns
//                                                replayed with jittered budgets and services
//   node src/generate.ts --out <dir> --long      also a 400-row trace and a 60-turn session
//                                                (src/long.ts), for the performance tests
//
// The tree:
//   events/index.json        the current window's index (events-index v1)
//   events/index/<day>.json  the closed windows, when the tree holds more than one
//   events/<event id>.json   one assembly event v1 each
//   sessions/<id>.json       one session v1 per conversation
//   fleet.json               the fleet report v1
//
// Timings are measured, so they differ from run to run: the committed tree keeps the measurements,
// --check compares everything else, and a regeneration that changes only measurements writes
// nothing.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import {
  BUILT_ASSEMBLER,
  BUILT_CONTRACT_FILES,
  RENDERERS,
  TOKENIZERS,
} from "@cwa-dashboard/assembler"
import {
  buildSessions,
  fleetReport,
  indexFromRows,
  indexRow,
  windowRows,
} from "@cwa-dashboard/telemetry/derive"
import type { AssemblyEventV1, FleetReportV1 } from "@cwa-dashboard/telemetry/types"

import { longCalls } from "./long.ts"
import { SCENARIOS } from "./scenarios/index.ts"
import { record, ulid } from "./wrapper.ts"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
/** The dashboard's vendored contract files, by path, with their SHA-256 (packages/contract's lock). */
const CONTRACT_FILES = (
  JSON.parse(readFileSync(join(ROOT, "packages/contract/vendor/cwa.lock.json"), "utf8")) as {
    files: Record<string, string>
  }
).files
const VENDOR = join(ROOT, "packages/contract/vendor/cwa")
export const FIXTURES = join(ROOT, "packages/demo-traffic/fixtures")
const DEMO = "demo"

export interface Options {
  /** The current window (dashboard-plan.md 3): 24 hours and 20,000 events unless given. */
  readonly window?: { readonly hours: number; readonly max: number }
  /** More events beyond the committed set: the scenarios' turns replayed with jitter. */
  readonly events?: number
  /** A 400-row trace and a 60-turn session, for performance and visual checks (src/long.ts). */
  readonly long?: boolean
  readonly seed?: number
}

/** A small, seeded generator of values in [0, 1) (mulberry32), so a seed gives one tree. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Call {
  readonly snapshot: unknown
  readonly recordedAt: string
  readonly service: AssemblyEventV1["service"]
  readonly session?: AssemblyEventV1["session"]
  readonly redaction: { mode: AssemblyEventV1["redaction_mode"]; scrub?: readonly string[] }
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"))
const dirs = (path: string) =>
  readdirSync(path)
    .filter((name) => statSync(join(path, name)).isDirectory())
    .sort()

/** The calls the committed tree records, in recording order. */
function committedCalls(): Call[] {
  const conformance = [
    ...dirs(join(VENDOR, "conformance/cases")).map((id) => `conformance/cases/${id}`),
    ...dirs(join(VENDOR, "conformance/rejections")).map((id) => `conformance/rejections/${id}`),
  ]
  // The conformance suite runs early in the day, one call every 30 seconds.
  const suite: Call[] = conformance.map((path, i) => ({
    snapshot: readJson(join(VENDOR, path, "snapshot.json")),
    recordedAt: new Date(Date.parse("2026-10-15T05:00:00.000Z") + i * 30_000).toISOString(),
    service: { name: "conformance-suite", environment: DEMO },
    redaction: { mode: "full" },
  }))
  // A scenario's turn is recorded as it is assembled, half a second after its assembly time.
  const scenarios: Call[] = SCENARIOS.flatMap((scenario) =>
    scenario.turns.map((turn, turnIndex) => ({
      snapshot: turn.snapshot,
      recordedAt: new Date(Date.parse(turn.snapshot.assembly_time) + 500).toISOString(),
      service: { name: scenario.service, environment: DEMO },
      ...(scenario.session === undefined
        ? {}
        : { session: { id: scenario.session, turn_index: turnIndex } }),
      redaction: scenario.redaction,
    })),
  )
  return [...suite, ...scenarios]
}

/** More calls for a larger tree: the scenarios' turns again, with jittered budgets and instances. */
function volumeCalls(count: number, random: () => number): Call[] {
  const turns = SCENARIOS.flatMap((scenario) => scenario.turns.map((turn) => ({ scenario, turn })))
  return Array.from({ length: count }, (_, i) => {
    const { scenario, turn } = turns[i % turns.length]!
    const snapshot = structuredClone(turn.snapshot)
    // Within a tenth either way: the assembler decides what the new budget changes.
    snapshot.budget.input = Math.max(1, Math.round(snapshot.budget.input * (0.9 + 0.2 * random())))
    return {
      snapshot,
      recordedAt: new Date(
        Date.parse("2026-10-15T00:00:00.000Z") + Math.floor(random() * 86_400_000),
      ).toISOString(),
      service: {
        name: scenario.service,
        instance: `${scenario.service}-${i % 3}`,
        environment: DEMO,
      },
      redaction: scenario.redaction,
    }
  })
}

function fleet(events: readonly AssemblyEventV1[], generatedAt: string): FleetReportV1 {
  const lock = readJson(join(ROOT, "packages/contract/vendor/cwa.lock.json")) as {
    repository: string
    spec_commit: string
  }
  return fleetReport(events, {
    generatedAt,
    contract: { repository: lock.repository, commit: lock.spec_commit },
    // The one lock this generator knows is the built assembler's, so every demo service, which
    // runs it, is compared with the dashboard's contract file by file.
    contractFiles: {
      files: CONTRACT_FILES,
      knownLocks: { [BUILT_ASSEMBLER.contract.lock_sha256]: BUILT_CONTRACT_FILES },
    },
    typescriptTables: { tokenizers: Object.keys(TOKENIZERS), renderers: [...RENDERERS] },
  })
}

const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

/** The tree, as paths relative to its root and their contents. */
export function generateTree(options: Options = {}): Map<string, string> {
  const random = seeded(options.seed ?? 1)
  const long: Call[] = (options.long ? longCalls() : []).map((call) => ({
    ...call,
    service: { name: "support-assistant", environment: DEMO },
    redaction: { mode: "full" },
  }))
  const calls = [...committedCalls(), ...volumeCalls(options.events ?? 0, random), ...long]
  const events = calls.map((call) => {
    const eventId = ulid(Date.parse(call.recordedAt), random)
    return record(call.snapshot, {
      eventId,
      recordedAt: call.recordedAt,
      service: call.service,
      ...(call.session === undefined ? {} : { session: call.session }),
      redaction: call.redaction,
      traceId: `trace-${eventId.toLowerCase()}`,
    })
  })
  // Generated as of the newest event, so the tree does not depend on when it was generated.
  const generatedAt = events
    .map((event) => event.recorded_at)
    .sort()
    .at(-1)!
  const files = new Map<string, string>()
  // The current window in index.json, the rest closed into their days, as the ingest service keeps it.
  const { current, closed } = windowRows(
    events.map(indexRow),
    options.window ?? { hours: 24, max: 20_000 },
  )
  const windows = [...closed].map(([day, rows]) => {
    files.set(`events/index/${day}.json`, text(indexFromRows(rows, generatedAt)))
    return { day, path: `index/${day}.json`, events: rows.length }
  })
  const index = indexFromRows(current, generatedAt)
  files.set("events/index.json", text(windows.length > 0 ? { ...index, windows } : index))
  for (const event of events) files.set(`events/${event.event_id}.json`, text(event))
  for (const session of buildSessions(events))
    files.set(`sessions/${session.session_id}.json`, text(session))
  files.set("fleet.json", text(fleet(events, generatedAt)))
  return files
}

// --- comparing trees -----------------------------------------------------------------------------

/** A file's content with its measured timings set aside, for comparing two generations. */
export function withoutMeasurements(path: string, content: string): string {
  const value = JSON.parse(content) as Record<string, unknown>
  // A file of the wrong shape is compared as it is, and so reported as different.
  const list = (key: string) =>
    Array.isArray(value[key]) ? (value[key] as Record<string, unknown>[]) : []
  if (path === "events/index.json") {
    for (const row of list("events")) row["total_ms"] = 0
  } else if (path === "fleet.json") {
    for (const service of list("services")) {
      const latency = service["latency_ms"] as Record<string, number> | undefined
      for (const p of ["p50", "p95", "p99"]) if (latency && p in latency) latency[p] = 0
    }
  } else if (path.startsWith("events/")) {
    value["timings_ms"] = { total: 0 }
    const trace = value["trace"] as Record<string, unknown> | undefined
    if (trace) delete trace["timings"]
  }
  return JSON.stringify(value)
}

function readTree(root: string): Map<string, string> {
  const files = new Map<string, string>()
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith(".json"))
        files.set(relative(root, path).split(sep).join("/"), readFileSync(path, "utf8"))
    }
  }
  if (existsSync(root)) walk(root)
  return files
}

/** The differences between a generated tree and one on disk, measurements aside. */
export function differences(generated: Map<string, string>, root: string): string[] {
  const onDisk = readTree(root)
  const problems: string[] = []
  for (const [path, content] of generated) {
    const there = onDisk.get(path)
    if (there === undefined) problems.push(`${path}: missing`)
    else if (withoutMeasurements(path, there) !== withoutMeasurements(path, content))
      problems.push(`${path}: differs`)
  }
  for (const path of onDisk.keys())
    if (!generated.has(path)) problems.push(`${path}: not generated`)
  return problems
}

/**
 * Writes the tree, unless the tree on disk differs from it in measurements only: then it is left as
 * it is, so a regeneration that changes nothing real changes no file, and the index's and the fleet
 * report's timings stay those of the events beside them.
 */
export function writeTree(files: Map<string, string>, root: string): "written" | "unchanged" {
  if (existsSync(root) && differences(files, root).length === 0) return "unchanged"
  rmSync(root, { recursive: true, force: true })
  for (const [path, content] of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return "written"
}

function main(argv: string[]) {
  const option = (name: string) => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const events = Number(option("--events") ?? 0)
  const long = argv.includes("--long")
  const seed = Number(option("--seed") ?? 1)
  const out = resolve(option("--out") ?? FIXTURES)
  if (out === FIXTURES && (events !== 0 || seed !== 1 || long)) {
    process.stderr.write(
      "generate: the committed tree takes no --events, --seed or --long; give --out\n",
    )
    process.exit(2)
  }
  const files = generateTree({ events, seed, long })
  if (argv.includes("--check")) {
    const problems = differences(files, out)
    if (problems.length > 0) {
      process.stderr.write(
        `generate: ${problems.length} difference(s) from ${relative(ROOT, out)}, regenerate:\n`,
      )
      for (const problem of problems.slice(0, 20)) process.stderr.write(`  ${problem}\n`)
      process.exit(1)
    }
    process.stdout.write(
      `generate: ${files.size} files match ${relative(ROOT, out)}, measurements aside\n`,
    )
    return
  }
  const where = relative(ROOT, out) || out
  if (writeTree(files, out) === "unchanged") {
    process.stdout.write(`generate: ${where} is current, measurements aside; left as it is\n`)
  } else {
    process.stdout.write(`generate: wrote ${files.size} files into ${where}\n`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2))
