// Compliance (dashboard-plan.md DP-11): a signed bundle for one event (`?event=`), what it proves and
// what it does not, how to check it offline, and the window's recent assembled events to choose from.
// The bundle is signed by the ingest service; the page only reads it and says what it holds.

import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { Badge } from "../../../components/ui/badge"
import { useData } from "../../../data/data-context"
import { useIndex } from "../../../data/queries"
import { formatCount, formatInstant } from "../../../lib/format"
import { bundleUrl, EVENT_ID, useBundle, type BundleAnswer } from "../api/bundle"

const RECENT = 10
const short = (commit: string) => commit.slice(0, 7)

function Chooser({ chosen }: { readonly chosen: string | undefined }) {
  const index = useIndex()
  const navigate = useNavigate()
  const [typed, setTyped] = useState(chosen ?? "")
  const document = index.data?.result.ok ? index.data.result.document : undefined
  const recent =
    document?.events.filter((row) => row.outcome === "assembled").slice(0, RECENT) ?? []
  return (
    <section aria-label="Choose an event" data-slot="stack">
      <form
        data-slot="field-row"
        onSubmit={(event) => {
          event.preventDefault()
          void navigate(`/compliance?event=${encodeURIComponent(typed.trim())}`)
        }}
      >
        <div data-slot="field">
          <label htmlFor="bundle-event" data-label="">
            Event id
          </label>
          <input
            id="bundle-event"
            data-slot="input"
            data-mono=""
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
        <button type="submit" data-slot="ghost-button">
          Bundle
        </button>
      </form>
      {recent.length > 0 ? (
        <>
          <p data-label="">Recent assembled events</p>
          <ul aria-label="Recent events" data-slot="chip-row">
            {recent.map((row) => (
              <li key={row.event_id} data-mono="">
                <Link to={`/compliance?event=${row.event_id}`}>{row.event_id}</Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

function Proof({
  answer,
  apiBase,
  eventId,
}: {
  readonly answer: BundleAnswer
  readonly apiBase: string
  readonly eventId: string
}) {
  if (answer.kind === "not-found") {
    return <p data-slot="missing-panel">Event {eventId} is not there.</p>
  }
  if (answer.kind === "not-configured") {
    return (
      <section aria-label="Bundle" data-slot="note">
        <p>The service cannot sign a bundle: {answer.problems.join(" ")}</p>
      </section>
    )
  }
  if (answer.kind === "invalid") {
    return (
      <section aria-label="Bundle" role="alert" data-slot="note">
        <p>
          <code>{answer.url}</code> is not a compliance bundle this dashboard reads.
        </p>
      </section>
    )
  }
  if (answer.kind === "failed") {
    return (
      <section aria-label="Bundle" role="alert" data-slot="note">
        <p>{answer.message}</p>
      </section>
    )
  }
  const { bundle, url } = answer
  const { contract, implementation, replay, signature } = bundle
  const cases = implementation.report?.cases ?? []
  const rejections = implementation.report?.rejections ?? []
  const passed = cases.filter((c) => c.outcome === "passed").length
  const rejected = rejections.filter((c) => c.outcome === "rejected").length
  return (
    <section aria-label="Bundle" data-slot="stack">
      <ul aria-label="What the bundle holds" data-slot="key-values">
        <li>
          <span data-label="">Signature</span>
          <span data-mono="">
            {signature.algorithm} · key {signature.key_id.slice(0, 16)}… · signed{" "}
            {formatInstant(bundle.generated_at)}
          </span>
        </li>
        <li>
          <span data-label="">Contract</span>
          <span>
            <span data-mono="">{short(contract.event.commit)}</span>, the lock pins{" "}
            <span data-mono="">{short(contract.dashboard.commit)}</span> ·{" "}
            <Badge variant="outline" data-tone={contract.same_lock ? "ok" : "warn"}>
              {contract.same_lock
                ? "the same lock"
                : contract.same_commit
                  ? "the same commit, another lock"
                  : "another contract"}
            </Badge>
          </span>
        </li>
        <li>
          <span data-label="">Conformance</span>
          <span>
            {implementation.report === null ? (
              <>The {implementation.language} implementation publishes no report.</>
            ) : (
              <>
                {implementation.language}: {formatCount(passed)} of {formatCount(cases.length)}{" "}
                cases passed, {formatCount(rejected)} of {formatCount(rejections.length)} rejection
                snapshots rejected, as its published report says
              </>
            )}
          </span>
        </li>
        <li>
          <span data-label="">Replay</span>
          <span>
            <Badge
              variant="outline"
              data-tone={
                replay.status === "match" ? "ok" : replay.status === "differ" ? "fill" : "quiet"
              }
            >
              {replay.status}
            </Badge>{" "}
            {replay.note}
          </span>
        </li>
      </ul>
      <section aria-label="Check it offline" data-slot="note">
        <p>
          The signature covers everything in the bundle but itself. Check it without the dashboard,
          with Node and the dashboard repository's script:
        </p>
        <pre data-slot="raw-json" tabIndex={0}>
          node deploy/verify-bundle.mjs bundle.json signing-key.pem
        </pre>
        <ul aria-label="Downloads" data-slot="chip-row">
          <li>
            <a data-slot="ghost-button" href={url} download={`bundle-${eventId}.json`}>
              Download the bundle
            </a>
          </li>
          <li>
            <a
              data-slot="ghost-button"
              href={`${apiBase}/signing-key.pem`}
              download="signing-key.pem"
            >
              Download the public key
            </a>
          </li>
        </ul>
      </section>
    </section>
  )
}

export function ComplianceView() {
  const [search] = useSearchParams()
  const chosen = search.get("event") ?? undefined
  const { apiBase, tenant = "default" } = useData()
  const query = useBundle(chosen)
  return (
    <div data-slot="content">
      <Chooser chosen={chosen} />
      {chosen === undefined ? null : apiBase === undefined ? (
        <section aria-label="Bundle" data-slot="note">
          <p>
            The service is not configured: <code>config.json</code> names no <code>apiBase</code>,
            so nothing can sign a bundle.
          </p>
        </section>
      ) : !EVENT_ID.test(chosen) ? (
        <p data-slot="missing-panel">
          <code>{chosen}</code> is not an event id.
        </p>
      ) : query.data === undefined ? (
        <p role="status" data-slot="cell-note">
          Replaying and signing…
        </p>
      ) : (
        <Proof answer={query.data} apiBase={apiBase} eventId={chosen} />
      )}
      {chosen !== undefined && apiBase !== undefined && EVENT_ID.test(chosen) ? (
        <p data-slot="cell-note">
          Read from <code data-mono="">{bundleUrl(apiBase, chosen, tenant)}</code>
        </p>
      ) : null}
    </div>
  )
}
