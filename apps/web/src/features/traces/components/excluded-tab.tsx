// The Excluded tab (dashboard-plan.md 7.3): every excluded row, by pipeline stage in the order
// conformance/README.md fixes, each with its code, the contract's words for it, and the item kept
// in its place where there is one. The stage walk (STYLE.md 7, Walk the trace) shows the stages one
// at a time, the current one in the URL, and ends a refused trace on its refusal; with no stage in
// the URL every stage is shown, so the page is complete without it. Its motion, and the clock that
// plays it, load only when a walk starts.

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import { lazy, Suspense, useRef, useState, type KeyboardEvent } from "react"
import { Link, useSearchParams } from "react-router"

import { ReasonChip } from "../../../components/dashboard/reason-chip"
import { SlotBadge } from "../../../components/dashboard/slot-badge"
import { reasonInfo } from "../../../lib/reasons"
import { excludedByStage, type ExcludedRow, type StageGroup } from "../model/inspector"
import { stageTimeline, type Step } from "../model/stage-timeline"

const StageWalkMotion = lazy(() => import("./stage-walk-motion"))

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

function useWalk(event: AssemblyEventV1) {
  const [search, setSearch] = useSearchParams()
  const steps = stageTimeline(event)
  const at = steps.findIndex((step) => step.stage === search.get("stage"))
  const go = (to: number | null) =>
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (to === null) next.delete("stage")
        else next.set("stage", steps[to]!.stage)
        return next
      },
      { replace: true },
    )
  const [playing, setPlaying] = useState(false)
  return { steps, at, go, playing, setPlaying }
}

function walkStatus(steps: readonly Step[], at: number, stages: number) {
  const step = steps[at]
  if (step === undefined) return "All stages shown"
  if (step.kind === "refusal") return `Refused: ${step.code}`
  return `Stage ${at + 1} of ${stages}: ${STAGE_TITLES[step.stage]}`
}

function WalkControls({
  walk,
  stages,
}: {
  readonly walk: ReturnType<typeof useWalk>
  readonly stages: number
}) {
  const { steps, at, go, playing, setPlaying } = walk
  const canBack = at > 0
  const canForward = at < steps.length - 1
  const step = (to: number) => {
    setPlaying(false)
    go(to)
  }
  const back = () => canBack && step(at - 1)
  const forward = () => canForward && step(at + 1)
  const play = () => {
    if (!canForward || at < 0) go(0)
    setPlaying(true)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") back()
    else if (e.key === "ArrowRight") forward()
    else if (e.key === " ") {
      if (playing) setPlaying(false)
      else play()
    } else return
    e.preventDefault()
  }
  return (
    <div role="group" aria-label="Stage walk" data-slot="walk-controls" onKeyDown={onKeyDown}>
      <button type="button" data-slot="ghost-button" aria-pressed={playing} onClick={play}>
        Play
      </button>
      <button
        type="button"
        data-slot="ghost-button"
        aria-pressed={!playing}
        onClick={() => setPlaying(false)}
      >
        Pause
      </button>
      <button type="button" data-slot="ghost-button" aria-disabled={!canBack} onClick={back}>
        Step back
      </button>
      <button type="button" data-slot="ghost-button" aria-disabled={!canForward} onClick={forward}>
        Step forward
      </button>
      <button
        type="button"
        data-slot="ghost-button"
        aria-disabled={at < 0}
        onClick={() => {
          setPlaying(false)
          if (at >= 0) go(null)
        }}
      >
        Show all
      </button>
      <p role="status" data-slot="walk-status">
        {walkStatus(steps, at, stages)}
      </p>
    </div>
  )
}

export function ExcludedTab({ event }: { readonly event: AssemblyEventV1 }) {
  const groups = excludedByStage(event)
  const walk = useWalk(event)
  const scope = useRef<HTMLDivElement>(null)
  if (groups.length === 0) return <p data-slot="cell-note">Nothing was excluded.</p>
  // Steps and groups share their order: the walk's step i is group i, then the refusal, if any.
  const { steps, at, go, playing, setPlaying } = walk
  const advance = () => {
    if (at < steps.length - 1) go(at + 1)
    else setPlaying(false)
  }
  const shown = at < 0 ? groups : groups.slice(0, at + 1)
  const step = steps[at]
  return (
    <div data-slot="stage-groups" ref={scope}>
      <WalkControls walk={walk} stages={groups.length} />
      {step ? (
        <Suspense fallback={null}>
          <StageWalkMotion scope={scope} stage={step.stage} playing={playing} onAdvance={advance} />
        </Suspense>
      ) : null}
      {shown.map((group, i) => (
        <section
          key={group.stage}
          aria-labelledby={`stage-${group.stage}`}
          data-current={i === at ? "" : undefined}
        >
          <h3
            id={`stage-${group.stage}`}
            data-label=""
            aria-current={i === at ? "step" : undefined}
          >
            {STAGE_TITLES[group.stage]}
          </h3>
          <ol data-slot="item-list">
            {group.rows.map((row, j) => (
              <Row key={`${row.item_id}-${j}`} row={row} eventId={event.event_id} />
            ))}
          </ol>
        </section>
      ))}
      {step?.kind === "refusal" ? (
        <section aria-label="Refusal" data-slot="note" data-current="">
          <ReasonChip code={step.code} />
          {reasonInfo(step.code) ? (
            <p data-slot="reason-text">{reasonInfo(step.code)!.text}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
