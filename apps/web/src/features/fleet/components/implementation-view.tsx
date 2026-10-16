// One implementation's run (dashboard-plan.md 7.7): every case and rejection with its outcome, the
// rules it exercises and the report's detail, filterable by rule through the URL.

import { Link, useParams, useSearchParams } from "react-router"

import { DashboardPage } from "../../../components/dashboard/dashboard-page"
import { DataRegion } from "../../../components/dashboard/data-region"
import { useFleet } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import { formatCount } from "../../../lib/format"
import { caseRows } from "../model/fleet"

const RULE = /^R-\d{1,2}$/

export function ImplementationView() {
  const { language = "" } = useParams()
  const [search] = useSearchParams()
  const param = search.get("rule")
  const rule = param !== null && RULE.test(param) ? param : undefined
  const region = regionOf(useFleet(), { what: "The fleet report" })
  return (
    <DashboardPage kicker="Implementation" title={language}>
      <DataRegion region={region} label={`implementation ${language}`}>
        {(fleet) => {
          const implementation = fleet.implementations.find((i) => i.language === language)
          if (implementation === undefined)
            return (
              <div data-slot="missing-panel">
                <p>The fleet report holds no implementation {language}.</p>
                <p>
                  <Link to="/fleet">The fleet</Link>
                </p>
              </div>
            )
          const all = caseRows(implementation)
          const rows = caseRows(implementation, rule)
          return (
            <div data-slot="content">
              <div
                role="status"
                aria-label="Cases status"
                aria-live="polite"
                data-slot="status-region"
              >
                <span>
                  {rule
                    ? `${formatCount(rows.length)} of ${formatCount(all.length)} exercise ${rule}`
                    : `${formatCount(all.length)} cases and rejections`}
                </span>
                {rule ? (
                  <Link to="?" replace>
                    all rules
                  </Link>
                ) : null}
              </div>
              <div role="region" aria-label="Cases table" tabIndex={0} data-slot="scroll-region">
                <table aria-label="Cases" data-slot="chart-table" data-wide="">
                  <thead>
                    <tr>
                      <th scope="col">Case</th>
                      <th scope="col">Kind</th>
                      <th scope="col">Outcome</th>
                      <th scope="col">Rules</th>
                      <th scope="col">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.kind}-${row.id}`}>
                        <th scope="row" data-mono="">
                          {row.id}
                        </th>
                        <td data-mono="">{row.kind}</td>
                        <td data-mono="" data-drift={row.outcome === "failed" ? "" : undefined}>
                          {row.outcome}
                        </td>
                        <td>
                          <ul data-slot="chip-row">
                            {row.rules.map((r) => (
                              <li key={r}>
                                <Link
                                  to={`?rule=${r}`}
                                  replace
                                  aria-current={r === rule ? "true" : undefined}
                                >
                                  {r}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td>{row.detail ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        }}
      </DataRegion>
    </DashboardPage>
  )
}
