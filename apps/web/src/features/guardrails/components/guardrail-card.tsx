// One failure mode as a guardrail card (dashboard-plan.md 7.1, 7.6): its number, name and story, the
// count in the window or Not available, what the count is, its codes as stream filters, the
// requirements that prevent it, and what the count does not show.

import { REQUIREMENTS } from "@cwa-dashboard/contract/data"
import type { ReactNode } from "react"
import { Link } from "react-router"

import { Badge } from "../../../components/ui/badge"
import { formatCount, NOT_AVAILABLE } from "../../../lib/format"
import { reasonInfo } from "../../../lib/reasons"
import type { Guardrail } from "../model/guardrails"

export function GuardrailCard({
  guardrail,
  count,
  title,
}: {
  readonly guardrail: Guardrail
  readonly count: number | undefined
  /** The heading's content; the card's name by default, a link to its page where there is one. */
  readonly title?: ReactNode
}) {
  return (
    <li data-slot="card">
      <h3 data-slot="card-title">{title ?? `${guardrail.number} · ${guardrail.name}`}</h3>
      <p data-slot="card-story">{guardrail.story}</p>
      <p data-slot="metric-value">
        {count === undefined
          ? NOT_AVAILABLE
          : `${formatCount(count)} ${count === 1 ? "event" : "events"}`}
      </p>
      <p data-slot="metric-note">{guardrail.measure}</p>
      {guardrail.codes.length > 0 ? (
        <ul data-slot="chip-row" aria-label={`${guardrail.name}: codes`}>
          {guardrail.codes.map((code) => (
            <li key={code}>
              <Badge asChild variant="outline" data-tone="bad" data-identifier="">
                <Link to={`/traces?reason=${encodeURIComponent(code)}`}>
                  {code} · {reasonInfo(code)?.rule}
                </Link>
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p data-slot="metric-note">
          <Link to="/traces">Open the stream →</Link>
        </p>
      )}
      <ul data-slot="requirements" aria-label={`${guardrail.name}: requirements`}>
        {guardrail.requirements.map((id) => (
          <li key={id}>
            <code>{id}</code> {REQUIREMENTS.find((r) => r.id === id)?.summary}
          </li>
        ))}
      </ul>
      <p data-slot="card-caveat">{guardrail.caveat}</p>
    </li>
  )
}
