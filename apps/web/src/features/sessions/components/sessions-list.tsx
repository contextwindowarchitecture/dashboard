// The sessions list (dashboard-plan.md 7.4): every session the index holds, newest first, with its
// outcomes, the turn of its first inflection and its part reuse, each linked to its page.

import { Link } from "react-router"

import { DataRegion } from "../../../components/dashboard/data-region"
import { OutcomeStrip } from "../../../components/dashboard/outcome-strip"
import { useIndex, useSession } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import { formatCount, formatInstant, NOT_AVAILABLE } from "../../../lib/format"
import { firstInflection, sessionModel } from "../model/session"
import { sessionRows, type SessionRow } from "../model/sessions-list"

function PartReuse({ id }: { readonly id: string }) {
  const region = regionOf(useSession(id), { what: `Session ${id}` })
  if (region.status === "loading") return <span data-slot="cell-note">loading</span>
  // A session the index names may have no document (none of its turns was admitted).
  if (region.status !== "ok") return <>{NOT_AVAILABLE}</>
  const reuse = sessionModel(region.data).reuse
  if (reuse === undefined) return <>{NOT_AVAILABLE}</>
  return (
    <>
      {formatCount(reuse.reusedParts)} of {formatCount(reuse.parts)} parts{" "}
      <span data-slot="cell-note">· {formatCount(reuse.comparedTurns)} turns compared</span>
    </>
  )
}

function Row({ row }: { readonly row: SessionRow }) {
  const first = firstInflection(row.firsts)
  return (
    <tr>
      <td data-mono="">
        <Link to={`/sessions/${encodeURIComponent(row.id)}`}>{row.id}</Link>
      </td>
      <td data-mono="">{row.route ?? NOT_AVAILABLE}</td>
      <td data-mono="">{row.service}</td>
      <td data-numeric="">{formatCount(row.turns)}</td>
      <td>
        <OutcomeStrip outcomes={row.outcomes} counts={row.counts} />
      </td>
      <td data-mono="">
        {first ? `turn ${first.turn} · ${first.words}` : <span data-slot="cell-note">none</span>}
      </td>
      <td data-mono="">
        <PartReuse id={row.id} />
      </td>
      <td data-mono="">{formatInstant(row.lastRecorded)}</td>
    </tr>
  )
}

export function SessionsList() {
  const region = regionOf(useIndex(), {
    what: "The index",
    isEmpty: (index) => index.events.every((row) => row.session === undefined),
  })
  return (
    <DataRegion
      region={region}
      label="the sessions"
      empty={{
        title: "No sessions yet",
        body: (
          <p>
            No event in this window names a session. A wrapper names one when the application passes
            a session id with a call.
          </p>
        ),
      }}
    >
      {(index) => (
        <div role="region" aria-label="Sessions" tabIndex={0} data-slot="scroll-region">
          <table aria-label="Sessions" data-slot="chart-table" data-wide="">
            <thead>
              <tr>
                <th scope="col">Session</th>
                <th scope="col">Route</th>
                <th scope="col">Service</th>
                <th scope="col" data-numeric="">
                  Turns
                </th>
                <th scope="col">Outcomes</th>
                <th scope="col">First inflection</th>
                <th scope="col">Part reuse</th>
                <th scope="col">Last recorded</th>
              </tr>
            </thead>
            <tbody>
              {sessionRows(index.events).map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DataRegion>
  )
}
