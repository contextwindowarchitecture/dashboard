// The sources (dashboard-plan.md DP-10): what each producer sent the assemblers in the current window
// and what became of it, from the sources report a store derives from the events' snapshots and
// traces. Every count names its window and its source; tokens kept out are not available, since the
// contract records no cost for an excluded item, and the page says so rather than estimate them.

import { Link } from "react-router"

import { DataRegion } from "../../../components/dashboard/data-region"
import { ReasonChip } from "../../../components/dashboard/reason-chip"
import { Badge } from "../../../components/ui/badge"
import { useData } from "../../../data/data-context"
import { useSourcesReport } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import { formatCount, formatInstant, NOT_AVAILABLE } from "../../../lib/format"

export function SourcesView() {
  const region = regionOf(useSourcesReport(), {
    what: "The sources report",
    isEmpty: (report) => report.producers.length === 0,
  })
  const { source } = useData()
  return (
    <DataRegion
      region={region}
      label="the sources report"
      empty={{
        title: "No producer sent anything in this window",
        body: <p>A producer appears here once an assembly in the window holds a batch from it.</p>,
      }}
    >
      {(report) => (
        <div data-slot="content">
          <div role="status" aria-label="Sources status" data-slot="status-region">
            <span>{formatCount(report.producers.length)} producers</span>
            <span>
              · {formatCount(report.window.events)} events from {formatInstant(report.window.from)}{" "}
              to {formatInstant(report.window.to)}, the current window
            </span>
            <span>· source {source.url("").replace(/\/$/, "")}</span>
            <span>· generated {formatInstant(report.generated_at)}</span>
          </div>
          <section aria-label="Tokens kept out" data-slot="note">
            <p>
              Tokens kept out are not available: the contract records no cost for an excluded item,
              so no trace says what one would have taken. Tokens admitted are what the traces count
              for the included occurrences.
            </p>
          </section>
          <div role="region" aria-label="Producers table" tabIndex={0} data-slot="scroll-region">
            <table aria-label="Producers" data-slot="chart-table" data-wide="">
              <thead>
                <tr>
                  <th scope="col">Producer</th>
                  <th scope="col">Kind</th>
                  <th scope="col" data-numeric="">
                    Events
                  </th>
                  <th scope="col" data-numeric="">
                    Submitted
                  </th>
                  <th scope="col" data-numeric="">
                    Admitted
                  </th>
                  <th scope="col" data-numeric="">
                    Compressed
                  </th>
                  <th scope="col" data-numeric="">
                    Tokens admitted
                  </th>
                  <th scope="col" data-numeric="">
                    Tokens kept out
                  </th>
                  <th scope="col">Excluded, by reason and stage</th>
                  <th scope="col" data-numeric="">
                    Rejected events
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.producers.map((producer) => (
                  <tr key={`${producer.id} ${producer.kind}`}>
                    <th scope="row" data-mono="">
                      {producer.id}
                    </th>
                    <td>
                      <Badge variant="outline" data-tone="quiet">
                        {producer.kind}
                      </Badge>
                    </td>
                    <td data-numeric="">{formatCount(producer.events)}</td>
                    <td data-numeric="">{formatCount(producer.submitted)}</td>
                    <td data-numeric="">{formatCount(producer.admitted)}</td>
                    <td data-numeric="">{formatCount(producer.compressed)}</td>
                    <td data-numeric="">{formatCount(producer.included_tokens)}</td>
                    <td data-numeric="">
                      <span data-slot="cell-note">{NOT_AVAILABLE}</span>
                    </td>
                    <td>
                      {producer.excluded.length === 0 ? (
                        <span data-slot="cell-note">none</span>
                      ) : (
                        <ul data-slot="chip-row" aria-label={`${producer.id}'s exclusions`}>
                          {producer.excluded.map((entry) => (
                            <li key={`${entry.reason} ${entry.stage}`}>
                              <Link to={`/traces?reason=${encodeURIComponent(entry.reason)}`}>
                                <ReasonChip code={entry.reason} link={false} />{" "}
                                <span data-slot="cell-note">
                                  {entry.stage} · {formatCount(entry.items)}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td data-numeric="">{formatCount(producer.rejected_events)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </DataRegion>
  )
}
