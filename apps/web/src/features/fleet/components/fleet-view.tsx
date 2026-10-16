// The fleet (dashboard-plan.md 7.7): every implementation's published conformance run against the
// contract it used, beside the one the dashboard's lock pins; the services, their contract and the
// latency their wrappers measured; and a drift note for any service on another contract.

import { Link } from "react-router"

import { LatencyChart } from "../../../components/charts/latency-chart"
import { DataRegion } from "../../../components/dashboard/data-region"
import { LanguageMark } from "../../../components/dashboard/language-mark"
import { useFleet } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import { formatCount, formatInstant, formatMs, NOT_AVAILABLE } from "../../../lib/format"
import { conformanceRows, REQUIRED, serviceRows, type ConformanceRow } from "../model/fleet"

const short = (commit: string) => commit.slice(0, 7)
const REQUIRED_IDS: readonly string[] = [...REQUIRED.tokenizers, ...REQUIRED.renderers]

function Provided({ ids }: { readonly ids: readonly string[] | undefined }) {
  if (ids === undefined) return <span data-slot="cell-note">not stated</span>
  return (
    <ul data-slot="chip-row">
      {ids.map((id) => (
        <li key={id} data-mono="" data-required={REQUIRED_IDS.includes(id) ? "" : undefined}>
          {id}
        </li>
      ))}
    </ul>
  )
}

function Outcomes({ counts }: { readonly counts: Record<string, number> | undefined }) {
  if (counts === undefined) return <span data-slot="cell-note">not run; none counts (R-17)</span>
  const { total, ...outcomes } = counts
  return (
    <>
      {Object.entries(outcomes)
        .filter(([, n]) => n > 0)
        .map(([outcome, n]) => `${formatCount(n)} ${outcome}`)
        .join(" · ")}{" "}
      <span data-slot="cell-note">of {formatCount(total)}</span>
    </>
  )
}

function Contract({ commit, lock }: { readonly commit: string; readonly lock: string }) {
  return commit === lock ? (
    <>{short(commit)} · the lock's</>
  ) : (
    <span data-drift="">
      {short(commit)} · not the lock's {short(lock)}
    </span>
  )
}

function Conformance({
  rows,
  lock,
}: {
  readonly rows: readonly ConformanceRow[]
  readonly lock: string
}) {
  return (
    <div role="region" aria-label="Conformance table" tabIndex={0} data-slot="scroll-region">
      <table aria-label="Conformance" data-slot="chart-table" data-wide="">
        <thead>
          <tr>
            <th scope="col">Implementation</th>
            <th scope="col">Version</th>
            <th scope="col">Source</th>
            <th scope="col">Contract</th>
            <th scope="col">Cases</th>
            <th scope="col">Rejections</th>
            <th scope="col">Tokenizers</th>
            <th scope="col">Renderers</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.language}>
              <th scope="row" data-mono="">
                <Link to={`/fleet/${row.language}`}>{row.language}</Link>
              </th>
              <td data-mono="">{row.version}</td>
              <td data-mono="">
                {row.source.repository} @ {short(row.source.commit)}
                {row.source.dirty ? " · dirty" : ""}
              </td>
              <td data-mono="">
                <Contract commit={row.contractCommit} lock={lock} />
              </td>
              <td data-mono="">
                <Outcomes counts={row.cases} />
              </td>
              <td data-mono="">
                <Outcomes counts={row.rejections} />
              </td>
              <td>
                <Provided ids={row.tokenizers} />
              </td>
              <td>
                <Provided ids={row.renderers} />
                {row.missingRequired && row.missingRequired.length > 0 ? (
                  <p data-drift="">lacks {row.missingRequired.join(", ")}</p>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function FleetView() {
  const region = regionOf(useFleet(), { what: "The fleet report" })
  return (
    <DataRegion region={region} label="the fleet report">
      {(fleet) => {
        const lock = fleet.contract.commit
        const services = serviceRows(fleet)
        const drifted = services.filter((s) => !s.sameContract)
        return (
          <div data-slot="content">
            <div role="status" aria-label="Fleet status" data-slot="status-region">
              <span>
                the dashboard's lock pins {fleet.contract.repository} @ {short(lock)}
              </span>
              <span>· report generated {formatInstant(fleet.generated_at)}</span>
            </div>
            {drifted.length > 0 ? (
              <section aria-label="Contract drift" data-slot="note">
                <p>
                  {formatCount(drifted.length)} of {formatCount(services.length)} services run an
                  assembler built against a contract other than the one the dashboard's lock pins (
                  {short(lock)}):{" "}
                  {drifted.map((s) => `${s.name} (${short(s.contract_commit)})`).join(", ")}.
                </p>
              </section>
            ) : null}
            <Conformance rows={conformanceRows(fleet)} lock={lock} />
            <div role="region" aria-label="Services table" tabIndex={0} data-slot="scroll-region">
              <table aria-label="Services" data-slot="chart-table" data-wide="">
                <thead>
                  <tr>
                    <th scope="col">Service</th>
                    <th scope="col">Language</th>
                    <th scope="col">Assembler</th>
                    <th scope="col">Contract</th>
                    <th scope="col">Routes</th>
                    <th scope="col">Latency (wrapper)</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((service) => (
                    <tr key={service.name}>
                      <th scope="row" data-mono="">
                        {service.name}
                      </th>
                      <td>
                        <LanguageMark language={service.language} />
                      </td>
                      <td data-mono="">{service.assembler_version}</td>
                      <td data-mono="">
                        <Contract commit={service.contract_commit} lock={lock} />
                      </td>
                      <td data-mono="">{service.routes.join(", ")}</td>
                      <td data-mono="">
                        {service.latency
                          ? `P50 ${formatMs(service.latency.p50)} · P95 ${formatMs(service.latency.p95)} · P99 ${formatMs(service.latency.p99)} · n ${formatCount(service.latency.samples)}`
                          : NOT_AVAILABLE}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div data-slot="panel" data-padded="">
              <LatencyChart rows={services.map((s) => ({ name: s.name, latency: s.latency }))} />
            </div>
          </div>
        )
      }}
    </DataRegion>
  )
}
