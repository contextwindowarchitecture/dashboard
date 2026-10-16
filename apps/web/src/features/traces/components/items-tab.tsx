// The Items tab (dashboard-plan.md 7.3): every included occurrence in placement order, joined to its
// candidate. The metadata is shown in every redaction mode (R-DASH-1); the body in the form the mode
// left it, and a redacted body names the wrapper setting that would reveal it (R-DASH-2).

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import type { ReactNode } from "react"

import { SlotBadge } from "../../../components/dashboard/slot-badge"
import { planeStyle } from "../../../lib/plane"
import { Badge } from "../../../components/ui/badge"
import { formatCount, formatInstant, formatTokens } from "../../../lib/format"
import { type Body, type ItemRow, joinItems } from "../model/inspector"

const TIER_SOURCE = { item: "item", "slot-default": "slot default", route: "route" } as const

function Meta({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <span data-slot="meta">
      <span data-slot="meta-label">{label}</span> {children}
    </span>
  )
}

function Counts({ counts }: { readonly counts: Record<string, number> }) {
  const entries = Object.entries(counts)
  if (entries.length === 0) return <>not counted (the body was not text)</>
  return (
    <>
      {entries.map(([tokenizer, count]) => `${formatTokens(count)} under ${tokenizer}`).join(", ")}
    </>
  )
}

function RevealNote({ route }: { readonly route: string }) {
  return (
    <p data-slot="note">
      The wrapper redacted this body before the event left the service. Setting{" "}
      <code>{`routes.${route}.redaction_mode`}</code> to <code>full</code> in the wrapper's
      configuration records bodies as they were emitted.
    </p>
  )
}

function BodyView({
  body,
  tokens,
  route,
}: {
  readonly body: Body
  readonly tokens: number
  readonly route: string
}) {
  switch (body.form) {
    case "text":
      return (
        <details data-slot="item-body">
          <summary>body · {formatTokens(tokens)}</summary>
          <pre>{body.text}</pre>
        </details>
      )
    case "scrubbed":
      return (
        <details data-slot="item-body">
          <summary>body scrubbed at source · pii_scrubbed</summary>
          <pre>{body.text}</pre>
          <dl data-slot="key-values">
            <div>
              <dt>original sha256</dt>
              <dd>{body.content_sha256}</dd>
            </div>
            <div>
              <dt>original tokens</dt>
              <dd>
                <Counts counts={body.token_counts} />
              </dd>
            </div>
          </dl>
          <RevealNote route={route} />
        </details>
      )
    case "digest":
      return (
        <details data-slot="item-body">
          <summary>body redacted · digest_only</summary>
          <dl data-slot="key-values">
            <div>
              <dt>sha256</dt>
              <dd>{body.content_sha256}</dd>
            </div>
            <div>
              <dt>tokens</dt>
              <dd>
                <Counts counts={body.token_counts} />
              </dd>
            </div>
          </dl>
          <RevealNote route={route} />
        </details>
      )
    case "raw":
      return (
        <details data-slot="item-body">
          <summary>body · not text</summary>
          <pre>{JSON.stringify(body.value, null, 2)}</pre>
        </details>
      )
    case "absent":
      return <p data-slot="cell-note">no body</p>
  }
}

function Item({
  row,
  route,
  anchor,
}: {
  readonly row: ItemRow
  readonly route: string
  readonly anchor: boolean
}) {
  return (
    <li
      id={anchor ? `item-${row.item_id}` : undefined}
      data-slot="item-row"
      data-compressed={row.compressed ? "" : undefined}
      style={planeStyle(row.slot)}
    >
      <div data-slot="chip-row">
        <SlotBadge slot={row.slot} />
        <Badge variant="outline" data-tone="plane">
          included · {formatTokens(row.tokens)}
        </Badge>
        {row.compressed ? (
          <Badge variant="outline" data-tone="info">
            compressed {formatCount(row.compressed.from)} → {formatCount(row.compressed.to)}
          </Badge>
        ) : null}
      </div>
      <code data-slot="item-id">{row.item_id}</code>
      <p data-slot="item-meta">
        <Meta label="producer">
          {row.producer.id} · {row.producer.kind}
        </Meta>
        <Meta label="authority">{row.authority}</Meta>
        <Meta label="trust">{row.trust}</Meta>
        {row.tier ? (
          <Meta label="tier">
            {row.tier.tier} ({TIER_SOURCE[row.tier.source]})
          </Meta>
        ) : null}
        {row.lineage ? (
          <Meta label="lineage">
            {row.lineage.value}
            {row.lineage.defaulted ? " (default)" : ""}
          </Meta>
        ) : null}
        {row.injection_risk ? (
          <Meta label="injection_risk">
            {row.injection_risk.value}
            {row.injection_risk.defaulted ? " (default)" : ""}
          </Meta>
        ) : null}
        <Meta label="freshness">{formatInstant(row.freshness)}</Meta>
        {row.expires ? <Meta label="expires">{formatInstant(row.expires)}</Meta> : null}
        <Meta label="source">{row.source}</Meta>
        <Meta label="version">{row.source_version}</Meta>
        {row.relevance !== undefined ? <Meta label="relevance">{row.relevance}</Meta> : null}
        {row.scope ? (
          <Meta label="scope">
            {Object.entries(row.scope)
              .map(([key, value]) => `${key}=${String(value)}`)
              .join(" ")}
          </Meta>
        ) : null}
      </p>
      {row.compressed ? (
        <p data-slot="cell-note">
          {row.compressed.method}
          {row.compressed.variant_id ? ` · variant ${row.compressed.variant_id}` : ""}
        </p>
      ) : null}
      {row.eligibility ? <p data-slot="cell-note">{row.eligibility}</p> : null}
      <BodyView body={row.body} tokens={row.tokens} route={route} />
    </li>
  )
}

export function ItemsTab({ event }: { readonly event: AssemblyEventV1 }) {
  const rows = joinItems(event)
  const route = event.snapshot?.route_policy.route ?? ""
  if (rows.length === 0) {
    return (
      <p data-slot="cell-note">
        Nothing was included:{" "}
        {event.outcome === "refused" ? "the assembly refused." : "the trace includes no item."}
      </p>
    )
  }
  return (
    <ol data-slot="item-list" aria-label="Included items">
      {rows.map((row, i) => (
        // An item placed twice is linked to at its first occurrence.
        <Item
          key={row.index}
          row={row}
          route={route}
          anchor={rows.findIndex((r) => r.item_id === row.item_id) === i}
        />
      ))}
    </ol>
  )
}
