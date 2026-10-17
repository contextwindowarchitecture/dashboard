// The authoring page (ADR-0013): a signed-in owner's drafts, kept in the API; a draft started from a
// registry entry; the editor, field by field as the contract's FIELDS name them or as one JSON
// document, checked by the contract's validators with every change against where it started in view;
// and two previews, both the pinned assembler's: an event of the draft's route replayed with the draft
// in its snapshot, and a frozen corpus shadowed with the draft as the candidate. The API decides who
// may keep a draft; the page says what it answered.

import { FIELDS, type Field } from "@cwa-dashboard/contract/data"
import type { AssemblyEventV1, DraftV1 } from "@cwa-dashboard/telemetry/types"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useId, useRef, useState } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router"

import { StatusBadge } from "../../../components/dashboard/status-badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select"
import { useData } from "../../../data/data-context"
import { useEvent, useIndex } from "../../../data/queries"
import { DEFAULT_TENANT } from "../../../data/tenant"
import { formatCount, formatInstant } from "../../../lib/format"
import { loginHref, useMe } from "../../account/api/me"
import type { ReplayAnswer, ReplayClient } from "../../sandbox/api/replay"
import { useReplayClient } from "../../sandbox/api/replay-context"
import { Failure, Outcome } from "../../sandbox/components/replay-answer"
import { replayable } from "../../sandbox/model/fidelity"
import { runShadow, useCorpora, type ShadowAnswer } from "../../shadow/api/shadow"
import { ShadowAnswerView } from "../../shadow/components/shadow-view"
import { candidateChoices } from "../../shadow/model/candidate"
import {
  deleteDraft,
  publishDraft,
  putDraft,
  useDraft,
  useDrafts,
  type PublishAnswer,
} from "../api/drafts"
import {
  changes,
  fieldText,
  setField,
  startFrom,
  startingDocument,
  withDraft,
  type DraftKind,
} from "../model/draft"

const CHOICES = candidateChoices()
const KIND: Record<DraftKind, string> = { profile: "Profile", route_policy: "Route policy" }
const shown = (value: unknown) => (value === undefined ? "absent" : JSON.stringify(value))
const routeOf = (document: unknown) =>
  typeof document === "object" && document !== null && "route" in document
    ? String((document as { route: unknown }).route)
    : undefined
const startedFromText = (started: DraftV1["started_from"]) =>
  started === null
    ? "nothing"
    : "profile" in started
      ? `profile ${started.profile.id} v${started.profile.version}`
      : `route policy ${started.route_policy.route} ${started.route_policy.version}`

function Drafts() {
  const query = useDrafts()
  if (query.isPending) {
    return (
      <p role="status" data-slot="cell-note">
        Reading your drafts…
      </p>
    )
  }
  if (query.isError) {
    return (
      <p role="alert" data-slot="note">
        Your drafts could not be read: {query.error.message}
      </p>
    )
  }
  if (query.data.length === 0) {
    return <p data-slot="panel-note">You have no drafts in this tenant yet.</p>
  }
  return (
    <div role="region" aria-label="Your drafts table" tabIndex={0} data-slot="scroll-region">
      <table aria-label="Your drafts" data-slot="chart-table">
        <thead>
          <tr>
            <th scope="col">Route</th>
            <th scope="col">Kind</th>
            <th scope="col">Started from</th>
            <th scope="col">Saved</th>
          </tr>
        </thead>
        <tbody>
          {query.data.map((draft) => (
            <tr key={draft.id}>
              <th scope="row" data-mono="">
                <Link to={`/authoring?draft=${encodeURIComponent(draft.id)}`}>{draft.route}</Link>
              </th>
              <td>{KIND[draft.kind]}</td>
              <td>{startedFromText(draft.started_from)}</td>
              <td>{formatInstant(draft.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StartDraft({ apiBase }: { readonly apiBase: string }) {
  const { fetchFn = fetch, tenant = DEFAULT_TENANT } = useData()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [choice, setChoice] = useState<string | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const labelId = useId()
  const start = async () => {
    const started = choice === undefined ? undefined : startFrom(choice)
    if (started === undefined) return
    setBusy(true)
    const id = crypto.randomUUID()
    const saved = await putDraft(apiBase, tenant, id, started, fetchFn)
    setBusy(false)
    if (!saved.ok) {
      setProblem(saved.message)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ["drafts"] })
    await navigate(`/authoring?draft=${encodeURIComponent(id)}`)
  }
  return (
    <section aria-labelledby={`${labelId}-title`} data-slot="panel">
      <h2 id={`${labelId}-title`} data-slot="panel-header" data-label="">
        Start a draft
      </h2>
      <div data-slot="stack">
        <p data-slot="panel-note">
          A draft starts from a registry entry and is kept in the service under your name, for a
          route you own. It goes nowhere until it is published.
        </p>
        <div data-slot="field">
          <label id={labelId} data-label="">
            Start from
          </label>
          <Select value={choice ?? ""} onValueChange={setChoice}>
            <SelectTrigger aria-labelledby={labelId}>
              <SelectValue placeholder="Choose a profile or a route policy" />
            </SelectTrigger>
            <SelectContent>
              {CHOICES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {problem === undefined ? null : (
          <p role="alert" data-slot="note">
            The draft was not kept: {problem}
          </p>
        )}
        <div>
          <button
            type="button"
            data-slot="inverse-button"
            disabled={choice === undefined}
            aria-busy={busy}
            onClick={() => {
              if (!busy) void start()
            }}
          >
            Start a draft
          </button>
        </div>
      </div>
    </section>
  )
}

/** The contract's precompiled validators, loaded with the editor so they stay out of the first chunk. */
function useValidators() {
  return useQuery({
    queryKey: ["contract-validators"],
    queryFn: () => import("@cwa-dashboard/contract/validators"),
    staleTime: Infinity,
    structuralSharing: false,
  })
}

function FieldInput({
  field,
  text,
  problem,
  onChange,
}: {
  readonly field: Field
  readonly text: string
  readonly problem: string | undefined
  readonly onChange: (text: string) => void
}) {
  const id = `draft-field-${field.name}`
  const multiline = field.kind === "json"
  return (
    <div data-slot="field">
      <label htmlFor={id} data-label="" data-mono="">
        {field.name}
      </label>
      {multiline ? (
        <textarea
          id={id}
          data-slot="textarea"
          rows={Math.min(12, Math.max(3, text.split("\n").length))}
          spellCheck={false}
          value={text}
          aria-describedby={`${id}-about`}
          aria-invalid={problem !== undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          data-slot="input"
          spellCheck={false}
          value={text}
          aria-describedby={`${id}-about`}
          aria-invalid={problem !== undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <p id={`${id}-about`} data-slot="cell-note">
        {field.required ? "Required. " : ""}
        {field.description}
        {field.values && field.kind === "enum" ? ` One of ${field.values.join(", ")}.` : ""}
      </p>
      {problem === undefined ? null : (
        <p data-slot="note" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}

function Changes({ start, document }: { readonly start: unknown; readonly document: unknown }) {
  if (start === undefined) {
    return (
      <p data-slot="panel-note">
        The registry does not hold what this draft started from, so there is nothing to compare it
        with.
      </p>
    )
  }
  const rows = changes(start, document)
  if (rows.length === 0) {
    return <p data-slot="panel-note">Nothing has changed from where the draft started.</p>
  }
  return (
    <div role="region" aria-label="Changes table" tabIndex={0} data-slot="scroll-region">
      <table aria-label="Changes" data-slot="chart-table">
        <thead>
          <tr>
            <th scope="col">Path</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path}>
              <th scope="row" data-mono="">
                {row.path}
              </th>
              <td data-mono="">{shown(row.before)}</td>
              <td data-mono="">{shown(row.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Checked({ kind, document }: { readonly kind: DraftKind; readonly document: unknown }) {
  const validators = useValidators()
  if (validators.data === undefined) {
    return (
      <p role="status" data-slot="cell-note">
        Loading the contract&rsquo;s validators…
      </p>
    )
  }
  const validate =
    kind === "profile" ? validators.data.validateProfile : validators.data.validateRoutePolicy
  if (validate(document)) {
    return (
      <p role="status" data-slot="panel-note">
        The contract&rsquo;s {kind} schema accepts this draft.
      </p>
    )
  }
  return (
    <section aria-label="Problems" data-slot="note">
      <p>The contract&rsquo;s {kind} schema refuses this draft:</p>
      <ul>
        {(validate.errors ?? []).map((error, i) => (
          <li key={i}>
            <code>{error.instancePath || "/"}</code> {error.message ?? "is invalid"}
          </li>
        ))}
      </ul>
    </section>
  )
}

type ReplayRun =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "done"; readonly answer: ReplayAnswer }

function Recorded({ event }: { readonly event: AssemblyEventV1 }) {
  return (
    <StatusBadge
      outcome={event.outcome}
      {...(event.trace?.result ? { inputTokens: event.trace.result.input_tokens } : {})}
      {...(event.trace?.refused.reason ? { refusedReason: event.trace.refused.reason } : {})}
      {...(event.rejection ? { problemCount: event.rejection.problems.length } : {})}
    />
  )
}

function ReplayChosen({
  eventId,
  client,
  kind,
  document,
}: {
  readonly eventId: string
  readonly client: ReplayClient
  readonly kind: DraftKind
  readonly document: unknown
}) {
  const query = useEvent(eventId)
  const [run, setRun] = useState<ReplayRun>({ status: "idle" })
  const inFlight = useRef<AbortController | null>(null)
  const result = query.data?.result
  if (query.isPending) {
    return (
      <p role="status" data-slot="cell-note">
        Reading event {eventId}…
      </p>
    )
  }
  if (query.isError || result === undefined || !result.ok) {
    return (
      <p role="alert" data-slot="note">
        Event {eventId} could not be read.
      </p>
    )
  }
  const event = result.document
  const source = replayable(event)
  if (source.kind === "none") {
    return (
      <p data-slot="note" aria-label="Fidelity">
        {source.reason}
      </p>
    )
  }
  const replay = async () => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setRun({ status: "running" })
    try {
      const answer = await client.replay(
        withDraft(source.snapshot, kind, document),
        controller.signal,
      )
      if (!controller.signal.aborted) setRun({ status: "done", answer })
    } catch (error) {
      if (!controller.signal.aborted) throw error
    }
  }
  return (
    <div data-slot="stack">
      {source.kind === "full" ? null : <p data-slot="panel-note">{source.reason}</p>}
      <div>
        <button
          type="button"
          data-slot="inverse-button"
          aria-busy={run.status === "running"}
          onClick={() => {
            if (run.status !== "running") void replay()
          }}
        >
          Replay
        </button>
      </div>
      {run.status === "running" ? (
        <p role="status" data-slot="cell-note">
          Replaying…
        </p>
      ) : run.status === "done" ? (
        <div role="region" aria-label="Replay result table" tabIndex={0} data-slot="scroll-region">
          <table aria-label="Replay result" data-slot="chart-table">
            <tbody>
              <tr>
                <th scope="row">As recorded</th>
                <td>
                  <Recorded event={event} />
                </td>
              </tr>
              <tr>
                <th scope="row">With the draft</th>
                <td>
                  {run.answer.kind === "replayed" ? (
                    <Outcome answer={run.answer} />
                  ) : (
                    <Failure answer={run.answer} />
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function ReplayPreview({
  route,
  kind,
  document,
}: {
  readonly route: string | undefined
  readonly kind: DraftKind
  readonly document: unknown
}) {
  const client = useReplayClient()
  const index = useIndex()
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const labelId = useId()
  const rows =
    index.data?.result.ok === true
      ? index.data.result.document.events
          // The index is newest first; the latest fifty of the route are enough to choose from.
          .filter((row) => row.route === route && row.redaction_mode !== "digest_only")
          .slice(0, 50)
      : []
  const body = () => {
    if (client === null) {
      return (
        <p data-slot="panel-note">
          The replay service is not configured, so nothing can replay the draft.
        </p>
      )
    }
    if (index.isPending) {
      return (
        <p role="status" data-slot="cell-note">
          Reading the events…
        </p>
      )
    }
    if (rows.length === 0) {
      return (
        <p data-slot="panel-note">
          No event of {route === undefined ? "the draft's route" : <code>{route}</code>} holds text
          to replay. A shadow run over a corpus may still preview the draft.
        </p>
      )
    }
    return (
      <>
        <div data-slot="field">
          <label id={labelId} data-label="">
            Event
          </label>
          <Select value={chosen ?? ""} onValueChange={setChosen}>
            <SelectTrigger aria-labelledby={labelId}>
              <SelectValue placeholder="Choose an event of the route" />
            </SelectTrigger>
            <SelectContent>
              {rows.map((row) => (
                <SelectItem key={row.event_id} value={row.event_id}>
                  {`${row.event_id} · ${row.service} · ${formatInstant(row.recorded_at)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {chosen === undefined ? null : (
          <ReplayChosen
            key={chosen}
            eventId={chosen}
            client={client}
            kind={kind}
            document={document}
          />
        )}
      </>
    )
  }
  return (
    <section aria-label="Replay an event" data-slot="panel">
      <h2 data-slot="panel-header" data-label="">
        Replay an event
      </h2>
      <div data-slot="stack">
        <p data-slot="panel-note">
          The event&rsquo;s snapshot with the draft in place of its {kind.replace("_", " ")},
          replayed through the pinned TypeScript assembler, beside what the event recorded.
        </p>
        {body()}
      </div>
    </section>
  )
}

type ShadowRun =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "done"; readonly answer: ShadowAnswer }

function ShadowPreview({
  apiBase,
  kind,
  document,
}: {
  readonly apiBase: string
  readonly kind: DraftKind
  readonly document: unknown
}) {
  const { fetchFn = fetch, tenant = DEFAULT_TENANT } = useData()
  const corpora = useCorpora()
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const [run, setRun] = useState<ShadowRun>({ status: "idle" })
  const inFlight = useRef<AbortController | null>(null)
  const labelId = useId()
  const shadow = async (corpus: string) => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setRun({ status: "running" })
    try {
      const answer = await runShadow(
        apiBase,
        { corpus, candidate: { [kind]: document as object } },
        fetchFn,
        controller.signal,
        tenant,
      )
      if (!controller.signal.aborted) setRun({ status: "done", answer })
    } catch (error) {
      if (!controller.signal.aborted) throw error
    }
  }
  const answer = corpora.data
  const body = () => {
    if (answer === undefined) {
      return (
        <p role="status" data-slot="cell-note">
          Reading the corpora…
        </p>
      )
    }
    if (answer.kind !== "ok") {
      return (
        <p data-slot="panel-note">
          No corpus can be listed here:{" "}
          {answer.kind === "not-configured"
            ? answer.problems.join(" ")
            : answer.kind === "invalid"
              ? `${answer.url} is not a list of corpora this dashboard reads.`
              : answer.message}
        </p>
      )
    }
    if (answer.corpora.length === 0) {
      return <p data-slot="panel-note">No corpus is frozen in this tenant yet.</p>
    }
    return (
      <>
        <div data-slot="field">
          <label id={labelId} data-label="">
            Corpus
          </label>
          <Select value={chosen ?? ""} onValueChange={setChosen}>
            <SelectTrigger aria-labelledby={labelId}>
              <SelectValue placeholder="Choose a frozen corpus" />
            </SelectTrigger>
            <SelectContent>
              {answer.corpora.map((corpus) => (
                <SelectItem key={corpus.name} value={corpus.name}>
                  {`${corpus.name} · ${formatCount(corpus.events)} events`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <button
            type="button"
            data-slot="inverse-button"
            disabled={chosen === undefined}
            aria-busy={run.status === "running"}
            onClick={() => {
              if (chosen !== undefined && run.status !== "running") void shadow(chosen)
            }}
          >
            Shadow
          </button>
        </div>
        {run.status === "running" ? (
          <p role="status" data-slot="cell-note">
            Replaying the corpus twice…
          </p>
        ) : run.status === "done" ? (
          <ShadowAnswerView answer={run.answer} />
        ) : null}
      </>
    )
  }
  return (
    <section aria-label="Shadow a corpus" data-slot="panel">
      <h2 data-slot="panel-header" data-label="">
        Shadow a corpus
      </h2>
      <div data-slot="stack">
        <p data-slot="panel-note">
          Every full event of a frozen corpus replayed twice through the pinned assembler, as
          recorded and with the draft as the candidate, read as the shadow page reads it.
        </p>
        {body()}
      </div>
    </section>
  )
}

const NO_SHADOW = "none"

type Publishing =
  | { readonly status: "idle" }
  | { readonly status: "publishing" }
  | { readonly status: "done"; readonly answer: PublishAnswer }

const pullName = (published: { readonly repository: string; readonly number: number }) =>
  `${published.repository}#${published.number}`

/** Publish (ADR-0014): the draft as saved, as a pull request in the tenant's policy repository. */
function PublishPanel({
  apiBase,
  draft,
  dirty,
}: {
  readonly apiBase: string
  readonly draft: DraftV1
  readonly dirty: boolean
}) {
  const { fetchFn = fetch, tenant = DEFAULT_TENANT } = useData()
  const queryClient = useQueryClient()
  const corpora = useCorpora()
  const [corpus, setCorpus] = useState(NO_SHADOW)
  const [run, setRun] = useState<Publishing>({ status: "idle" })
  const labelId = useId()
  const listed = corpora.data?.kind === "ok" ? corpora.data.corpora : []
  const publish = async () => {
    setRun({ status: "publishing" })
    const answer = await publishDraft(
      apiBase,
      tenant,
      draft.id,
      corpus === NO_SHADOW ? {} : { corpus },
      fetchFn,
    )
    setRun({ status: "done", answer })
    if (answer.kind === "published") {
      void queryClient.invalidateQueries({ queryKey: ["draft", apiBase, tenant, draft.id] })
    }
  }
  const answer = run.status === "done" ? run.answer : undefined
  return (
    <section aria-label="Publish" data-slot="panel">
      <h2 data-slot="panel-header" data-label="">
        Publish
      </h2>
      <div data-slot="stack">
        <p data-slot="panel-note">
          Opens a pull request with the draft as saved in the tenant&rsquo;s policy repository,
          where the file belongs in its layout, naming you as its author. With a corpus, the service
          shadows the draft over it first and puts the counts in the pull request; the
          repository&rsquo;s own check shadows it again before it merges. A published version is
          never edited in place: raise the version to change it.
        </p>
        {listed.length === 0 ? null : (
          <div data-slot="field">
            <label id={labelId} data-label="">
              Shadow over
            </label>
            <Select value={corpus} onValueChange={setCorpus}>
              <SelectTrigger aria-labelledby={labelId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SHADOW}>No shadow run</SelectItem>
                {listed.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {`${c.name} · ${formatCount(c.events)} events`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {dirty ? (
          <p data-slot="cell-note">Save the draft first: Publish takes the draft as saved.</p>
        ) : null}
        <div>
          <button
            type="button"
            data-slot="inverse-button"
            disabled={dirty}
            aria-busy={run.status === "publishing"}
            onClick={() => {
              if (run.status !== "publishing") void publish()
            }}
          >
            Publish
          </button>
        </div>
        {run.status === "publishing" ? (
          <p role="status" data-slot="cell-note">
            Publishing…
          </p>
        ) : answer === undefined ? null : answer.kind === "published" ? (
          // A list, so no link sits in running text (axe, link-in-text-block).
          <div role="status">
            <ul aria-label="Pull request" data-slot="facts">
              <li>
                <span data-label="">published as</span>{" "}
                <a href={answer.url} rel="noreferrer">
                  {pullName(answer)}
                </a>
              </li>
              <li>
                <span data-label="">file</span> <code>{answer.path}</code>
              </li>
              <li>
                <span data-label="">branch</span> <code>{answer.branch}</code>
              </li>
            </ul>
          </div>
        ) : answer.kind === "by-hand" ? (
          <section aria-label="Publish by hand" data-slot="stack">
            <p data-slot="panel-note">
              {answer.problems.join(" ")} Publish it by hand: save the file at{" "}
              <span data-mono="">{answer.path}</span> in a clone of the repository, then run the
              commands.
            </p>
            <pre tabIndex={0} aria-label="File" data-slot="raw-json">
              {answer.file}
            </pre>
            <pre tabIndex={0} aria-label="Commands" data-slot="raw-json">
              {answer.commands.join("\n")}
            </pre>
          </section>
        ) : (
          <div role="alert" data-slot="note">
            <p>The draft was not published: {answer.problems.join(" ")}</p>
          </div>
        )}
      </div>
    </section>
  )
}

type Saved =
  | { readonly status: "idle" }
  | { readonly status: "saving" }
  | { readonly status: "saved"; readonly at: string }
  | { readonly status: "failed"; readonly message: string }

function Editor({ apiBase, draft }: { readonly apiBase: string; readonly draft: DraftV1 }) {
  const { fetchFn = fetch, tenant = DEFAULT_TENANT } = useData()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [document, setDocument] = useState<unknown>(draft.document)
  // A field's or the JSON view's text while it is not a value the document can hold.
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>({})
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [json, setJson] = useState<{ text: string; problem?: string } | undefined>(undefined)
  const [saved, setSaved] = useState<Saved>({ status: "idle" })
  const [deleting, setDeleting] = useState(false)
  const kind = draft.kind
  const start = startingDocument(draft.started_from)
  const route = routeOf(document)

  const editField = (field: Field, text: string) => {
    const next = setField(document, field, text)
    const { [field.name]: _text, ...otherTexts } = texts
    const { [field.name]: _problem, ...otherProblems } = problems
    if (next.ok) {
      setDocument(next.document)
      setTexts(otherTexts)
      setProblems(otherProblems)
      setJson(undefined)
    } else {
      setTexts({ ...otherTexts, [field.name]: text })
      setProblems({ ...otherProblems, [field.name]: next.problem })
    }
  }
  const editJson = (text: string) => {
    try {
      const value: unknown = JSON.parse(text)
      setDocument(value)
      setTexts({})
      setProblems({})
      setJson({ text })
    } catch (error) {
      setJson({
        text,
        problem: `The draft is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  const save = async () => {
    setSaved({ status: "saving" })
    const answer = await putDraft(
      apiBase,
      tenant,
      draft.id,
      { kind, started_from: draft.started_from, document },
      fetchFn,
    )
    if (!answer.ok) {
      setSaved({ status: "failed", message: answer.message })
      return
    }
    setSaved({ status: "saved", at: answer.draft.updated_at })
    queryClient.setQueryData(["draft", apiBase, tenant, draft.id], {
      kind: "ok",
      draft: answer.draft,
    })
    void queryClient.invalidateQueries({ queryKey: ["drafts"] })
  }
  const remove = async () => {
    if (await deleteDraft(apiBase, tenant, draft.id, fetchFn)) {
      queryClient.removeQueries({ queryKey: ["draft", apiBase, tenant, draft.id] })
      await queryClient.invalidateQueries({ queryKey: ["drafts"] })
      await navigate("/authoring")
    } else {
      setSaved({ status: "failed", message: "The service did not remove the draft." })
    }
  }

  return (
    <div data-slot="content">
      <ul aria-label="Draft" data-slot="facts">
        <li>
          <span data-label="">kind</span> {KIND[kind]}
        </li>
        <li>
          <span data-label="">route</span> <code>{route ?? "none"}</code>
        </li>
        <li>
          <span data-label="">started from</span> {startedFromText(draft.started_from)}
        </li>
        <li>
          <span data-label="">saved</span> {formatInstant(draft.updated_at)}
        </li>
        {draft.published === undefined ? null : (
          <li>
            <span data-label="">published</span>{" "}
            <a href={draft.published.url} rel="noreferrer">
              {pullName(draft.published)}
            </a>
          </li>
        )}
      </ul>
      <p>
        <Link to="/authoring">All your drafts</Link>
      </p>
      <section aria-labelledby="draft-fields" data-slot="panel">
        <h2 id="draft-fields" data-slot="panel-header" data-label="">
          Fields
        </h2>
        <div data-slot="stack">
          <p data-slot="panel-note">
            The contract&rsquo;s {kind.replace("_", " ")} schema, field by field, in its order and
            with its words. An object or a list is edited as JSON.
          </p>
          {FIELDS[kind].map((field) => (
            <FieldInput
              key={field.name}
              field={field}
              text={texts[field.name] ?? fieldText(document, field)}
              problem={problems[field.name]}
              onChange={(text) => editField(field, text)}
            />
          ))}
        </div>
      </section>
      <section aria-labelledby="draft-json" data-slot="panel">
        <h2 id="draft-json" data-slot="panel-header" data-label="">
          JSON
        </h2>
        <div data-slot="stack">
          <div data-slot="field">
            <label htmlFor="draft-json-text" data-label="">
              Draft JSON
            </label>
            <textarea
              id="draft-json-text"
              data-slot="textarea"
              rows={16}
              spellCheck={false}
              value={json?.text ?? JSON.stringify(document, null, 2)}
              aria-invalid={json?.problem !== undefined}
              onChange={(event) => editJson(event.target.value)}
            />
          </div>
          {json?.problem === undefined ? null : (
            <p role="alert" data-slot="note">
              {json.problem}
            </p>
          )}
        </div>
      </section>
      <section aria-labelledby="draft-checked" data-slot="panel">
        <h2 id="draft-checked" data-slot="panel-header" data-label="">
          Checked and changed
        </h2>
        <div data-slot="stack">
          <Checked kind={kind} document={document} />
          <Changes start={start} document={document} />
        </div>
      </section>
      <div data-slot="chip-row">
        <button
          type="button"
          data-slot="inverse-button"
          aria-busy={saved.status === "saving"}
          onClick={() => {
            if (saved.status !== "saving") void save()
          }}
        >
          Save
        </button>
        {deleting ? (
          <>
            <button type="button" data-slot="ghost-button" onClick={() => void remove()}>
              Delete the draft for good
            </button>
            <button type="button" data-slot="ghost-button" onClick={() => setDeleting(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" data-slot="ghost-button" onClick={() => setDeleting(true)}>
            Delete
          </button>
        )}
      </div>
      {saved.status === "saved" ? (
        <p role="status" data-slot="cell-note">
          Saved at {formatInstant(saved.at)}.
        </p>
      ) : saved.status === "failed" ? (
        <p role="alert" data-slot="note">
          The draft was not saved: {saved.message}
        </p>
      ) : null}
      <PublishPanel
        apiBase={apiBase}
        draft={draft}
        dirty={JSON.stringify(document) !== JSON.stringify(draft.document)}
      />
      <ReplayPreview route={route} kind={kind} document={document} />
      <ShadowPreview apiBase={apiBase} kind={kind} document={document} />
    </div>
  )
}

function DraftEditor({ apiBase, id }: { readonly apiBase: string; readonly id: string }) {
  const query = useDraft(id)
  if (query.data === undefined) {
    return (
      <p role="status" data-slot="cell-note">
        Reading the draft…
      </p>
    )
  }
  if (query.data.kind === "not-found") {
    return (
      <section aria-label="No such draft" data-slot="missing-panel">
        <p>
          You have no draft <span data-mono="">{id}</span> in this tenant.
        </p>
        <p>
          <Link to="/authoring">All your drafts</Link>
        </p>
      </section>
    )
  }
  if (query.data.kind === "failed") {
    return (
      <p role="alert" data-slot="note">
        The draft could not be read: {query.data.message}
      </p>
    )
  }
  // Not keyed by when it was saved: a save keeps the editor, and what the author is working on.
  return <Editor apiBase={apiBase} draft={query.data.draft} />
}

export function AuthoringView() {
  const { apiBase } = useData()
  const me = useMe()
  const location = useLocation()
  const [search] = useSearchParams()
  const draftId = search.get("draft")
  if (apiBase === undefined) {
    return (
      <div data-slot="content">
        <section aria-label="Authoring" data-slot="note">
          <p>
            The service is not configured: <code>config.json</code> names no <code>apiBase</code>,
            so there is nowhere to keep a draft.
          </p>
        </section>
      </div>
    )
  }
  if (me.data === undefined) {
    return (
      <p role="status" data-slot="cell-note">
        Reading who is signed in…
      </p>
    )
  }
  if (me.data.kind !== "signed-in") {
    return (
      <div data-slot="content">
        <section aria-label="Sign in to draft" data-slot="missing-panel">
          {me.data.kind === "signed-out" ? (
            <>
              <p>Sign in to draft a route policy or a profile for a route you own.</p>
              <p>
                <a
                  data-slot="ghost-button"
                  href={loginHref(apiBase, location.pathname + location.search)}
                >
                  Sign in
                </a>
              </p>
            </>
          ) : (
            <p>
              This service has no sign-in, so there is no author to keep a draft for. A deployment
              turns it on with <code>OIDC_ISSUER</code> (<code>deploy/README.md</code>).
            </p>
          )}
        </section>
      </div>
    )
  }
  return draftId === null ? (
    <div data-slot="content">
      <section aria-labelledby="drafts-title" data-slot="panel">
        <h2 id="drafts-title" data-slot="panel-header" data-label="">
          Your drafts
        </h2>
        <div data-slot="stack">
          <Drafts />
        </div>
      </section>
      <StartDraft apiBase={apiBase} />
    </div>
  ) : (
    <DraftEditor key={draftId} apiBase={apiBase} id={draftId} />
  )
}
