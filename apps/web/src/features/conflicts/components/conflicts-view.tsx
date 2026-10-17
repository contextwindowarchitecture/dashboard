// The conflicts (dashboard-plan.md DP-10): the current window's events that resolved one item against
// another (a conflict, a supersession, a duplicate), counted by code from the index; and, for the
// event chosen (`?event=`), its forest drawn from the event document, with the same links and its
// conflict groups as tables. Nothing is recomputed that the trace does not say.

import { Link, useSearchParams } from "react-router"

import { ConflictForestChart } from "../../../components/charts/conflict-forest"
import { DataRegion } from "../../../components/dashboard/data-region"
import { ReasonChip } from "../../../components/dashboard/reason-chip"
import { useData } from "../../../data/data-context"
import { useEvent, useIndex } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import { formatCount, formatInstant } from "../../../lib/format"
import {
  conflictEvents,
  conflictForest,
  RESOLVING_CODES,
  type ConflictForest,
} from "../model/conflicts"

const EVENT_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/

function summaryOf(forest: ConflictForest): string {
  const items = forest.nodes.filter((n) => n.kind === "item").length
  const byCode = new Map<string, number>()
  for (const edge of forest.edges) byCode.set(edge.code, (byCode.get(edge.code) ?? 0) + 1)
  const codes = [...byCode].map(([code, n]) => `${formatCount(n)} ${code}`).join(", ")
  const open = forest.groups.filter((g) => g.winner === undefined).length
  return (
    `${formatCount(items)} items and ${formatCount(forest.edges.length)} links` +
    (codes ? `: ${codes}` : "") +
    `; ${formatCount(open)} ${open === 1 ? "group" : "groups"} with no winner.`
  )
}

function EventForest({ eventId }: { readonly eventId: string }) {
  const region = regionOf(useEvent(eventId), { what: `Event ${eventId}` })
  return (
    <DataRegion region={region} label={`event ${eventId}`}>
      {(event) => {
        const forest = conflictForest(event)
        const label = (key: string) => key.slice(key.indexOf(":") + 1)
        return (
          <section aria-label={`Event ${eventId}`} data-slot="stack">
            <p>
              <Link to={`/traces/${eventId}?tab=conflicts`}>Open in the inspector →</Link>
            </p>
            {forest.cycle ? (
              <section aria-label="Links that loop" data-slot="note">
                <p>
                  This trace's links loop, which no conformant trace does, so no forest is drawn;
                  the links are in the table below as the trace wrote them.
                </p>
              </section>
            ) : (
              <ConflictForestChart
                forest={forest}
                title={`Conflict forest · event ${eventId} · items and the links between them`}
                summary={summaryOf(forest)}
              />
            )}
            <div role="region" aria-label="Links table" tabIndex={0} data-slot="scroll-region">
              <table aria-label="Links" data-slot="chart-table" data-wide="">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Code</th>
                    <th scope="col">Under</th>
                    <th scope="col">Producer</th>
                    <th scope="col">Item status</th>
                  </tr>
                </thead>
                <tbody>
                  {forest.edges.map((edge) => {
                    const node = forest.nodes.find((n) => n.key === edge.child)
                    return (
                      <tr key={edge.child}>
                        <th scope="row" data-mono="">
                          {label(edge.child)}
                        </th>
                        <td>
                          {RESOLVING_CODES.includes(edge.code) ? (
                            <ReasonChip code={edge.code} link={false} />
                          ) : (
                            <span data-mono="">{edge.code}</span>
                          )}
                        </td>
                        <td data-mono="">
                          {edge.parent.startsWith("group:") ? "group " : ""}
                          {label(edge.parent)}
                        </td>
                        <td data-mono="">
                          {node?.producer ? `${node.producer.id} · ${node.producer.kind}` : "—"}
                        </td>
                        <td>{node?.status ?? "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {forest.groups.length > 0 ? (
              <div
                role="region"
                aria-label="Conflict groups table"
                tabIndex={0}
                data-slot="scroll-region"
              >
                <table aria-label="Conflict groups" data-slot="chart-table" data-wide="">
                  <thead>
                    <tr>
                      <th scope="col">Group</th>
                      <th scope="col">Kind</th>
                      <th scope="col">Resolution</th>
                      <th scope="col">Decided by</th>
                      <th scope="col">Winner</th>
                      <th scope="col">Members</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forest.groups.map((group) => (
                      <tr key={group.group_id}>
                        <th scope="row" data-mono="">
                          {group.group_id}
                        </th>
                        <td>{group.kind}</td>
                        <td>{group.resolution}</td>
                        <td>{group.decided_by}</td>
                        <td data-mono="">
                          {group.winner ?? <span data-slot="cell-note">no winner</span>}
                        </td>
                        <td data-mono="">{group.members.map((m) => m.id).join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        )
      }}
    </DataRegion>
  )
}

export function ConflictsView() {
  const [search] = useSearchParams()
  const chosen = search.get("event") ?? undefined
  const query = useIndex()
  const { source } = useData()
  const region = regionOf(query, {
    what: "The index",
    isEmpty: (index) => conflictEvents(index).rows.length === 0,
  })
  return (
    <>
      <DataRegion
        region={region}
        label="the conflicts"
        empty={{
          title: "No item was resolved against another in this window",
          body: (
            <p>
              An event appears here once its trace records a conflict, a supersession or a
              duplicate.
            </p>
          ),
        }}
      >
        {(index) => {
          const { rows, counts } = conflictEvents(index)
          return (
            <div data-slot="content">
              <div role="status" aria-label="Conflicts status" data-slot="status-region">
                <span>
                  {formatCount(rows.length)} of {formatCount(index.events.length)} events
                </span>
                <span>
                  · current window, {formatInstant(index.window.from)} to{" "}
                  {formatInstant(index.window.to)}
                </span>
                <span>· source {source.url("").replace(/\/$/, "")}</span>
              </div>
              <ul aria-label="Codes" data-slot="chip-row">
                {counts.map(({ code, events }) => (
                  <li key={code}>
                    <Link to={`/traces?reason=${code}`}>
                      <ReasonChip code={code} link={false} />{" "}
                      <span data-slot="cell-note">{formatCount(events)} events</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div role="region" aria-label="Events table" tabIndex={0} data-slot="scroll-region">
                <table aria-label="Events" data-slot="chart-table" data-wide="">
                  <thead>
                    <tr>
                      <th scope="col">Recorded</th>
                      <th scope="col">Event</th>
                      <th scope="col">Route</th>
                      <th scope="col">Codes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.event_id}
                        aria-current={row.event_id === chosen ? "true" : undefined}
                      >
                        <td data-mono="">{formatInstant(row.recorded_at)}</td>
                        <th scope="row" data-mono="">
                          <Link to={`?event=${row.event_id}`}>{row.event_id}</Link>
                        </th>
                        <td data-mono="">{row.route ?? "—"}</td>
                        <td>
                          <span data-slot="chip-row">
                            {[
                              ...row.reason_codes,
                              ...(row.refused_reason ? [row.refused_reason] : []),
                            ]
                              .filter((code) => RESOLVING_CODES.includes(code))
                              .map((code) => (
                                <ReasonChip key={code} code={code} link={false} />
                              ))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        }}
      </DataRegion>
      {chosen !== undefined && EVENT_ID.test(chosen) ? (
        <div data-slot="content">
          <EventForest eventId={chosen} />
        </div>
      ) : null}
    </>
  )
}
