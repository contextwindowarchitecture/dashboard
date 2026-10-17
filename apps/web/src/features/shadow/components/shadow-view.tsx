// Shadow regression (dashboard-plan.md DP-12, ADR-0008): choose a frozen corpus (`?corpus=`), paste a
// candidate route policy or profile, and read what it would change. The ingest service replays each
// full event twice through the pinned assembler, as recorded and with the candidate; the page only
// asks and says what the report holds. A corpus is frozen with the ingest token, never from here.

import type { ShadowReportV1 } from "@cwa-dashboard/telemetry/types"
import { useRef, useState } from "react"
import { Link, useSearchParams } from "react-router"

import { MetricCell } from "../../../components/dashboard/metric-cell"
import { ReasonChip } from "../../../components/dashboard/reason-chip"
import { StatusBadge } from "../../../components/dashboard/status-badge"
import { Badge } from "../../../components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select"
import { useData } from "../../../data/data-context"
import { formatCount, formatInstant } from "../../../lib/format"
import {
  corporaUrl,
  runShadow,
  useCorpora,
  type CorpusSummary,
  type ShadowAnswer,
} from "../api/shadow"
import { candidateChoices, candidateText, parseCandidate } from "../model/candidate"

type Row = ShadowReportV1["events"][number]
type Side = NonNullable<Row["baseline"]>

const SKIPPED: Record<string, string> = {
  redacted: "not recorded in full, so its snapshot cannot be replayed faithfully",
  rejected: "rejected when recorded, so it froze no snapshot to replay",
  missing: "no longer in the store",
}
const signed = (n: number) => (n > 0 ? `+${formatCount(n)}` : n < 0 ? `−${formatCount(-n)}` : "0")
const CHOICES = candidateChoices()
const OWN = "own"

function Corpora({
  corpora,
  chosen,
}: {
  readonly corpora: readonly CorpusSummary[]
  readonly chosen: string | undefined
}) {
  if (corpora.length === 0) {
    return (
      <section aria-label="No corpus" data-slot="note">
        <p>
          No corpus is frozen yet. Freeze one with the ingest token: <code>POST /corpora</code> with
          a name and the event ids, or a filter on the stream, sent with <code>INGEST_TOKEN</code>{" "}
          as a bearer token (<code>deploy/README.md</code>). A corpus is never overwritten, so a run
          against it replays the same snapshots.
        </p>
      </section>
    )
  }
  return (
    <div role="region" aria-label="Corpora table" tabIndex={0} data-slot="scroll-region">
      <table aria-label="Corpora" data-slot="chart-table">
        <thead>
          <tr>
            <th scope="col">Corpus</th>
            <th scope="col" data-numeric="">
              Events
            </th>
            <th scope="col">Frozen</th>
          </tr>
        </thead>
        <tbody>
          {corpora.map((corpus) => (
            <tr key={corpus.name} {...(corpus.name === chosen ? { "aria-current": "true" } : {})}>
              <th scope="row" data-mono="">
                <Link to={`/shadow?corpus=${encodeURIComponent(corpus.name)}`}>{corpus.name}</Link>
              </th>
              <td data-numeric="">{formatCount(corpus.events)}</td>
              <td>{formatInstant(corpus.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SideCell({ side }: { readonly side: Side }) {
  return (
    <>
      <StatusBadge
        outcome={side.outcome}
        {...(side.input_tokens === undefined ? {} : { inputTokens: side.input_tokens })}
        {...(side.refused_reason === undefined ? {} : { refusedReason: side.refused_reason })}
        {...(side.problems === undefined ? {} : { problemCount: side.problems.length })}
      />
      {side.problems && side.problems.length > 0 ? (
        <ul aria-label="Problems" data-slot="cell-note">
          {side.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

function Exclusions({
  baseline,
  candidate,
}: {
  readonly baseline: Side
  readonly candidate: Side
}) {
  const codes = [
    ...new Set([...Object.keys(baseline.excluded), ...Object.keys(candidate.excluded)]),
  ]
    .filter((code) => (baseline.excluded[code] ?? 0) !== (candidate.excluded[code] ?? 0))
    .sort()
  if (codes.length === 0) return <span data-slot="cell-note">the same</span>
  return (
    <ul data-slot="chip-row" aria-label="Exclusions that change">
      {codes.map((code) => (
        <li key={code}>
          <ReasonChip code={code} link={false} />{" "}
          <span data-slot="cell-note">
            {formatCount(baseline.excluded[code] ?? 0)} →{" "}
            {formatCount(candidate.excluded[code] ?? 0)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Included({ baseline, candidate }: { readonly baseline: Side; readonly candidate: Side }) {
  if (baseline.outcome !== "assembled" || candidate.outcome !== "assembled")
    return <span data-slot="cell-note">not compared: one side did not assemble</span>
  if (JSON.stringify(baseline.included) === JSON.stringify(candidate.included))
    return <span data-slot="cell-note">the same, in the same order</span>
  const before = new Set(baseline.included)
  const after = new Set(candidate.included)
  const added = candidate.included.filter((id) => !before.has(id)).length
  const removed = baseline.included.filter((id) => !after.has(id)).length
  if (added === 0 && removed === 0) return <span>the same items, in another order</span>
  return (
    <span>
      {formatCount(added)} in, {formatCount(removed)} out
    </span>
  )
}

function EventRow({ row }: { readonly row: Row }) {
  return (
    <tr>
      <th scope="row" data-mono="">
        {row.status === "skipped" && row.skipped === "missing" ? (
          row.event_id
        ) : (
          <Link to={`/traces/${row.event_id}`}>{row.event_id}</Link>
        )}
      </th>
      <td>
        <Badge variant="outline" data-tone={row.status === "changed" ? "warn" : "quiet"}>
          {row.status === "skipped" ? `skipped · ${row.skipped}` : row.status}
        </Badge>
        {row.baseline_parity === "differ" ? (
          <>
            {" "}
            <Badge variant="outline" data-tone="fill">
              baseline differs
            </Badge>
          </>
        ) : null}
      </td>
      {row.baseline && row.candidate ? (
        <>
          <td>
            <SideCell side={row.baseline} />
          </td>
          <td>
            <SideCell side={row.candidate} />
          </td>
          <td>
            <Exclusions baseline={row.baseline} candidate={row.candidate} />
          </td>
          <td>
            <Included baseline={row.baseline} candidate={row.candidate} />
          </td>
        </>
      ) : (
        <td colSpan={4}>
          <span data-slot="cell-note">
            {row.status === "skipped"
              ? `Not replayed: ${SKIPPED[row.skipped ?? ""] ?? row.skipped}.`
              : "Both sides decide the same."}
          </span>
        </td>
      )}
    </tr>
  )
}

function Report({ report }: { readonly report: ShadowReportV1 }) {
  const { summary, candidate, assembler, corpus } = report
  const named = [
    candidate.route_policy
      ? `route policy ${candidate.route_policy.route} ${candidate.route_policy.version}`
      : undefined,
    candidate.profile ? `profile ${candidate.profile.id} v${candidate.profile.version}` : undefined,
  ].filter(Boolean)
  const skipped = Object.entries(summary.skipped).flatMap(([why, n]) =>
    n ? [[why, n] as const] : [],
  )
  return (
    <section aria-label="Shadow report" data-slot="stack">
      <div role="status" aria-label="Shadow status" data-slot="status-region">
        <span>
          corpus {corpus.name} · {formatCount(corpus.events)} events
        </span>
        <span>· candidate {named.join(" and ")}</span>
        <span>
          · both sides through {assembler.language} {assembler.name} {assembler.version}
        </span>
        <span>· generated {formatInstant(report.generated_at)}</span>
      </div>
      <ul aria-label="Summary" data-slot="metric-grid">
        <MetricCell
          label="Replayed"
          value={formatCount(summary.replayed)}
          note={`of ${formatCount(corpus.events)} in the corpus, each twice`}
        />
        <MetricCell
          label="Changed"
          value={formatCount(summary.changed)}
          note="events the candidate decides otherwise"
        />
        <MetricCell
          label="Refusals added"
          value={formatCount(summary.refusals_added)}
          note={`the baseline assembled, the candidate refuses; ${formatCount(summary.refusals_removed)} the other way`}
        />
        <MetricCell
          label="Candidate rejected"
          value={formatCount(summary.candidate_rejected)}
          note="snapshots the assembler rejects with the candidate in them"
        />
        <MetricCell
          label="Shedding change"
          value={signed(summary.shedding_change)}
          note="over_budget exclusions, the candidate's minus the baseline's, where both decide"
        />
        <MetricCell
          label="Placement changed"
          value={formatCount(summary.placement_changed)}
          note="events both assemble whose included items, in order, differ"
        />
      </ul>
      {summary.baseline_differs === 0 ? (
        <p data-slot="panel-note">Every baseline replay reproduces what was recorded.</p>
      ) : (
        <section aria-label="Baseline parity" data-slot="note">
          <p>
            {formatCount(summary.baseline_differs)} baseline replays do not reproduce what was
            recorded: a difference between the recording implementation and this one, not the
            candidate&rsquo;s. Each event is compared with its own replay.
          </p>
        </section>
      )}
      {skipped.length > 0 ? (
        <ul aria-label="Skipped" data-slot="chip-row">
          {skipped.map(([why, n]) => (
            <li key={why}>
              <Badge variant="outline" data-tone="quiet">
                skipped · {why} · {formatCount(n)}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <div role="region" aria-label="Events table" tabIndex={0} data-slot="scroll-region">
        <table aria-label="Events" data-slot="chart-table" data-wide="">
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Status</th>
              <th scope="col">Baseline</th>
              <th scope="col">Candidate</th>
              <th scope="col">Exclusions</th>
              <th scope="col">Included</th>
            </tr>
          </thead>
          <tbody>
            {report.events.map((row) => (
              <EventRow key={row.event_id} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Answer({ answer }: { readonly answer: ShadowAnswer }) {
  if (answer.kind === "ok") return <Report report={answer.report} />
  const words =
    answer.kind === "invalid-response"
      ? "The service answered with something that is not a shadow report this dashboard reads."
      : "problems" in answer
        ? answer.problems.join(" ") || `The service refused the run (${answer.kind}).`
        : answer.message || `The run did not finish (${answer.kind}).`
  return (
    <section aria-label="Shadow report" role="alert" data-slot="note">
      <p>{words}</p>
    </section>
  )
}

type Run =
  | { readonly status: "idle" }
  | { readonly status: "invalid"; readonly message: string }
  | { readonly status: "running" }
  | { readonly status: "done"; readonly answer: ShadowAnswer }

function ShadowRun({
  apiBase,
  corpus,
}: {
  readonly apiBase: string
  readonly corpus: CorpusSummary
}) {
  const { fetchFn = fetch } = useData()
  const [start, setStart] = useState(OWN)
  const [text, setText] = useState("")
  const [run, setRun] = useState<Run>({ status: "idle" })
  const inFlight = useRef<AbortController | null>(null)
  const shadow = async () => {
    const parsed = parseCandidate(text)
    if (!parsed.ok) {
      setRun({ status: "invalid", message: parsed.message })
      return
    }
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setRun({ status: "running" })
    try {
      const answer = await runShadow(
        apiBase,
        { corpus: corpus.name, candidate: parsed.candidate },
        fetchFn,
        controller.signal,
      )
      if (!controller.signal.aborted) setRun({ status: "done", answer })
    } catch (error) {
      if (!controller.signal.aborted) throw error
    }
  }
  return (
    <section aria-label="Candidate" data-slot="stack">
      <p data-slot="panel-note">
        The candidate replaces each snapshot&rsquo;s route policy, its profile, or both. Every full
        event of <span data-mono="">{corpus.name}</span> replays twice through the pinned assembler,
        as recorded and with the candidate. A profile binds one route and route policy version
        (R-20): a snapshot on another rejects it, and the report counts the rejections.
      </p>
      <div data-slot="field">
        <label id="shadow-start" data-label="">
          Start from
        </label>
        <Select
          value={start}
          onValueChange={(value) => {
            setStart(value)
            const filled = candidateText(value)
            if (filled !== undefined) setText(filled)
          }}
        >
          <SelectTrigger aria-labelledby="shadow-start">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OWN}>A candidate of your own</SelectItem>
            {CHOICES.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div data-slot="field">
        <label htmlFor="shadow-candidate" data-label="">
          Candidate JSON
        </label>
        <textarea
          id="shadow-candidate"
          data-slot="textarea"
          rows={10}
          spellCheck={false}
          placeholder='{ "profile": { … } }'
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      {run.status === "invalid" ? (
        <p role="alert" data-slot="note">
          {run.message}
        </p>
      ) : null}
      <div>
        <button
          type="button"
          data-slot="inverse-button"
          onClick={() => void shadow()}
          disabled={text.trim() === "" || run.status === "running"}
          aria-busy={run.status === "running"}
        >
          Shadow
        </button>
      </div>
      {run.status === "running" ? (
        <p role="status" data-slot="cell-note">
          Replaying {formatCount(corpus.events)} events twice…
        </p>
      ) : run.status === "done" ? (
        <Answer answer={run.answer} />
      ) : null}
      <p data-slot="cell-note">
        The same run gates a pull request: <code>deploy/shadow-check.mjs</code> and the{" "}
        <code>shadow-regression</code> action fail it on the limits it is given.
      </p>
    </section>
  )
}

export function ShadowView() {
  const [search] = useSearchParams()
  const chosen = search.get("corpus") ?? undefined
  const { apiBase } = useData()
  const query = useCorpora()
  if (apiBase === undefined) {
    return (
      <div data-slot="content">
        <section aria-label="Corpora" data-slot="note">
          <p>
            The service is not configured: <code>config.json</code> names no <code>apiBase</code>,
            so nothing can replay a corpus.
          </p>
        </section>
      </div>
    )
  }
  const answer = query.data
  const corpus =
    answer?.kind === "ok" && chosen !== undefined
      ? answer.corpora.find((c) => c.name === chosen)
      : undefined
  return (
    <div data-slot="content">
      {answer === undefined ? (
        <p role="status" data-slot="cell-note">
          Reading the corpora…
        </p>
      ) : answer.kind === "ok" ? (
        <Corpora corpora={answer.corpora} chosen={chosen} />
      ) : (
        <section
          aria-label="Corpora"
          data-slot="note"
          {...(answer.kind === "not-configured" ? {} : { role: "alert" })}
        >
          <p>
            {answer.kind === "not-configured"
              ? `The service cannot list corpora: ${answer.problems.join(" ")}`
              : answer.kind === "invalid"
                ? `${answer.url} is not a list of corpora this dashboard reads.`
                : answer.message}
          </p>
        </section>
      )}
      {chosen === undefined || answer?.kind !== "ok" ? null : corpus === undefined ? (
        <p data-slot="missing-panel">
          No corpus <span data-mono="">{chosen}</span> is frozen.
        </p>
      ) : (
        <ShadowRun key={corpus.name} apiBase={apiBase} corpus={corpus} />
      )}
      <p data-slot="cell-note">
        Read from <code data-mono="">{corporaUrl(apiBase)}</code>
      </p>
    </div>
  )
}
