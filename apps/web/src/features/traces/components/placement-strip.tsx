// The placement strip (STYLE.md 6, Charts): the profile's placements in order, each a chip in its
// plane's colour with its wrap and the tokens placed there, and the slots it leaves unplaced struck
// through.

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"

import { Badge } from "../../../components/ui/badge"
import { formatCount } from "../../../lib/format"
import { planeStyle } from "../../../lib/plane"
import { placementRows } from "../model/inspector"

export function PlacementStrip({ event }: { readonly event: AssemblyEventV1 }) {
  const { placed, unplaced } = placementRows(event)
  return (
    <section aria-labelledby="placement-title" data-slot="placement">
      <h2 id="placement-title" data-label="">
        Placement · {event.snapshot!.profile.id} v{event.snapshot!.profile.version}
      </h2>
      <ol aria-label="Placement" data-slot="chip-row">
        {placed.map((placement, i) => (
          <li key={`${placement.slot}-${i}`}>
            <Badge
              variant="outline"
              data-tone="plane"
              data-identifier=""
              style={planeStyle(placement.slot)}
            >
              {placement.slot}{" "}
              <span data-slot="chip-detail">
                · {placement.wrap} ·{" "}
                {formatCount(placement.occurrences.reduce((sum, o) => sum + o.tokens, 0))}
              </span>
            </Badge>
          </li>
        ))}
        {unplaced.map((slot) => (
          <li key={`unplaced-${slot}`}>
            <Badge variant="outline" data-tone="quiet" data-identifier="" data-excluded="">
              {slot} · not placed
            </Badge>
          </li>
        ))}
      </ol>
    </section>
  )
}
