// The one module that knows where the data lives (dashboard-plan.md 9; ADR-0001): an EventSource
// with one method per document kind. It returns parsed JSON and leaves validation to the boundary
// (validate.ts), so that a document of an unknown schema is a state, not an exception. Phase 1 reads
// the static tree; Phase 2's query API is a second implementation of the same interface.

import { errorMessage } from "./config.ts"

export type SourceErrorKind =
  | "not-found"
  /** The API asks the reader to sign in (401, ADR-0011). */
  | "unauthorised"
  /** The reader's roles do not include the document (403). */
  | "forbidden"
  | "http"
  | "network"
  | "parse"
  | "aborted"

/** A fetch that did not yield a document, and which way it failed. */
export class SourceError extends Error {
  override readonly name = "SourceError"
  readonly kind: SourceErrorKind
  readonly url: string
  /** The HTTP status, when there was a response. */
  readonly status: number | null

  constructor(kind: SourceErrorKind, url: string, message: string, status: number | null = null) {
    super(message)
    this.kind = kind
    this.url = url
    this.status = status
  }
}

export interface EventSource {
  /** The current window's index. */
  index(signal?: AbortSignal): Promise<unknown>
  /** A closed day's index, `YYYY-MM-DD` in UTC, as the current index lists it under `windows`. */
  window(day: string, signal?: AbortSignal): Promise<unknown>
  event(eventId: string, signal?: AbortSignal): Promise<unknown>
  session(sessionId: string, signal?: AbortSignal): Promise<unknown>
  fleet(signal?: AbortSignal): Promise<unknown>
  /** What each producer sent in the current window, and what became of it. */
  sources(signal?: AbortSignal): Promise<unknown>
  /** The URL a file of the tree is served at, for download links. */
  url(path: string): string
}

// Ids name files: an event's ULID, a session's id. One that could leave its directory, or name
// the index beside the events, names no document.
const EVENT_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The tree served under `root`; `fetchFn` is injectable so tests read the fixtures from disk. */
export function createFileSource(root: string, fetchFn: typeof fetch = fetch): EventSource {
  const base = root.replace(/\/+$/, "")
  const url = (path: string) => `${base}/${path}`

  async function json(target: string, signal: AbortSignal | undefined): Promise<unknown> {
    let response: Response
    try {
      response = await fetchFn(target, signal ? { signal } : undefined)
    } catch (error) {
      if (signal?.aborted) throw new SourceError("aborted", target, "request aborted")
      throw new SourceError("network", target, `could not fetch ${target}: ${errorMessage(error)}`)
    }
    if (response.status === 404)
      throw new SourceError("not-found", target, `${target} is not there`, 404)
    if (response.status === 401)
      throw new SourceError("unauthorised", target, `${target} needs a reader to sign in`, 401)
    if (response.status === 403)
      throw new SourceError("forbidden", target, `${target} is outside the reader's roles`, 403)
    if (!response.ok) {
      throw new SourceError(
        "http",
        target,
        `${target} answered ${response.status}`,
        response.status,
      )
    }
    try {
      return await response.json()
    } catch (error) {
      throw new SourceError("parse", target, `${target} is not JSON: ${errorMessage(error)}`)
    }
  }

  function byId(directory: string, pattern: RegExp, id: string, signal: AbortSignal | undefined) {
    const target = url(`${directory}/${encodeURIComponent(id)}.json`)
    if (!pattern.test(id))
      return Promise.reject(new SourceError("not-found", target, `${id} names no document`))
    return json(target, signal)
  }

  return {
    index: (signal) => json(url("events/index.json"), signal),
    window: (day, signal) => byId("events/index", DAY, day, signal),
    event: (eventId, signal) => byId("events", EVENT_ID, eventId, signal),
    session: (sessionId, signal) => byId("sessions", SESSION_ID, sessionId, signal),
    fleet: (signal) => json(url("fleet.json"), signal),
    sources: (signal) => json(url("sources.json"), signal),
    url,
  }
}
