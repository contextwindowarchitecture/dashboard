// Turns a document query into one region state (STYLE.md 6, Data regions), so a page switches on
// one shape. "No results" belongs to a page's filters and is decided there.

import type { DocumentQuery } from "./queries"
import { SourceError } from "./source"
import type { DocumentByKind, Kind } from "./validate"

export type RegionState<T> =
  | { status: "loading" }
  | { status: "error"; error: Error; retry: () => void }
  /** The source answered that the document is not there. */
  | { status: "not-found"; what: string }
  /** A document of no dashboard schema, another version, or another kind. */
  | { status: "unsupported"; schema: string | null; path: string }
  | { status: "invalid"; issues: string[]; path: string }
  | { status: "empty"; data: T }
  /** The document; `updating` while a newer copy is being fetched behind it. */
  | { status: "ok"; data: T; updating: boolean }

export function regionOf<K extends Kind>(
  query: DocumentQuery<K>,
  options: { what: string; isEmpty?: (document: DocumentByKind[K]) => boolean },
): RegionState<DocumentByKind[K]> {
  if (query.isPending) return { status: "loading" }
  if (query.isError) {
    if (query.error instanceof SourceError && query.error.kind === "not-found") {
      return { status: "not-found", what: options.what }
    }
    return { status: "error", error: query.error, retry: () => void query.refetch() }
  }
  const { result, path } = query.data
  if (!result.ok) {
    if (result.reason === "unsupported")
      return { status: "unsupported", schema: result.schema, path }
    if (result.reason === "wrong-kind") {
      return { status: "unsupported", schema: `cwa-dashboard/${result.actual}/v1`, path }
    }
    return { status: "invalid", issues: result.issues, path }
  }
  if (options.isEmpty?.(result.document)) return { status: "empty", data: result.document }
  return { status: "ok", data: result.document, updating: query.isFetching }
}
