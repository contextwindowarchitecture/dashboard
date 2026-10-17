// Remote data ownership (dashboard-plan.md 9): TanStack Query over the EventSource, one hook per
// document kind, each parsed at the boundary. An event never changes once written, so it is fresh
// for good. The index, a session and the fleet report change as events arrive (a store rebuilds
// them, ADR-0007), so they refetch on focus and every 30 seconds while the page is visible, and
// pages keep showing what they had while they do. A document that is not there, not JSON or not supported is never
// retried; a network or server failure is retried once.

import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query"

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

function documentOptions<K extends Kind>(
  { source, root }: { source: EventSource; root: string },
  kind: K,
  key: readonly string[],
  path: (source: EventSource) => string,
  load: (source: EventSource, signal: AbortSignal) => Promise<unknown>,
  live = false,
) {
  return {
    queryKey: ["data", root, ...key],
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Fetched<K>> => ({
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
  }
}

function useDocument<K extends Kind>(
  kind: K,
  key: readonly string[],
  path: (source: EventSource) => string,
  load: (source: EventSource, signal: AbortSignal) => Promise<unknown>,
  live = false,
): DocumentQuery<K> {
  return useQuery(documentOptions(useData(), kind, key, path, load, live))
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

const sessionOptions = (data: { source: EventSource; root: string }, sessionId: string) =>
  documentOptions(
    data,
    "session",
    ["session", sessionId],
    (s) => s.url(`sessions/${sessionId}.json`),
    (s, signal) => s.session(sessionId, signal),
    true,
  )

export const useSession = (sessionId: string): DocumentQuery<"session"> =>
  useQuery(sessionOptions(useData(), sessionId))

/** Several sessions at once, one query each, sharing the cache useSession fills. */
export const useSessions = (sessionIds: readonly string[]): DocumentQuery<"session">[] => {
  const data = useData()
  return useQueries({ queries: sessionIds.map((id) => sessionOptions(data, id)) })
}

export const useFleet = () =>
  useDocument(
    "fleet-report",
    ["fleet"],
    (s) => s.url("fleet.json"),
    (s, signal) => s.fleet(signal),
    true,
  )

export type { DocumentByKind }
