// The store behind POST /events and the read routes (ADR-0007): it takes events and serves the
// documents the static tree holds, at the tree's own places: the index, the closed days, each event and
// session, the fleet report and the sources report. The tree store (store.ts) and the
// PostgreSQL store (postgres-store.ts) implement it, and one contract suite holds both to it.

import { readFileSync } from "node:fs"

import {
  BUILT_ASSEMBLER,
  BUILT_CONTRACT_FILES,
  RENDERERS,
  TOKENIZERS,
} from "@cwa-dashboard/assembler"
import type { FleetInputs } from "@cwa-dashboard/telemetry/derive"
import type {
  AssemblyEventV1,
  CorpusV1,
  EventsIndexV1,
  FleetReportV1,
  SessionV1,
  SourcesReportV1,
} from "@cwa-dashboard/telemetry/types"
import { validateAssemblyEventV1 } from "@cwa-dashboard/telemetry/validators"

export type WriteResult =
  | { readonly ok: true; readonly eventId: string }
  | { readonly ok: false; readonly kind: "invalid" | "duplicate"; readonly problems: string[] }

export interface EventStore {
  /** Validates and keeps an event; a second event with the same id is refused. */
  write(candidate: unknown): Promise<WriteResult>
  /** The current window's index, listing the closed days. */
  index(): Promise<EventsIndexV1>
  /** A closed day's index, `YYYY-MM-DD` in UTC. */
  window(day: string): Promise<EventsIndexV1 | undefined>
  event(eventId: string): Promise<AssemblyEventV1 | undefined>
  session(sessionId: string): Promise<SessionV1 | undefined>
  fleet(): Promise<FleetReportV1>
  /** What each producer sent in the current window, and what became of it. */
  sources(): Promise<SourcesReportV1>
  /** Freezes a corpus under its name (ADR-0008); a name already taken is never overwritten. */
  saveCorpus(corpus: CorpusV1): Promise<"saved" | "exists">
  corpus(name: string): Promise<CorpusV1 | undefined>
  /** Every corpus, by name, with when it was frozen and how many events it holds. */
  corpora(): Promise<CorpusSummary[]>
  /** Brings every document up to date with the events written so far. */
  flush(): Promise<void>
  close(): Promise<void>
}

/** The current window: the newest 24 hours, at most 20,000 events (dashboard-plan.md 3). */
export const WINDOW = { hours: 24, max: 20_000 } as const

// Ids name documents: an event's ULID, a session's id, a day. Anything else names none.
export const EVENT_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/
export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
export const DAY = /^\d{4}-\d{2}-\d{2}$/
export const CORPUS_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/

export interface CorpusSummary {
  readonly name: string
  readonly created_at: string
  readonly events: number
}

/** The problems a validator found, in words: where, then what. */
export function describeProblems(errors: typeof validateAssemblyEventV1.errors): string[] {
  return (errors ?? []).slice(0, 20).map((error) => {
    const where = error.instancePath === "" ? "the event" : error.instancePath
    const missing = (error.params as { missingProperty?: string }).missingProperty
    return missing ? `${where} has no ${missing}` : `${where} ${error.message ?? "is invalid"}`
  })
}

const LOCK = JSON.parse(
  readFileSync(new URL("../../../packages/contract/vendor/cwa.lock.json", import.meta.url), "utf8"),
) as { repository: string; spec_commit: string; files: Record<string, string> }

/**
 * What the fleet report needs besides the events, as this service knows it: the dashboard's
 * contract lock, the one assembler lock it can compare file by file (the build it replays with),
 * and that build's tables. The generator passes the same, so the demo tree's report and a store's
 * agree.
 */
export function fleetInputs(generatedAt: string): FleetInputs {
  return {
    generatedAt,
    contract: { repository: LOCK.repository, commit: LOCK.spec_commit },
    contractFiles: {
      files: LOCK.files,
      knownLocks: { [BUILT_ASSEMBLER.contract.lock_sha256]: BUILT_CONTRACT_FILES },
    },
    typescriptTables: { tokenizers: Object.keys(TOKENIZERS), renderers: [...RENDERERS] },
  }
}
