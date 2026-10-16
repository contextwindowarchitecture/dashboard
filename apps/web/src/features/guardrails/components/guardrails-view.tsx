// The guardrails (dashboard-plan.md 7.6): the seven failure modes as cards, each linked to a page
// with its codes counted one by one, each count a link to the stream on the same events, the events
// behind the count, and, for the one the index cannot count, its measure over the sessions.

import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { Link, useParams } from "react-router"

import { DashboardPage } from "../../../components/dashboard/dashboard-page"
import { DataRegion } from "../../../components/dashboard/data-region"
import { StatusBadge } from "../../../components/dashboard/status-badge"
import { useIndex, useSessions } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import { formatCount, formatInstant, NOT_AVAILABLE } from "../../../lib/format"
import { reasonInfo } from "../../../lib/reasons"
import { reuseOver } from "../../sessions/model/session"
import {
  codeCounts,
  GUARDRAILS,
  guardrailCounts,
  guardrailRows,
  type Guardrail,
} from "../model/guardrails"
import { GuardrailCard } from "./guardrail-card"

type Row = EventsIndexV1["events"][number]

export function GuardrailsList() {
  const region = regionOf(useIndex(), { what: "The index" })
  return (
    <DataRegion region={region} label="the guardrails">
      {(index) => {
        const counts = guardrailCounts(index.events)
        return (
          <ul aria-label="Guardrails" data-slot="card-grid">
            {GUARDRAILS.map((guardrail) => (
              <GuardrailCard
                key={guardrail.number}
                guardrail={guardrail}
                count={counts.get(guardrail.number)}
                title={
                  <Link to={`/guardrails/${guardrail.number}`}>
                    {guardrail.number} · {guardrail.name}
                  </Link>
                }
              />
            ))}
          </ul>
        )
      }}
    </DataRegion>
  )
}

function Codes({
  guardrail,
  rows,
}: {
  readonly guardrail: Guardrail
  readonly rows: readonly Row[]
}) {
  return (
    <div role="region" aria-label="Codes table" tabIndex={0} data-slot="scroll-region">
      <table aria-label="Codes" data-slot="chart-table" data-wide="">
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Rule</th>
            <th scope="col" data-numeric="">
              Events
            </th>
            <th scope="col">What the contract says</th>
          </tr>
        </thead>
        <tbody>
          {codeCounts(guardrail, rows).map(({ code, events }) => (
            <tr key={code}>
              <th scope="row" data-mono="">
                {code}
              </th>
              <td data-mono="">{reasonInfo(code)?.rule}</td>
              <td data-numeric="">
                <Link
                  to={`/traces?reason=${encodeURIComponent(code)}`}
                  aria-label={`${formatCount(events)} events in the stream`}
                >
                  {formatCount(events)}
                </Link>
              </td>
              <td>{reasonInfo(code)?.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Events({
  guardrail,
  rows,
}: {
  readonly guardrail: Guardrail
  readonly rows: readonly Row[]
}) {
  const matching = guardrailRows(guardrail, rows)
  if (matching.length === 0)
    return <p data-slot="cell-note">No event in this window records one of these codes.</p>
  return (
    <div role="region" aria-label="Events table" tabIndex={0} data-slot="scroll-region">
      <table aria-label="Events" data-slot="chart-table" data-wide="">
        <thead>
          <tr>
            <th scope="col">Recorded</th>
            <th scope="col">Event</th>
            <th scope="col">Outcome</th>
            <th scope="col">Codes</th>
            <th scope="col">Service</th>
          </tr>
        </thead>
        <tbody>
          {matching.map((row) => (
            <tr key={row.event_id}>
              <td data-mono="">{formatInstant(row.recorded_at)}</td>
              <td data-mono="">
                <Link to={`/traces/${row.event_id}`}>{row.event_id}</Link>
              </td>
              <td>
                <StatusBadge
                  outcome={row.outcome}
                  {...(row.refused_reason === undefined
                    ? {}
                    : { refusedReason: row.refused_reason })}
                />
              </td>
              <td data-mono="">
                {guardrail.codes
                  .filter((code) => row.reason_codes.includes(code) || row.refused_reason === code)
                  .join(", ")}
              </td>
              <td data-mono="">{row.service}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SessionMeasure({ rows }: { readonly rows: readonly Row[] }) {
  const ids = [...new Set(rows.flatMap((row) => (row.session ? [row.session.id] : [])))].sort()
  const queries = useSessions(ids)
  let body
  if (ids.length === 0) body = <>{NOT_AVAILABLE} · no session in this window</>
  else if (queries.some((q) => q.isPending)) body = <span data-slot="cell-note">loading</span>
  else {
    const reuse = reuseOver(
      queries.flatMap((q) => (q.data?.result.ok ? [q.data.result.document] : [])),
    )
    body = reuse ? (
      <>
        {formatCount(reuse.reusedParts)} of {formatCount(reuse.parts)} parts reused ·{" "}
        {formatCount(reuse.sessions)} sessions · {formatCount(reuse.comparedTurns)} turns compared
      </>
    ) : (
      NOT_AVAILABLE
    )
  }
  return (
    <section aria-label="Measure" data-slot="panel" data-padded="">
      <p data-slot="metric-value">{body}</p>
      <p data-slot="metric-note">
        The leading payload parts each assembled turn shares with the one before, summed over every
        session in this window that could be compared. It is the wrappers' measurement, not a
        provider's cache.
      </p>
    </section>
  )
}

export function GuardrailView() {
  const { number = "" } = useParams()
  const guardrail = GUARDRAILS.find((g) => g.number === number)
  const region = regionOf(useIndex(), { what: "The index" })
  return (
    <DashboardPage
      kicker="Guardrail"
      title={guardrail ? `${guardrail.number} · ${guardrail.name}` : number}
      {...(guardrail ? { lede: guardrail.story } : {})}
    >
      {guardrail === undefined ? (
        <div data-slot="missing-panel">
          <p>There is no guardrail {number}.</p>
          <p>
            <Link to="/guardrails">The seven guardrails</Link>
          </p>
        </div>
      ) : (
        <DataRegion region={region} label={`guardrail ${number}`}>
          {(index) => (
            <div data-slot="content">
              <ul aria-label="Guardrail" data-slot="card-grid">
                <GuardrailCard
                  guardrail={guardrail}
                  count={guardrailCounts(index.events).get(guardrail.number)}
                />
              </ul>
              {guardrail.codes.length > 0 ? (
                <>
                  <Codes guardrail={guardrail} rows={index.events} />
                  <Events guardrail={guardrail} rows={index.events} />
                </>
              ) : (
                <SessionMeasure rows={index.events} />
              )}
            </div>
          )}
        </DataRegion>
      )}
    </DashboardPage>
  )
}
