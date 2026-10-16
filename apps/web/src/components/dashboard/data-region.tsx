// One region of data in one of its states (STYLE.md 6, Data regions), told apart by words. The
// "updating" state is the page's status region's to announce; the data stays on screen meanwhile.

import type { ReactNode } from "react"

import type { RegionState } from "../../data/region"
import { EmptyState } from "./empty-state"

const SHOWN_ISSUES = 5

export interface DataRegionProps<T> {
  readonly region: RegionState<T>
  /** What the region holds, for the loading announcement: "the trace stream". */
  readonly label: string
  /** The empty state's words, when the page's data can be validly empty. */
  readonly empty?: { readonly title: string; readonly body: ReactNode }
  /** A still placeholder of the content's final size; one block when absent. */
  readonly skeleton?: ReactNode
  readonly children: (data: T) => ReactNode
}

export function DataRegion<T>({ region, label, empty, skeleton, children }: DataRegionProps<T>) {
  switch (region.status) {
    case "loading":
      return (
        <div role="status" aria-label={`Loading ${label}…`} data-slot="loading-region">
          {skeleton ?? <div data-slot="placeholder-block" />}
        </div>
      )
    case "error":
      return (
        <div role="alert" data-slot="note">
          <p>{region.error.message}</p>
          <button type="button" data-slot="ghost-button" onClick={region.retry}>
            Retry
          </button>
        </div>
      )
    case "not-found":
      return (
        <div data-slot="missing-panel">
          <p>{region.what} is not there.</p>
        </div>
      )
    case "unsupported":
      return (
        <div role="alert" data-slot="note">
          <p>
            This dashboard reads its own documents at v1; <code>{region.path}</code> declares{" "}
            {region.schema === null ? "no $schema" : <code>{region.schema}</code>}.
          </p>
        </div>
      )
    case "invalid": {
      const shown = region.issues.slice(0, SHOWN_ISSUES)
      const more = region.issues.length - shown.length
      return (
        <div role="alert" data-slot="note">
          <p>
            <code>{region.path}</code> does not match its schema:
          </p>
          <ul>
            {shown.map((issue) => (
              <li key={issue}>
                <code>{issue}</code>
              </li>
            ))}
          </ul>
          {more > 0 ? <p>and {more} more</p> : null}
        </div>
      )
    }
    case "empty":
      return (
        <EmptyState title={empty?.title ?? "Nothing here"}>
          {empty?.body ?? <p>There is no data for this region.</p>}
        </EmptyState>
      )
    case "ok":
      return <>{children(region.data)}</>
  }
}
