// The telemetry page (dashboard-plan.md 7.9): how an event reaches the dashboard today, the span
// attributes and the redaction modes as docs/otel-semantic-conventions.md defines them (read from the
// doc, so the two never differ), the RFCs, and Phase 2's ingestion patterns, named without a figure.

import { Fragment } from "react"

import conventions from "../../../../../../docs/otel-semantic-conventions.md?raw"
import { DashboardPage } from "../../../components/dashboard/dashboard-page"
import { TELEMETRY } from "../../../content/telemetry"
import { LINKS } from "../../../lib/links"
import { markdownTable } from "../../../lib/markdown-table"
import { NOT_AVAILABLE } from "../../../lib/format"

/** A cell's text with its `code` spans as code. */
function Cell({ text }: { readonly text: string }) {
  return (
    <>
      {text
        .split(/(`[^`]*`)/)
        .map((part, i) =>
          part.startsWith("`") ? (
            <code key={i}>{part.slice(1, -1)}</code>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          ),
        )}
    </>
  )
}

function DocTable({ heading, label }: { readonly heading: string; readonly label: string }) {
  const table = markdownTable(conventions, heading)
  return (
    <div role="region" aria-label={`${label} table`} tabIndex={0} data-slot="scroll-region">
      <table aria-label={label} data-slot="chart-table" data-wide="">
        <thead>
          <tr>
            {table.head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} data-mono={j < 2 ? "" : undefined}>
                  <Cell text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const doc = (path: string) => `${LINKS.repository}/blob/main/${path}`

export function TelemetryView() {
  return (
    <DashboardPage
      kicker="Reference"
      title="Telemetry"
      lede="How an assembly becomes an event the dashboard reads, what the event carries, and what a route's redaction mode keeps of it."
    >
      <div data-slot="content">
        <section aria-label="How events arrive" data-slot="panel" data-padded="">
          <h2 data-slot="panel-header" data-label="">
            How events arrive
          </h2>
          {TELEMETRY.arrival.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <pre data-slot="raw-json" tabIndex={0} aria-label="Posting an event">
            {`POST /events
Content-Type: application/json
Authorization: Bearer <the deployment's INGEST_TOKEN>

{ "$schema": "cwa-dashboard/assembly-event/v1", "event_id": "…", … }

201 written · 400 not an event, with the problems · 401 no token · 409 an id the tree holds`}
          </pre>
        </section>
        <section aria-labelledby="telemetry-attributes">
          <h2 id="telemetry-attributes" data-slot="section-title">
            Span attributes
          </h2>
          <p data-slot="panel-note">
            Each <code>cwa.*</code> attribute is one field of the assembly event, so a span and an
            event say the same thing.
          </p>
          <DocTable heading="Attributes" label="Span attributes" />
        </section>
        <section aria-labelledby="telemetry-redaction">
          <h2 id="telemetry-redaction" data-slot="section-title">
            Redaction
          </h2>
          <p data-slot="panel-note">
            A route's mode is the wrapper's setting <code>routes.&lt;route&gt;.redaction_mode</code>
            , applied before an event leaves the service. The dashboard shows what the event holds
            and never changes a body. A route under <code>pii_scrubbed</code> or{" "}
            <code>digest_only</code> may also keep its bodies in the vault,{" "}
            <code>routes.&lt;route&gt;.vault</code>, for the operator to resolve.
          </p>
          <DocTable heading="Redaction" label="Redaction modes" />
        </section>
        <section aria-label="RFCs" data-slot="panel" data-padded="">
          <h2 data-slot="panel-header" data-label="">
            Proposals for the specification
          </h2>
          <ul data-slot="facts">
            <li>
              <a href={doc("docs/rfc-digested-replay.md")}>RFC-D1, digested replay</a>
            </li>
            <li>
              <a href={doc("docs/rfc-rendered-digests.md")}>RFC-D2, rendered occurrence digests</a>
            </li>
          </ul>
        </section>
        <section aria-label="Phase 2" data-slot="panel" data-padded="">
          <h2 data-slot="panel-header" data-label="">
            Phase 2
          </h2>
          <p>
            Not built yet. Their overhead on an assemble() call is {NOT_AVAILABLE} until a wrapper
            measures it.
          </p>
          <dl data-slot="key-values">
            {TELEMETRY.phase2.map((pattern) => (
              <div key={pattern.name}>
                <dt>{pattern.name}</dt>
                <dd>{pattern.use}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </DashboardPage>
  )
}
