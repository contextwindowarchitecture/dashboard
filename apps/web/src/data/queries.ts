// Remote data ownership (dashboard-plan.md 9): TanStack Query over the EventSource, one hook per
// document kind, each parsed at the boundary. Events, sessions and the fleet report never change
// once written, so they are fresh for good; the index is the one document that changes, so it
// refetches on focus and every 30 seconds while the page is visible, and pages keep showing what
// they had while it does. A document that is not there, not JSON or not supported is never
// retried; a network or server failure is retried once.

import { useQuery, type UseQueryResult } from "@tanstack/react-query"

import { useData } from "./data-context"
import { type EventSource, SourceError } from "./source"
import { type DocumentByKind, type Kind, parseDocument, type ParseResult } from "./validate"

export interface Fetched<K extends Kind> {
  readonly result: ParseResult<K>
  /** The URL the document was read from, for the states that name it. */
  readonly path: string
}

export type DocumentQuery<K extends Kind> = UseQueryResult<Fetched<K>, Error>

const INDEX_POLL_MS = 30_000

const retry = (failures: number, error: Error) =>
  error instanceof SourceError &&
  (error.kind === "network" || error.kind === "http") &&
  failures < 1

function useDocument<K extends Kind>(
  kind: K,
  key: readonly string[],
  path: (source: EventSource) => string,
  load: (source: EventSource, signal: AbortSignal) => Promise<unknown>,
  live = false,
): DocumentQuery<K> {
  const { source, root } = useData()
  return useQuery({
    queryKey: ["data", root, ...key],
    queryFn: async ({ signal }) => ({
      result: parseDocument(kind, await load(source, signal)),
      path: path(source),
    }),
    retry,
    ...(live
      ? {
          staleTime: 0,
          refetchOnWindowFocus: true,
          refetchInterval: INDEX_POLL_MS,
          refetchIntervalInBackground: false,
        }
      : { staleTime: Infinity }),
  })
}

export const useIndex = () =>
  useDocument(
    "events-index",
    ["index"],
    (s) => s.url("events/index.json"),
    (s, signal) => s.index(signal),
    true,
  )

export const useEvent = (eventId: string) =>
  useDocument(
    "assembly-event",
    ["event", eventId],
    (s) => s.url(`events/${eventId}.json`),
    (s, signal) => s.event(eventId, signal),
  )

export const useSession = (sessionId: string) =>
  useDocument(
    "session",
    ["session", sessionId],
    (s) => s.url(`sessions/${sessionId}.json`),
    (s, signal) => s.session(sessionId, signal),
  )

export const useFleet = () =>
  useDocument(
    "fleet-report",
    ["fleet"],
    (s) => s.url("fleet.json"),
    (s, signal) => s.fleet(signal),
  )

export type { DocumentByKind }
