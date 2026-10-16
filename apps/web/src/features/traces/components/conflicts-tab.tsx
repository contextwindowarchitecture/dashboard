// The Conflicts tab (dashboard-plan.md 7.3): one card per declared group, with what decided it and
// the route's rule that applied (R-11).

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"

import { Badge } from "../../../components/ui/badge"
import { conflictCards } from "../model/inspector"

export function ConflictsTab({ event }: { readonly event: AssemblyEventV1 }) {
  const cards = conflictCards(event)
  if (cards.length === 0) return <p data-slot="cell-note">No conflict group was declared.</p>
  return (
    <div data-slot="card-grid">
      {cards.map((card) => (
        <article key={card.group_id} aria-label={card.group_id} data-slot="card">
          <Badge variant="outline" data-tone="conflict" data-identifier="">
            {card.group_id}
          </Badge>
          <p data-slot="card-line">
            {card.kind} · {card.resolution} · decided by {card.decided_by}
          </p>
          {card.winner ? <p data-slot="card-line">winner {card.winner}</p> : null}
          <ul data-slot="members">
            {card.members.map((member) => (
              <li key={member.id}>
                <code>{member.id}</code>
                {member.producer ? (
                  <span data-slot="cell-note"> · {member.producer.id}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {card.fact ? (
            <p data-slot="card-line">
              facts.{card.fact}.precedence{" "}
              {card.precedence ? card.precedence.join(" → ") : "not set"}
            </p>
          ) : null}
          {card.onUnresolved ? (
            <p data-slot="card-line">on_unresolved_instruction {card.onUnresolved}</p>
          ) : null}
        </article>
      ))}
    </div>
  )
}
