// The overview (dashboard-plan.md 7.1): the window's numbers, the seven guardrail monitors, and the
// latest refusals and rejections, all from the index.

import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { Link } from "react-router"

import { DataRegion } from "../../../components/dashboard/data-region"
import { MetricCell } from "../../../components/dashboard/metric-cell"
import { StatusBadge } from "../../../components/dashboard/status-badge"
import { useData } from "../../../data/data-context"
import { useIndex } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import { formatCount, formatInstant, formatPercent, NOT_AVAILABLE } from "../../../lib/format"
import { GuardrailCard } from "../../guardrails/components/guardrail-card"
import { GUARDRAILS, guardrailCounts } from "../../guardrails/model/guardrails"
import { kpis } from "../model/kpis"

const WINDOW = "this window"
const NO_EARLIER = "no earlier window to compare"
const LATEST = 10

function Metrics({ index }: { readonly index: EventsIndexV1 }) {
  const k = kpis(index.events)
  const fitted = k.assembled + k.refused
  return (
    <ul aria-label="Metrics" data-slot="metric-grid">
      <MetricCell
        label="Assemblies"
        value={formatCount(k.events)}
        note={`events · ${WINDOW} · ${NO_EARLIER}`}
      >
        <p data-slot="metric-note">
          {formatCount(k.assembled)} assembled · {formatCount(k.refused)} refused ·{" "}
          {formatCount(k.rejected)} rejected
        </p>
      </MetricCell>
      <MetricCell
        label="Refusal rate"
        value={formatPercent(k.refusalRate)}
        note={`of ${formatCount(fitted)} assembled or refused · ${WINDOW} · ${NO_EARLIER}`}
      >
        <p data-slot="metric-note">
          {k.refusalsByCode
            .map((entry) => `${entry.code} ${formatCount(entry.events)}`)
            .join(" · ") || "no refusal"}
        </p>
      </MetricCell>
      <MetricCell
        label="Rejections"
        value={formatCount(k.rejected)}
        note={`events rejected before assembly · ${WINDOW} · ${NO_EARLIER}`}
      />
      <MetricCell
        label="Shedding rate"
        value={formatPercent(k.sheddingRate)}
        note={`events with an over_budget omission, of ${formatCount(fitted)} · ${WINDOW}`}
      />
      <MetricCell
        label="Compression rate"
        value={formatPercent(k.compressionRate)}
        note={`events with a step-down to a summary, of ${formatCount(fitted)} · ${WINDOW}`}
      />
      <MetricCell
        label="Exclusions by code"
        value={k.exclusionsByCode.top[0] ? k.exclusionsByCode.top[0].code : NOT_AVAILABLE}
        note={`the code most events record · ${WINDOW}`}
      >
        <ol data-slot="metric-list">
          {k.exclusionsByCode.top.map((entry) => (
            <li key={entry.code}>
              <Link to={`/traces?reason=${encodeURIComponent(entry.code)}`}>{entry.code}</Link>{" "}
              {formatCount(entry.events)}
            </li>
          ))}
          {k.exclusionsByCode.otherCodes > 0 ? (
            <li>
              {formatCount(k.exclusionsByCode.otherCodes)} other codes ·{" "}
              {formatCount(k.exclusionsByCode.otherEvents)} events
            </li>
          ) : null}
        </ol>
      </MetricCell>
    </ul>
  )
}

function Guardrails({ index }: { readonly index: EventsIndexV1 }) {
  const counts = guardrailCounts(index.events)
  return (
    <section aria-labelledby="guardrails-title">
      <h2 id="guardrails-title" data-slot="section-title">
        Guardrails
      </h2>
      <ul aria-label="Guardrails" data-slot="card-grid">
        {GUARDRAILS.map((guardrail) => (
          <GuardrailCard
            key={guardrail.number}
            guardrail={guardrail}
            count={counts.get(guardrail.number)}
          />
        ))}
      </ul>
    </section>
  )
}

function Latest({ index }: { readonly index: EventsIndexV1 }) {
  const rows = index.events.filter((row) => row.outcome !== "assembled").slice(0, LATEST)
  if (rows.length === 0) return <p data-slot="cell-note">No refusal or rejection in this window.</p>
  return (
    <section aria-labelledby="latest-title" data-slot="panel">
      <h2 id="latest-title" data-slot="panel-header" data-label="">
        Latest refusals and rejections
      </h2>
      {/* A table wider than its panel scrolls inside a region named by the panel's title (STYLE.md 6). */}
      <div role="region" aria-labelledby="latest-title" tabIndex={0} data-slot="scroll-region">
        <table aria-label="Latest refusals and rejections" data-slot="chart-table" data-wide="">
          <thead>
            <tr>
              <th scope="col">Recorded</th>
              <th scope="col">Event</th>
              <th scope="col">Outcome</th>
              <th scope="col">Route</th>
              <th scope="col">Service</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.event_id}>
                <td>{formatInstant(row.recorded_at)}</td>
                <td>
                  <Link to={`/traces/${row.event_id}`}>{row.event_id}</Link>
                </td>
                <td>
                  <StatusBadge
                    outcome={row.outcome}
                    {...(row.refused_reason === undefined
                      ? {}
                      : { refusedReason: row.refused_reason })}
                    {...(row.problem_count === undefined
                      ? {}
                      : { problemCount: row.problem_count })}
                  />
                </td>
                <td>{row.route ?? NOT_AVAILABLE}</td>
                <td>{row.service}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function Overview() {
  const query = useIndex()
  const { source } = useData()
  const region = regionOf(query, {
    what: "The index",
    isEmpty: (index) => index.events.length === 0,
  })
  return (
    <DataRegion
      region={region}
      label="the overview"
      empty={{
        title: "No events yet",
        body: <p>No assembly has been recorded in this window, so there is nothing to sum.</p>,
      }}
    >
      {(index) => (
        <>
          <div
            role="status"
            aria-label="Overview status"
            aria-live="polite"
            data-slot="status-region"
          >
            <span>source {source.url("").replace(/\/$/, "")}</span>
            <span>
              · window {formatInstant(index.window.from)} to {formatInstant(index.window.to)}
            </span>
            {region.status === "ok" && region.updating ? <span>· updating</span> : null}
          </div>
          <div data-slot="content">
            <Metrics index={index} />
            <Guardrails index={index} />
            <Latest index={index} />
          </div>
        </>
      )}
    </DataRegion>
  )
}
