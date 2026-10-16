// A session (dashboard-plan.md 7.4): its facts, the turn timeline with every turn in a table
// beneath, and the selected turn's detail, read from its event. The turn is in the URL; with none,
// or one the session does not have, the last turn is shown.

import type { AssemblyEventV1, SessionV1 } from "@cwa-dashboard/telemetry/types"
import { lazy, Suspense, useRef, type ReactNode } from "react"
import { Link, useParams, useSearchParams } from "react-router"

import { TurnTimeline } from "../../../components/charts/turn-timeline"
import { DashboardPage } from "../../../components/dashboard/dashboard-page"
import { DataRegion } from "../../../components/dashboard/data-region"
import { ReasonChip } from "../../../components/dashboard/reason-chip"
import { StatusBadge } from "../../../components/dashboard/status-badge"
import { useEvent, useSession } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import { formatCount, NOT_AVAILABLE } from "../../../lib/format"
import { selectedTurn, sessionModel, type SessionModel, type Turn } from "../model/session"
import { SessionPlayer } from "./session-player"
import { usePlayer } from "./use-player"

const SessionPlayerMotion = lazy(() => import("./session-player-motion"))

const PLANES = ["gov", "state", "evid", "inter"] as const
const count = (value: number | undefined) =>
  value === undefined ? NOT_AVAILABLE : formatCount(value)

function Facts({
  session,
  model,
}: {
  readonly session: { route: string; service: string; profile: { id: string; version: number } }
  readonly model: SessionModel
}) {
  const fact = (label: string, value: ReactNode) => (
    <li>
      <span data-label="">{label}</span> {value}
    </li>
  )
  const reuse = model.reuse
  return (
    <ul aria-label="Session facts" data-slot="facts">
      {fact("route", <code>{session.route}</code>)}
      {fact("service", <code>{session.service}</code>)}
      {fact("profile", <code>{`${session.profile.id} v${session.profile.version}`}</code>)}
      {fact("turns", <code>{formatCount(model.turns.length)}</code>)}
      {fact(
        "part reuse",
        reuse ? (
          <code>
            {formatCount(reuse.reusedParts)} of {formatCount(reuse.parts)} parts ·{" "}
            {formatCount(reuse.comparedTurns)} turns compared
          </code>
        ) : (
          NOT_AVAILABLE
        ),
      )}
    </ul>
  )
}

function TurnTable({
  model,
  selected,
}: {
  readonly model: SessionModel
  readonly selected: number | undefined
}) {
  return (
    <div role="region" aria-label="Turns table" tabIndex={0} data-slot="scroll-region">
      <table aria-label="Turns" data-slot="chart-table" data-wide="">
        <thead>
          <tr>
            <th scope="col">Turn</th>
            <th scope="col">Outcome</th>
            <th scope="col" data-numeric="">
              Tokens
            </th>
            <th scope="col" data-numeric="">
              Budget
            </th>
            {PLANES.map((plane) => (
              <th key={plane} scope="col" data-numeric="">
                {plane}
              </th>
            ))}
            <th scope="col" data-numeric="">
              Overhead
            </th>
            <th scope="col" data-numeric="">
              Compressed
            </th>
            <th scope="col" data-numeric="">
              over_budget
            </th>
            <th scope="col" data-numeric="">
              Parts reused
            </th>
          </tr>
        </thead>
        <tbody>
          {model.turns.map((turn) => (
            <tr key={turn.turn} data-selected={turn.turn === selected ? "" : undefined}>
              <th scope="row">
                <Link
                  to={`?turn=${turn.turn}`}
                  replace
                  aria-label={`Turn ${turn.turn}`}
                  aria-current={turn.turn === selected ? "true" : undefined}
                >
                  {turn.turn}
                </Link>
              </th>
              <td>
                <StatusBadge
                  outcome={turn.outcome}
                  {...(turn.refusedReason ? { refusedReason: turn.refusedReason } : {})}
                />
              </td>
              <td data-numeric="">{count(turn.inputTokens)}</td>
              <td data-numeric="">{count(turn.budget)}</td>
              {PLANES.map((plane) => (
                <td key={plane} data-numeric="">
                  {count(turn.byPlane?.[plane])}
                </td>
              ))}
              <td data-numeric="">{count(turn.overhead)}</td>
              <td data-numeric="">{count(turn.compressed)}</td>
              <td data-numeric="">{count(turn.overBudget)}</td>
              <td data-numeric="">
                {turn.reusedParts === undefined
                  ? NOT_AVAILABLE
                  : `${formatCount(turn.reusedParts)} of ${formatCount(turn.parts)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TurnEvent({ event }: { readonly event: AssemblyEventV1 }) {
  const trace = event.trace
  if (trace === undefined) {
    return <p>The snapshot failed its checks before assembly, so this turn has no trace.</p>
  }
  const omitted = trace.excluded.filter((row) => row.reason === "over_budget")
  return (
    <>
      {trace.refused.reason ? (
        <p>
          Refused: <ReasonChip code={trace.refused.reason} />
        </p>
      ) : null}
      <h3 data-label="">Compressed</h3>
      {trace.compressed.length > 0 ? (
        <ul data-slot="item-list" aria-label="Compressed items">
          {trace.compressed.map((row) => (
            <li key={row.item_id}>
              <code>{row.item_id}</code>{" "}
              <span data-slot="cell-note">
                {formatCount(row.from)} → {formatCount(row.to)} · {row.method}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p data-slot="cell-note">Nothing was compressed.</p>
      )}
      <h3 data-label="">over_budget</h3>
      {omitted.length > 0 ? (
        <ul data-slot="item-list" aria-label="Items omitted over budget">
          {omitted.map((row) => (
            <li key={row.item_id}>
              <code data-excluded="">{row.item_id}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p data-slot="cell-note">Nothing was omitted over budget.</p>
      )}
      <p data-slot="cell-note">
        {formatCount(trace.conflicts.length)}{" "}
        {trace.conflicts.length === 1 ? "conflict" : "conflicts"} resolved
      </p>
    </>
  )
}

function TurnDetail({ turn }: { readonly turn: Turn }) {
  const region = regionOf(useEvent(turn.eventId), { what: `Event ${turn.eventId}` })
  return (
    <section aria-label={`Turn ${turn.turn}`} data-slot="panel" data-padded="">
      <h2 data-slot="panel-header" data-label="">
        Turn {turn.turn}
      </h2>
      <StatusBadge
        outcome={turn.outcome}
        {...(turn.inputTokens === undefined ? {} : { inputTokens: turn.inputTokens })}
        {...(turn.refusedReason ? { refusedReason: turn.refusedReason } : {})}
      />
      {turn.byPlane ? (
        <dl data-slot="key-values">
          {PLANES.map((plane) => (
            <div key={plane}>
              <dt>{plane}</dt>
              <dd>{formatCount(turn.byPlane![plane])}</dd>
            </div>
          ))}
          <div>
            <dt>overhead</dt>
            <dd>{count(turn.overhead)}</dd>
          </div>
        </dl>
      ) : null}
      <DataRegion region={region} label={`event ${turn.eventId}`}>
        {(event) => <TurnEvent event={event} />}
      </DataRegion>
      <p>
        <Link to={`/traces/${turn.eventId}`}>Open in the inspector</Link>
      </p>
    </section>
  )
}

function SessionBody({
  session,
  model,
  turn,
  go,
}: {
  readonly session: SessionV1
  readonly model: SessionModel
  readonly turn: Turn
  readonly go: (turn: number) => void
}) {
  const player = usePlayer(model, turn, go)
  const scope = useRef<HTMLDivElement>(null)
  return (
    <div data-slot="content">
      <Facts session={session} model={model} />
      <div data-slot="session-layout">
        <div data-slot="panel" data-padded="" ref={scope}>
          <SessionPlayer player={player} turn={turn} />
          <TurnTimeline
            model={model}
            selected={turn.turn}
            reached={player.played ? turn.turn : undefined}
          />
          {player.played ? (
            <Suspense fallback={null}>
              <SessionPlayerMotion
                scope={scope}
                turn={turn.turn}
                playing={player.playing}
                speed={player.speed}
                onAdvance={player.advance}
              />
            </Suspense>
          ) : null}
          <TurnTable model={model} selected={turn.turn} />
        </div>
        <TurnDetail turn={turn} />
      </div>
    </div>
  )
}

export function SessionView() {
  const { sessionId = "" } = useParams()
  const [search, setSearch] = useSearchParams()
  const go = (turn: number) => setSearch({ turn: String(turn) }, { replace: true })
  const region = regionOf(useSession(sessionId), { what: `Session ${sessionId}` })
  const kicker =
    region.status === "ok"
      ? ["Session", region.data.service, region.data.route].join(" · ")
      : "Session"
  return (
    <DashboardPage kicker={kicker} title={sessionId}>
      <DataRegion region={region} label={`session ${sessionId}`}>
        {(session) => {
          const model = sessionModel(session)
          const turn = selectedTurn(model, search.get("turn"))
          // The schema gives every session a turn; the player's state belongs to one session.
          return turn ? (
            <SessionBody
              key={session.session_id}
              session={session}
              model={model}
              turn={turn}
              go={go}
            />
          ) : null
        }}
      </DataRegion>
    </DashboardPage>
  )
}
