// The trace stream (dashboard-plan.md 7.2): the index's events, filtered by the URL, newest first,
// each row linking to its inspector. The filter bar offers what the index counted, and the window:
// the current one or a closed day the index lists (ADR-0007), `?window=<day>`. The status region
// says how many rows show, of which window, from where, and when a refresh is running.

import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { useWindowVirtualizer } from "@tanstack/react-virtual"
import { useCallback, useState, type ComponentProps, type ReactNode } from "react"
import { Link, useSearchParams } from "react-router"

import { useData } from "../../../data/data-context"
import { useIndex, useWindow } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import { formatCount, formatInstant, formatMs, NOT_AVAILABLE } from "../../../lib/format"
import { DataRegion } from "../../../components/dashboard/data-region"
import { EmptyState } from "../../../components/dashboard/empty-state"
import { LanguageMark } from "../../../components/dashboard/language-mark"
import { ReasonChip } from "../../../components/dashboard/reason-chip"
import { StatusBadge } from "../../../components/dashboard/status-badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table"
import {
  DEFAULT_FILTERS,
  facetOptions,
  filterRows,
  type IndexRow,
  isFiltered,
  parseFilters,
  type StreamFilters,
  toSearch,
} from "../model/stream"

const ALL = "__all"
const CURRENT = "__current"
const SHOWN_REASONS = 3

type FacetKey = "outcome" | "language" | "route" | "reason" | "service"
const FACETS: { key: FacetKey; label: string; all: string }[] = [
  { key: "outcome", label: "Outcome", all: "All outcomes" },
  { key: "language", label: "Language", all: "All languages" },
  { key: "route", label: "Route", all: "All routes" },
  { key: "reason", label: "Reason", all: "All reasons" },
  { key: "service", label: "Service", all: "All services" },
]

/** The window select: the current window, then each closed day the current index lists. */
function WindowField({
  current,
  day,
  onWindow,
}: {
  readonly current: EventsIndexV1 | undefined
  readonly day: string | undefined
  readonly onWindow: (day: string | undefined) => void
}) {
  const windows = current?.windows ?? (day === undefined ? [] : [{ day, events: undefined }])
  return (
    <div data-slot="field">
      <label id="filter-window" data-label="">
        Window
      </label>
      <Select
        value={day ?? CURRENT}
        onValueChange={(value) => onWindow(value === CURRENT ? undefined : value)}
      >
        <SelectTrigger aria-labelledby="filter-window">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CURRENT}>
            Current window{current ? ` · ${formatCount(current.events.length)}` : ""}
          </SelectItem>
          {windows.map((window) => (
            <SelectItem key={window.day} value={window.day}>
              {window.day}
              {window.events === undefined ? "" : ` · ${formatCount(window.events)}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function FilterBar({
  index,
  filters,
  onChange,
  canClear,
  window,
}: {
  readonly index: EventsIndexV1
  readonly filters: StreamFilters
  readonly onChange: (filters: StreamFilters) => void
  /** Whether the bar offers Clear filters; the no-results panel offers it instead. */
  readonly canClear: boolean
  readonly window: ReactNode
}) {
  return (
    <div data-slot="filter-bar" role="group" aria-label="Filters">
      {window}
      {FACETS.map(({ key, label, all }) => {
        const options = facetOptions(index.facets[key])
        const id = `filter-${key}`
        return (
          <div key={key} data-slot="field">
            <label id={id} data-label="">
              {label}
            </label>
            <Select
              value={filters[key] ?? ALL}
              onValueChange={(value) =>
                onChange({ ...filters, [key]: value === ALL ? undefined : value })
              }
            >
              <SelectTrigger aria-labelledby={id}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{all}</SelectItem>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.value} · {formatCount(option.count)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      })}
      {canClear && isFiltered(filters) ? (
        <button type="button" data-slot="ghost-button" onClick={() => onChange(DEFAULT_FILTERS)}>
          Clear filters
        </button>
      ) : null}
    </div>
  )
}

function Tokens({ row }: { readonly row: IndexRow }) {
  if (row.input_tokens === undefined || row.budget_input === undefined) return <>{NOT_AVAILABLE}</>
  return (
    <>
      {formatCount(row.input_tokens)}{" "}
      <span data-slot="cell-note">of {formatCount(row.budget_input)}</span>
    </>
  )
}

function Reasons({ row }: { readonly row: IndexRow }) {
  const shown = row.reason_codes.slice(0, SHOWN_REASONS)
  const more = row.reason_codes.length - shown.length
  return (
    <span data-slot="chip-row">
      {shown.map((code) => (
        // Plain in the stream: a row can hold many codes, and a link each would be a tab stop each.
        <ReasonChip key={code} code={code} link={false} />
      ))}
      {more > 0 ? <span data-slot="cell-note">+{more} more</span> : null}
    </span>
  )
}

/** One event's row; the virtualised body passes its index for assistive technology. */
function StreamRow({ row, ...rest }: { readonly row: IndexRow } & ComponentProps<typeof TableRow>) {
  return (
    <TableRow {...rest}>
      <TableCell data-mono="">{formatInstant(row.recorded_at)}</TableCell>
      <TableCell data-mono="">
        <Link to={`/traces/${row.event_id}`}>{row.event_id}</Link>
      </TableCell>
      <TableCell>
        <StatusBadge
          outcome={row.outcome}
          {...(row.input_tokens === undefined ? {} : { inputTokens: row.input_tokens })}
          {...(row.refused_reason === undefined ? {} : { refusedReason: row.refused_reason })}
          {...(row.problem_count === undefined ? {} : { problemCount: row.problem_count })}
        />
      </TableCell>
      <TableCell data-mono="">
        {row.route ? (
          <>
            {row.route} <span data-slot="cell-note">· {row.route_policy_version}</span>
          </>
        ) : (
          NOT_AVAILABLE
        )}
      </TableCell>
      <TableCell data-mono="">
        {row.profile ? `${row.profile.id} v${row.profile.version}` : NOT_AVAILABLE}
      </TableCell>
      <TableCell>
        <LanguageMark language={row.language} />
      </TableCell>
      <TableCell data-numeric="">
        <Tokens row={row} />
      </TableCell>
      <TableCell>
        <Reasons row={row} />
      </TableCell>
      <TableCell data-mono="">
        {row.session ? (
          <>
            {row.session.id} <span data-slot="cell-note">· turn {row.session.turn_index}</span>
          </>
        ) : (
          <span data-slot="cell-note">none</span>
        )}
      </TableCell>
      <TableCell data-numeric="">{formatMs(row.total_ms)}</TableCell>
    </TableRow>
  )
}

const HEAD = (
  <TableHeader>
    <TableRow>
      <TableHead>Recorded</TableHead>
      <TableHead>Event</TableHead>
      <TableHead>Outcome</TableHead>
      <TableHead>Route</TableHead>
      <TableHead>Profile</TableHead>
      <TableHead>Language</TableHead>
      <TableHead data-numeric="">Input tokens</TableHead>
      <TableHead>Reasons</TableHead>
      <TableHead>Session</TableHead>
      <TableHead data-numeric="">Wrapper time</TableHead>
    </TableRow>
  </TableHeader>
)

/** Above this many rows the stream draws only those near the view (dashboard-plan.md 9). */
const VIRTUAL_ABOVE = 500
/** Every row of a virtualised stream is this tall (STYLE.md 6: a virtualised table's rows are one height). */
const ROW_HEIGHT = 44

/**
 * The rows near the view, the window being the scroller, with a spacer above and below for the rest,
 * and each row's index and the table's count for assistive technology.
 */
function VirtualTable({ rows }: { readonly rows: readonly IndexRow[] }) {
  // Where the body starts in the document, measured when it is attached, so the virtualiser can tell
  // the window's scroll from the rows' own offset.
  const [margin, setMargin] = useState(0)
  const body = useCallback((element: HTMLTableSectionElement | null) => {
    if (element !== null) setMargin(element.getBoundingClientRect().top + window.scrollY)
  }, [])
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin: margin,
  })
  const items = virtualizer.getVirtualItems()
  const before = items.length > 0 ? items[0]!.start - margin : 0
  const after = items.length > 0 ? virtualizer.getTotalSize() - (items.at(-1)!.end - margin) : 0
  return (
    <Table aria-label="Trace stream" aria-rowcount={rows.length + 1} data-virtual="">
      {HEAD}
      <TableBody ref={body}>
        {before > 0 ? (
          <tr aria-hidden="true" data-slot="virtual-spacer" style={{ height: before }}>
            <td colSpan={10} />
          </tr>
        ) : null}
        {items.map((item) => (
          <StreamRow
            key={rows[item.index]!.event_id}
            row={rows[item.index]!}
            aria-rowindex={item.index + 2}
          />
        ))}
        {after > 0 ? (
          <tr aria-hidden="true" data-slot="virtual-spacer" style={{ height: after }}>
            <td colSpan={10} />
          </tr>
        ) : null}
      </TableBody>
    </Table>
  )
}

function StreamTable({ rows }: { readonly rows: readonly IndexRow[] }) {
  if (rows.length > VIRTUAL_ABOVE) return <VirtualTable rows={rows} />
  return (
    <Table aria-label="Trace stream">
      {HEAD}
      <TableBody>
        {rows.map((row) => (
          <StreamRow key={row.event_id} row={row} />
        ))}
      </TableBody>
    </Table>
  )
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function TraceStream() {
  const [search, setSearch] = useSearchParams()
  const filters = parseFilters(search)
  const asked = search.get("window") ?? undefined
  const day = asked !== undefined && DAY.test(asked) ? asked : undefined
  const currentQuery = useIndex()
  const dayQuery = useWindow(day)
  const query = day === undefined ? currentQuery : dayQuery
  const { source } = useData()
  const region = regionOf(query, {
    what: day === undefined ? "The index" : `The closed day ${day}`,
    isEmpty: (index) => index.events.length === 0,
  })
  const current = currentQuery.data?.result.ok ? currentQuery.data.result.document : undefined
  // A filter keeps the window, and a window keeps the filters.
  const withWindow = (params: URLSearchParams, next: string | undefined) => {
    if (next !== undefined) params.set("window", next)
    return params
  }
  const setFilters = (next: StreamFilters) => setSearch(withWindow(toSearch(next), day))
  const setWindow = (next: string | undefined) => setSearch(withWindow(toSearch(filters), next))
  const indexPath = day === undefined ? "events/index.json" : `events/index/${day}.json`

  return (
    <DataRegion
      region={region}
      label="the trace stream"
      empty={{
        title: "No events yet",
        body: (
          <p>
            No assembly has been recorded in this window. Events appear here as services send them.
          </p>
        ),
      }}
    >
      {(index) => {
        const rows = filterRows(index.events, filters)
        const updating = region.status === "ok" && region.updating
        return (
          <>
            <FilterBar
              index={index}
              filters={filters}
              onChange={setFilters}
              canClear={rows.length > 0}
              window={<WindowField current={current} day={day} onWindow={setWindow} />}
            />
            <div
              role="status"
              aria-label="Stream status"
              aria-live="polite"
              data-slot="status-region"
            >
              <span>
                {formatCount(rows.length)} of {formatCount(index.events.length)} events
              </span>
              <span>· {day === undefined ? "current window" : `closed day ${day}`}</span>
              <span>· source {source.url("").replace(/\/$/, "")}</span>
              <span>· generated {formatInstant(index.generated_at)}</span>
              {updating ? <span>· updating</span> : null}
            </div>
            <div data-slot="stream-actions">
              <button type="button" data-slot="ghost-button" onClick={() => void query.refetch()}>
                Refresh
              </button>
              <a
                data-slot="ghost-button"
                href={source.url(indexPath)}
                download={day === undefined ? "index.json" : `index-${day}.json`}
              >
                Download index
              </a>
            </div>
            <div data-slot="content">
              {rows.length === 0 ? (
                <EmptyState
                  title="No events match these filters"
                  action={
                    <button
                      type="button"
                      data-slot="ghost-button"
                      onClick={() => setFilters(DEFAULT_FILTERS)}
                    >
                      Clear filters
                    </button>
                  }
                >
                  <p>Clear the filters, or choose others, to see events again.</p>
                </EmptyState>
              ) : (
                <div data-slot="panel">
                  <StreamTable rows={rows} />
                </div>
              )}
            </div>
          </>
        )
      }}
    </DataRegion>
  )
}
