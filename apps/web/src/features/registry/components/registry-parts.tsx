// Pieces the registry pages share: a value as the policy or profile wrote it, or a dash where it
// wrote none (dashboard-plan.md 7.5: blanks are "—", never 0), and the drift note.

import type { ReactNode } from "react"
import { Link } from "react-router"

import { formatCount } from "../../../lib/format"
import type { Drift } from "../model/registry"

export const ABSENT = "—"

export function Value({ value }: { readonly value: unknown }): ReactNode {
  if (value === undefined || value === null) return ABSENT
  if (Array.isArray(value)) return value.length === 0 ? ABSENT : value.map(String).join(", ")
  if (typeof value === "object") return <code>{JSON.stringify(value)}</code>
  return String(value)
}

/** The events that ran a pinned identity with other content (R-20), in the accent's note. */
export function DriftNote({ drift }: { readonly drift: readonly Drift[] }) {
  if (drift.length === 0) return null
  const identities = [...new Set(drift.map((d) => d.identity))]
  return (
    <section aria-label="Drift" data-slot="note">
      <p>
        {formatCount(drift.length)} {drift.length === 1 ? "event" : "events"} ran{" "}
        {identities.join(", ")} with content other than the registry lock pins. A registry refuses
        such content: a change needs a new version (R-20).
      </p>
      {/* A table, so no link sits in running text on the note's tint (axe, link-in-text-block). */}
      <table aria-label="Drifted events" data-slot="chart-table">
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">Service</th>
            <th scope="col">Drifted</th>
          </tr>
        </thead>
        <tbody>
          {drift.map((d) => (
            <tr key={`${d.event_id}-${d.kind}`}>
              <td data-mono="">
                <Link to={`/traces/${d.event_id}`}>{d.event_id}</Link>
              </td>
              <td data-mono="">{d.service}</td>
              <td data-mono="">{d.kind === "route_policy" ? "route policy" : "profile"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
