// The Items tab (dashboard-plan.md 7.3): every included occurrence in placement order.

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"

import { joinItems } from "../model/inspector"

export function ItemsTab({ event }: { readonly event: AssemblyEventV1 }) {
  const rows = joinItems(event)
  return (
    <ol data-slot="item-list" aria-label="Included items">
      {rows.map((row) => (
        <li key={`${row.index}`} data-slot="item-row">
          <code>{row.item_id}</code> <span data-slot="cell-note">{row.slot}</span>
        </li>
      ))}
    </ol>
  )
}
