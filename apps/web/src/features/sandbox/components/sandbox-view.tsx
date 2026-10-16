// The sandbox (dashboard-plan.md 7.8): an event replayed through the real assembler on the replay
// service (D12, ADR-0005), with the reader's controls applied, its outcome, its parity with what the
// event recorded and the trace diff. What a replay may claim is fidelity.ts's to decide; the page
// says it. Without a configured service the page says so and how to run one.

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import { useRef, useState } from "react"
import { Link, useSearchParams } from "react-router"

import { DashboardPage } from "../../../components/dashboard/dashboard-page"
import { DataRegion } from "../../../components/dashboard/data-region"
import { StatusBadge } from "../../../components/dashboard/status-badge"
import { useEvent } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import type { ReplayAnswer, ReplayClient } from "../api/replay"
import { useReplayClient } from "../api/replay-context"
import { applyControls } from "../model/controls"
import { traceDiff } from "../model/diff"
import { parity, replayable } from "../model/fidelity"
import { controlsFromSearch, edited, searchWithControls } from "../model/url"
import { ControlsForm } from "./controls-form"

type Run =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "done"; readonly answer: ReplayAnswer }

type Replayed = Extract<ReplayAnswer, { kind: "replayed" }>

function NotConfigured() {
  return (
    <section aria-label="Replay service" data-slot="note">
      <p>
        The replay service is not configured: <code>config.json</code> names no <code>apiBase</code>
        . The sandbox replays through the real assembler on that service, never in the browser
        (ADR-0005).
      </p>
      <p>
        Locally, <code>pnpm dev</code> starts it beside the app; a deployment proxies{" "}
        <code>/api/</code> to it and sets <code>&quot;apiBase&quot;: &quot;/api&quot;</code>.
      </p>
    </section>
  )
}

function ParityPanel({
  event,
  answer,
  isEdited,
}: {
  readonly event: AssemblyEventV1
  readonly answer: Replayed
  readonly isEdited: boolean
}) {
  if (event.outcome === "rejected") {
    return (
      <section aria-label="Parity" data-slot="panel" data-padded="">
        <p data-label="">Parity · no parity claimed</p>
        <p>The event recorded a rejection, with no assembly to compare with.</p>
      </section>
    )
  }
  const check = parity(
    event,
    {
      outcome: answer.outcome,
      payloadHash: answer.payloadHash,
      snapshotDigest: answer.snapshotDigest,
    },
    { edited: isEdited },
  )
  if (check.kind === "edited" || check.kind === "no-claim") {
    return (
      <section aria-label="Parity" data-slot="panel" data-padded="">
        <p data-label="">Parity · no parity claimed</p>
        <p>{check.note}</p>
      </section>
    )
  }
  return (
    <section
      aria-label="Parity"
      data-slot={check.kind === "equal" ? "panel" : "note"}
      data-padded=""
    >
      <p data-label="">Parity · {check.kind}</p>
      <dl data-slot="key-values">
        <div>
          <dt>recorded by {check.recorded.language}</dt>
          <dd data-mono="">{check.recorded.hash ?? "no payload (refused)"}</dd>
        </div>
        <div>
          <dt>replayed by typescript</dt>
          <dd data-mono="">{check.replayed.hash ?? "no payload (refused)"}</dd>
        </div>
        <div>
          <dt>snapshot digest</dt>
          <dd data-mono="">
            {check.recorded.digest} · {check.replayed.digest}
          </dd>
        </div>
      </dl>
      <p>{check.note}</p>
    </section>
  )
}

function DiffPanel({
  recorded,
  replayed,
}: {
  readonly recorded: unknown
  readonly replayed: unknown
}) {
  const diff = traceDiff(recorded, replayed)
  return (
    <section aria-labelledby="sandbox-diff" data-slot="panel">
      <h2 id="sandbox-diff" data-slot="panel-header" data-label="">
        Trace diff
      </h2>
      <div role="region" aria-label="Trace diff lines" tabIndex={0} data-slot="scroll-region">
        {!diff.changed ? (
          <p data-slot="panel-note">No change from the recorded trace, its id and timings aside.</p>
        ) : diff.tooLarge ? (
          <p data-slot="panel-note">
            The traces differ, and are too large to compare line by line here.
          </p>
        ) : (
          <pre data-slot="diff">
            {diff.rows.map((row, i) =>
              row.kind === "skipped" ? (
                <span key={i} data-row="skipped">{`  … ${row.lines} unchanged lines\n`}</span>
              ) : (
                <span key={i} data-row={row.kind}>
                  {`${row.kind === "added" ? "+" : row.kind === "removed" ? "-" : " "} ${row.text}\n`}
                </span>
              ),
            )}
          </pre>
        )}
      </div>
    </section>
  )
}

function Outcome({ answer }: { readonly answer: Replayed }) {
  const trace = answer.trace as {
    result?: { input_tokens: number } | null
    refused: { reason: string | null }
  }
  return (
    <StatusBadge
      outcome={answer.outcome}
      {...(trace.result ? { inputTokens: trace.result.input_tokens } : {})}
      {...(trace.refused.reason ? { refusedReason: trace.refused.reason } : {})}
    />
  )
}

const FAILURE: Record<"rejected" | "unsupported" | "invalid-response", string> = {
  rejected: "The snapshot was rejected before assembly:",
  unsupported: "The assembler does not provide a tokenizer or renderer the snapshot names (R-16):",
  "invalid-response": "The service's answer is not a replay:",
}

function Result({
  event,
  run,
  isEdited,
}: {
  readonly event: AssemblyEventV1
  readonly run: Run
  readonly isEdited: boolean
}) {
  if (run.status === "idle") return null
  const body = () => {
    if (run.status === "running") return <p data-slot="cell-note">Replaying…</p>
    const { answer } = run
    switch (answer.kind) {
      case "replayed":
        return (
          <>
            <Outcome answer={answer} />
            <ParityPanel event={event} answer={answer} isEdited={isEdited} />
            <DiffPanel recorded={event.trace} replayed={answer.trace} />
          </>
        )
      case "rejected":
      case "unsupported":
      case "invalid-response":
        return (
          <div data-slot="note">
            <p>{FAILURE[answer.kind]}</p>
            <ul>
              {answer.problems.map((problem) => (
                <li key={problem}>
                  <code>{problem}</code>
                </li>
              ))}
            </ul>
          </div>
        )
      default:
        return (
          <div data-slot="note">
            <p>{answer.message}</p>
          </div>
        )
    }
  }
  return (
    <section aria-label="Replay result" aria-live="polite" data-slot="content">
      {body()}
    </section>
  )
}

function Replayer({
  event,
  client,
}: {
  readonly event: AssemblyEventV1
  readonly client: ReplayClient
}) {
  const source = replayable(event)
  const [run, setRun] = useState<Run>({ status: "idle" })
  const [search, setSearch] = useSearchParams()
  const inFlight = useRef<AbortController | null>(null)
  if (source.kind === "none") {
    return (
      <section aria-label="Fidelity" data-slot="note">
        <p>{source.reason}</p>
      </section>
    )
  }
  const controls = controlsFromSearch(search)
  const applied = applyControls(source.snapshot, controls)
  const isEdited = edited(controls)
  const replay = async () => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setRun({ status: "running" })
    try {
      const answer = await client.replay(applied.snapshot, controller.signal)
      if (!controller.signal.aborted) setRun({ status: "done", answer })
    } catch (error) {
      if (!controller.signal.aborted) throw error
    }
  }
  return (
    <div data-slot="content">
      {source.kind === "full" ? null : (
        <section aria-label="Fidelity" data-slot="note">
          <p>{source.reason}</p>
        </section>
      )}
      <ControlsForm
        snapshot={source.snapshot}
        controls={controls}
        onChange={(next) => setSearch(searchWithControls(search, next), { replace: true })}
      />
      {applied.problems.length > 0 ? (
        <section aria-label="Control problems" data-slot="note">
          <ul>
            {applied.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <div>
        <button
          type="button"
          data-slot="inverse-button"
          onClick={() => void replay()}
          disabled={applied.problems.length > 0}
          aria-busy={run.status === "running"}
        >
          Replay
        </button>
      </div>
      <Result event={event} run={run} isEdited={isEdited} />
    </div>
  )
}

function EventReplay({
  eventId,
  client,
}: {
  readonly eventId: string
  readonly client: ReplayClient
}) {
  const region = regionOf(useEvent(eventId), { what: `Event ${eventId}` })
  return (
    <DataRegion region={region} label={`event ${eventId}`}>
      {(event) => (
        <div data-slot="content">
          <p data-slot="panel-note">
            <Link to={`/traces/${event.event_id}`}>{event.event_id}</Link> · recorded by the{" "}
            {event.assembler.language} assembler {event.assembler.version} · {event.redaction_mode}{" "}
            · replayed by the TypeScript assembler
          </p>
          <Replayer key={event.event_id} event={event} client={client} />
        </div>
      )}
    </DataRegion>
  )
}

export function SandboxView() {
  const [search] = useSearchParams()
  const client = useReplayClient()
  const eventId = search.get("event")
  return (
    <DashboardPage
      kicker="Sandbox"
      title="Replay"
      lede="Replay an event's snapshot through the real TypeScript assembler on the replay service, and compare what it decides with what the event recorded (R-23)."
    >
      {client === null ? (
        <NotConfigured />
      ) : eventId === null ? (
        <p data-slot="panel-note">
          Open an event from the <Link to="/traces">trace stream</Link> and choose “Replay in the
          sandbox”.
        </p>
      ) : (
        <EventReplay eventId={eventId} client={client} />
      )}
    </DashboardPage>
  )
}
