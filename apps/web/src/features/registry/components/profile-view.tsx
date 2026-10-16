// A profile (dashboard-plan.md 7.5): its placement in order with each slot's wrap, its evaluation
// and whether it could be promoted (R-19, stated, never hidden), the route policy it binds (R-20),
// the lock's digest, the events that ran it, and the part reuse measured over the sessions that ran
// it, with how many.

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import type { ReactNode } from "react"
import { Link, useParams } from "react-router"

import { DashboardPage } from "../../../components/dashboard/dashboard-page"
import { DataRegion } from "../../../components/dashboard/data-region"
import { SlotBadge } from "../../../components/dashboard/slot-badge"
import { useIndex, useSessions } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import { formatCount, NOT_AVAILABLE } from "../../../lib/format"
import { policyPath } from "../model/paths"
import { profileReuse, promotable, registryModel, type ProfileEntry } from "../model/registry"
import { DriftNote, Value } from "./registry-parts"

type Row = EventsIndexV1["events"][number]

function PartReuse({
  entry,
  rows,
}: {
  readonly entry: ProfileEntry
  readonly rows: readonly Row[]
}) {
  const ids = [
    ...new Set(
      rows.flatMap((row) =>
        row.session && row.profile?.id === entry.id && row.profile.version === entry.version
          ? [row.session.id]
          : [],
      ),
    ),
  ].sort()
  const queries = useSessions(ids)
  if (ids.length === 0) return <>{NOT_AVAILABLE} · no session ran it</>
  if (queries.some((q) => q.isPending)) return <span data-slot="cell-note">loading</span>
  const sessions = queries.flatMap((q) => (q.data?.result.ok ? [q.data.result.document] : []))
  const reuse = profileReuse(sessions)
  if (reuse === undefined) return <>{NOT_AVAILABLE}</>
  return (
    <code>
      {formatCount(reuse.reusedParts)} of {formatCount(reuse.parts)} parts ·{" "}
      {formatCount(reuse.comparedTurns)} turns compared · {formatCount(reuse.sessions)}{" "}
      {reuse.sessions === 1 ? "session" : "sessions"}
    </code>
  )
}

function Facts({ entry, rows }: { readonly entry: ProfileEntry; readonly rows: readonly Row[] }) {
  const { profile } = entry
  const fact = (label: string, value: ReactNode) => (
    <li>
      <span data-label="">{label}</span> {value}
    </li>
  )
  return (
    <ul aria-label="Profile facts" data-slot="facts">
      {fact("lock sha256", <code>{entry.sha256 ?? "not pinned"}</code>)}
      {fact(
        "route policy",
        entry.binds ? (
          <Link to={policyPath(entry.binds.route, entry.binds.version)}>
            {entry.binds.route} {entry.binds.version}
          </Link>
        ) : (
          <code>
            {profile.route} {profile.route_policy_version} · not in the registry
          </code>
        ),
      )}
      {fact(
        "model_family",
        <code>
          <Value value={profile.model_family} />
        </code>,
      )}
      {fact(
        "events",
        <code>
          {formatCount(entry.usage.events)} · {formatCount(entry.usage.pinned)} pinned ·{" "}
          {formatCount(entry.usage.drifted)} drifted
        </code>,
      )}
      {fact("part reuse", <PartReuse entry={entry} rows={rows} />)}
    </ul>
  )
}

function Evaluation({ entry }: { readonly entry: ProfileEntry }) {
  const evaluation = (entry.profile.evaluation ?? {}) as Record<string, unknown>
  const fields = ["status", "suite", "date", "result", "artifact"] as const
  return (
    <section
      aria-label="Evaluation"
      data-slot={promotable(entry.profile) ? "panel" : "note"}
      data-padded=""
    >
      <dl data-slot="key-values">
        {fields.map((field) => (
          <div key={field}>
            <dt>{field}</dt>
            <dd data-mono="">
              <Value value={evaluation[field]} />
            </dd>
          </div>
        ))}
      </dl>
      <p>
        {promotable(entry.profile)
          ? "Evaluated with a model family, suite, date, result and artifact: promotable (R-19)."
          : "Not promotable for a deployment (R-19): promotion needs a concrete model family and an evaluated status with a suite, date, result and reproducible artifact."}
      </p>
    </section>
  )
}

export function ProfileView() {
  const { id = "", version = "" } = useParams()
  const region = regionOf(useIndex(), { what: "The index" })
  const title = `${id} v${version}`
  return (
    <DashboardPage kicker="Profile" title={title}>
      <DataRegion region={region} label={`profile ${title}`}>
        {(index) => {
          const model = registryModel(REGISTRY, index.events)
          const entry = model.profiles.find((p) => p.id === id && String(p.version) === version)
          if (entry === undefined)
            return (
              <div data-slot="missing-panel">
                <p>Profile {title} is not in the registry.</p>
                <p>
                  <Link to="/registry/profiles">All profiles</Link>
                </p>
              </div>
            )
          return (
            <div data-slot="content">
              <Facts entry={entry} rows={index.events} />
              <DriftNote
                drift={model.drift.filter((d) => d.kind === "profile" && d.identity === title)}
              />
              <section aria-labelledby="profile-placement" data-slot="panel" data-padded="">
                <h2 id="profile-placement" data-slot="panel-header" data-label="">
                  Placement
                </h2>
                <ol aria-label="Placement" data-slot="placement-list">
                  {entry.profile.placement.map((placement, i) => (
                    <li key={i}>
                      <SlotBadge slot={placement.slot} />
                      <code>{placement.wrap}</code>
                    </li>
                  ))}
                </ol>
              </section>
              <Evaluation entry={entry} />
            </div>
          )
        }}
      </DataRegion>
    </DashboardPage>
  )
}
