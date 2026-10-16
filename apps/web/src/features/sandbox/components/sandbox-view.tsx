// The sandbox (dashboard-plan.md 7.8): an event replayed through the real assembler on the replay
// service (D12, ADR-0005), with the reader's controls applied, its outcome, its parity with what the
// event recorded and the trace diff; or a snapshot of the reader's own, pasted or uploaded, which
// has nothing recorded to compare with. Either can be downloaded as replayed. What a replay may claim is fidelity.ts's to decide; the page
// says it. Without a configured service the page says so and how to run one.

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import { useQuery } from "@tanstack/react-query"
import { lazy, Suspense, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router"

import { BudgetBar } from "../../../components/charts/budget-bar"
import { DashboardPage } from "../../../components/dashboard/dashboard-page"
import { DataRegion } from "../../../components/dashboard/data-region"
import { StatusBadge } from "../../../components/dashboard/status-badge"
import { useEvent } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import type { ReplayAnswer, ReplayClient } from "../api/replay"
import { useReplayClient } from "../api/replay-context"
import { applyControls, type Snapshot } from "../model/controls"
import { traceDiff } from "../model/diff"
import { settle } from "../model/settle"
import { parity, replayable } from "../model/fidelity"
import { controlsFromSearch, edited, searchWithControls } from "../model/url"
import { ControlsForm } from "./controls-form"

type Run =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | {
      readonly status: "done"
      readonly answer: ReplayAnswer
      /** The snapshot replayed, the controls applied. */
      readonly snapshot: Snapshot
      /** Which run this is, so a replay again settles afresh. */
      readonly id: number
    }

type Replayed = Extract<ReplayAnswer, { kind: "replayed" }>

const SettleMotion = lazy(() => import("./settle-motion"))

/** The replay's bar, settling from the recorded assembly's, and the diff revealed beneath it. */
function Settled({
  event,
  answer,
  snapshot,
}: {
  readonly event: AssemblyEventV1
  readonly answer: Replayed
  readonly snapshot: Snapshot
}) {
  const scope = useRef<HTMLDivElement>(null)
  const replayed = {
    ...event,
    snapshot,
    trace: answer.trace as AssemblyEventV1["trace"],
  } as AssemblyEventV1
  const plan = settle(event, replayed)
  return (
    <>
      <div ref={scope} data-slot="stack">
        <div data-slot="panel" data-padded="">
          <BudgetBar event={replayed} ghosts={plan?.ghosts ?? []} />
        </div>
        <div data-slot="settle-reveal">
          <DiffPanel recorded={event.trace} replayed={answer.trace} />
        </div>
      </div>
      {/* After the scope, not inside it: React reattaches a ref after its element's children, so a
          motion inside it would find no scope when Strict Mode mounts it a second time. */}
      {plan ? (
        <Suspense fallback={null}>
          <SettleMotion scope={scope} from={plan.from} />
        </Suspense>
      ) : null}
    </>
  )
}

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

/** Any answer that is not a replay, in words. */
function Failure({ answer }: { readonly answer: Exclude<ReplayAnswer, Replayed> }) {
  switch (answer.kind) {
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

const asDataUrl = (value: unknown) =>
  `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(value, null, 2))}`

/** The snapshot replayed and the trace it gave, as JSON files to keep. */
function Downloads({
  name,
  snapshot,
  trace,
}: {
  readonly name: string
  readonly snapshot: unknown
  readonly trace: unknown
}) {
  return (
    <ul aria-label="Downloads" data-slot="chip-row">
      <li>
        <a
          href={asDataUrl(snapshot)}
          download={`${name}.replay.snapshot.json`}
          data-slot="ghost-button"
        >
          Download the snapshot
        </a>
      </li>
      <li>
        <a href={asDataUrl(trace)} download={`${name}.replay.trace.json`} data-slot="ghost-button">
          Download the trace
        </a>
      </li>
    </ul>
  )
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
            <Settled key={run.id} event={event} answer={answer} snapshot={run.snapshot} />
            <Downloads name={event.event_id} snapshot={run.snapshot} trace={answer.trace} />
          </>
        )
      default:
        return <Failure answer={answer} />
    }
  }
  return (
    <section aria-label="Replay result" aria-live="polite" data-slot="stack">
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
  const runs = useRef(0)
  const components = useQuery({
    queryKey: ["replay-components"],
    queryFn: ({ signal }) => client.components(signal),
    staleTime: Infinity,
  })
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
      if (!controller.signal.aborted) {
        runs.current += 1
        setRun({ status: "done", answer, snapshot: applied.snapshot, id: runs.current })
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error
    }
  }
  return (
    <div data-slot="stack">
      {source.kind === "full" ? null : (
        <section aria-label="Fidelity" data-slot="note">
          <p>{source.reason}</p>
        </section>
      )}
      <ControlsForm
        snapshot={source.snapshot}
        controls={controls}
        components={components.data}
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

/** The sandbox accepts a snapshot up to this size (dashboard-plan.md 9). */
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024

type Pasted =
  | { readonly status: "idle" }
  | { readonly status: "invalid"; readonly message: string }
  | { readonly status: "running" }
  | { readonly status: "done"; readonly answer: ReplayAnswer; readonly snapshot: unknown }

/** A snapshot of the reader's own, pasted or uploaded, replayed with nothing recorded to compare. */
function PastedReplay({ client }: { readonly client: ReplayClient }) {
  const [text, setText] = useState("")
  const [state, setState] = useState<Pasted>({ status: "idle" })
  const inFlight = useRef<AbortController | null>(null)
  const replay = async () => {
    if (new Blob([text]).size > MAX_SNAPSHOT_BYTES) {
      setState({ status: "invalid", message: "The snapshot is over the sandbox's 4 MiB limit." })
      return
    }
    let snapshot: unknown
    try {
      snapshot = JSON.parse(text)
    } catch (error) {
      setState({
        status: "invalid",
        message: `The snapshot is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      })
      return
    }
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setState({ status: "running" })
    try {
      const answer = await client.replay(snapshot, controller.signal)
      if (!controller.signal.aborted) setState({ status: "done", answer, snapshot })
    } catch (error) {
      if (!controller.signal.aborted) throw error
    }
  }
  return (
    <div data-slot="stack">
      <div data-slot="field">
        <label htmlFor="sandbox-snapshot" data-label="">
          Snapshot JSON
        </label>
        <textarea
          id="sandbox-snapshot"
          data-slot="textarea"
          rows={10}
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div data-slot="field">
        <label htmlFor="sandbox-upload" data-label="">
          Upload a snapshot
        </label>
        <input
          id="sandbox-upload"
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void file.text().then(setText)
          }}
        />
      </div>
      {state.status === "invalid" ? (
        <p role="alert" data-slot="note">
          {state.message}
        </p>
      ) : null}
      <div>
        <button
          type="button"
          data-slot="inverse-button"
          onClick={() => void replay()}
          disabled={text.trim() === ""}
          aria-busy={state.status === "running"}
        >
          Replay
        </button>
      </div>
      {state.status === "running" || state.status === "done" ? (
        <section aria-label="Replay result" aria-live="polite" data-slot="stack">
          {state.status === "running" ? (
            <p data-slot="cell-note">Replaying…</p>
          ) : state.answer.kind === "replayed" ? (
            <>
              <Outcome answer={state.answer} />
              <p data-slot="panel-note">
                No recorded event to compare with, so no parity is claimed.
              </p>
              <section aria-labelledby="sandbox-trace" data-slot="panel">
                <h2 id="sandbox-trace" data-slot="panel-header" data-label="">
                  Trace
                </h2>
                <pre tabIndex={0} aria-label="Trace JSON" data-slot="raw-json">
                  {JSON.stringify(state.answer.trace, null, 2)}
                </pre>
              </section>
              <Downloads name="snapshot" snapshot={state.snapshot} trace={state.answer.trace} />
            </>
          ) : (
            <Failure answer={state.answer} />
          )}
        </section>
      ) : null}
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
          {/* A list, so no link sits in running text (axe, link-in-text-block). */}
          <ul aria-label="Event" data-slot="facts">
            <li>
              <span data-label="">event</span>{" "}
              <Link to={`/traces/${event.event_id}`}>{event.event_id}</Link>
            </li>
            <li>
              <span data-label="">recorded by</span>{" "}
              <code>
                {event.assembler.language} {event.assembler.version}
              </code>
            </li>
            <li>
              <span data-label="">redaction</span> <code>{event.redaction_mode}</code>
            </li>
            <li>
              <span data-label="">replayed by</span> <code>typescript</code>
            </li>
          </ul>
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
        <div data-slot="content">
          <p data-slot="panel-note">
            Choose “Replay in the sandbox” on an event’s page, or replay a snapshot of your own.
          </p>
          <p>
            <Link to="/traces">Open the trace stream →</Link>
          </p>
          <PastedReplay client={client} />
          <section aria-label="Shadow regression" data-slot="panel" data-padded="">
            <p data-label="">Shadow regression · Phase 2</p>
            <p>
              Replaying a whole corpus of recorded events against a changed route policy or profile,
              and reporting every assembly that changes, arrives in Phase 2 with the query API.
              Here, one event or one snapshot replays at a time.
            </p>
          </section>
        </div>
      ) : (
        <EventReplay eventId={eventId} client={client} />
      )}
    </DashboardPage>
  )
}
