// The Excluded tab (dashboard-plan.md 7.3): every excluded row, by pipeline stage in the order
// conformance/README.md fixes, each with its code, the contract's words for it, and the item kept
// in its place where there is one.

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import { Link } from "react-router"

import { ReasonChip } from "../../../components/dashboard/reason-chip"
import { SlotBadge } from "../../../components/dashboard/slot-badge"
import { reasonInfo } from "../../../lib/reasons"
import { excludedByStage, type ExcludedRow, type StageGroup } from "../model/inspector"

const STAGE_TITLES: Record<StageGroup["stage"], string> = {
  producer: "Reported by producers",
  admission: "Admission",
  conflict: "Conflicts",
  supersession: "Supersession",
  dedupe: "Deduplication",
  diversity: "Source diversity",
  fitting: "Fitting",
  unknown: "Codes outside the contract",
}

function Kept({ eventId, id }: { readonly eventId: string; readonly id: string }) {
  return <Link to={`/traces/${eventId}?tab=items#item-${encodeURIComponent(id)}`}>{id}</Link>
}

function Row({ row, eventId }: { readonly row: ExcludedRow; readonly eventId: string }) {
  const info = reasonInfo(row.reason)
  return (
    <li data-slot="excluded-row" data-producer={row.stage === "producer" ? "" : undefined}>
      <div data-slot="chip-row">
        <ReasonChip code={row.reason} />
        {row.stage === "producer" ? <span data-slot="cell-note">· producer</span> : null}
        {row.slot ? <SlotBadge slot={row.slot} /> : null}
      </div>
      <code data-slot="item-id" data-excluded="">
        {row.item_id}
      </code>
      <p data-slot="item-meta">
        {row.producer ? (
          <span data-slot="meta">
            <span data-slot="meta-label">producer</span> {row.producer.id} · {row.producer.kind}
          </span>
        ) : null}
        {row.tier ? (
          <span data-slot="meta">
            <span data-slot="meta-label">tier</span> {row.tier.tier}
          </span>
        ) : null}
        {row.duplicate_of ? (
          <span data-slot="meta">
            <span data-slot="meta-label">duplicate of</span>{" "}
            <Kept eventId={eventId} id={row.duplicate_of} />
          </span>
        ) : null}
        {row.superseded_by ? (
          <span data-slot="meta">
            <span data-slot="meta-label">superseded by</span>{" "}
            <Kept eventId={eventId} id={row.superseded_by} />
          </span>
        ) : null}
      </p>
      {info ? <p data-slot="reason-text">{info.text}</p> : null}
    </li>
  )
}

export function ExcludedTab({ event }: { readonly event: AssemblyEventV1 }) {
  const groups = excludedByStage(event)
  if (groups.length === 0) return <p data-slot="cell-note">Nothing was excluded.</p>
  return (
    <div data-slot="stage-groups">
      {groups.map((group) => (
        <section key={group.stage} aria-labelledby={`stage-${group.stage}`}>
          <h3 id={`stage-${group.stage}`} data-label="">
            {STAGE_TITLES[group.stage]}
          </h3>
          <ol data-slot="item-list">
            {group.rows.map((row, i) => (
              <Row key={`${row.item_id}-${i}`} row={row} eventId={event.event_id} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}
