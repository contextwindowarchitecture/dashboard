// The trace inspector (dashboard-plan.md 7.3): one event's outcome, its facts, and its trace joined
// to its snapshot, tab by tab. The tab lives in the URL.

import { REASONS } from "@cwa-dashboard/contract/data"
import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"
import type { ReactNode } from "react"
import { useParams, useSearchParams } from "react-router"

import { DashboardPage } from "../../../components/dashboard/dashboard-page"
import { DataRegion } from "../../../components/dashboard/data-region"
import { LanguageMark } from "../../../components/dashboard/language-mark"
import { StatusBadge } from "../../../components/dashboard/status-badge"
import { Badge } from "../../../components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs"
import { useEvent } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import { formatCount, formatInstant, formatMs } from "../../../lib/format"
import { ItemsTab } from "./items-tab"

const TABS = [
  { id: "items", label: "Items", needsTrace: true },
  { id: "context", label: "Context", needsTrace: true },
  { id: "raw", label: "Raw", needsTrace: false },
] as const
type TabId = (typeof TABS)[number]["id"]

function OutcomeBanner({ event }: { readonly event: AssemblyEventV1 }) {
  const { trace } = event
  if (event.outcome === "assembled" && trace?.result && event.payload) {
    return (
      <section aria-label="Outcome" data-slot="emphasis-panel">
        <StatusBadge outcome="assembled" inputTokens={trace.result.input_tokens} />
        <p data-slot="banner-detail">
          payload <code>{event.payload.hash}</code> · {formatCount(event.payload.bytes)} bytes
        </p>
      </section>
    )
  }
  if (event.outcome === "refused" && trace?.refused.reason) {
    const reason = REASONS.find((r) => r.code === trace.refused.reason)
    return (
      <section aria-label="Outcome" data-slot="note">
        <StatusBadge outcome="refused" refusedReason={trace.refused.reason} />
        <p>
          {reason ? (
            <>
              <span data-slot="rule">{reason.rule}</span> {reason.text}
            </>
          ) : (
            "This refusal code is not in the contract."
          )}
        </p>
        {trace.recovery ? (
          <p>
            Recovery: <code>{trace.recovery.action}</code>
            {trace.recovery.detail ? ` · ${trace.recovery.detail}` : null}
          </p>
        ) : null}
      </section>
    )
  }
  const problems = event.rejection?.problems ?? []
  return (
    <section aria-label="Outcome" data-slot="note">
      <StatusBadge outcome="rejected" problemCount={problems.length} />
      <p>The snapshot failed its checks before assembly, so there is no trace and no payload.</p>
      <ul>
        {problems.map((problem) => (
          <li key={problem}>
            <code>{problem}</code>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Facts({ event }: { readonly event: AssemblyEventV1 }) {
  const { snapshot, trace } = event
  const fact = (label: string, value: ReactNode) => (
    <li>
      <span data-label="">{label}</span> {value}
    </li>
  )
  return (
    <ul aria-label="Event facts" data-slot="facts">
      {snapshot
        ? fact(
            "route",
            <code>
              {snapshot.route_policy.route} · {snapshot.route_policy.version}
            </code>,
          )
        : null}
      {snapshot
        ? fact("profile", <code>{`${snapshot.profile.id} v${snapshot.profile.version}`}</code>)
        : null}
      {snapshot ? fact("tokenizer", <code>{snapshot.tokenizer}</code>) : null}
      {snapshot ? fact("renderer", <code>{snapshot.renderer}</code>) : null}
      {fact(
        "assembler",
        <>
          <LanguageMark language={event.assembler.language} />{" "}
          <code>{event.assembler.version}</code>
        </>,
      )}
      {fact(
        "service",
        <code>
          {event.service.environment
            ? `${event.service.name} · ${event.service.environment}`
            : event.service.name}
        </code>,
      )}
      {fact(
        "redaction",
        <Badge variant="outline" data-tone="quiet" data-identifier="">
          {event.redaction_mode}
        </Badge>,
      )}
      {trace ? fact("snapshot digest", <code>{trace.context.snapshot_digest}</code>) : null}
      {fact("contract", <code>{event.contract.commit.slice(0, 7)}</code>)}
      {fact("recorded", <code>{formatInstant(event.recorded_at)}</code>)}
    </ul>
  )
}

function ContextTab({ event }: { readonly event: AssemblyEventV1 }) {
  const trace = event.trace!
  const rows: [string, ReactNode][] = [
    ["assembly time", trace.context.assembly_time],
    ["spec", trace.context.spec],
    ["route policy", trace.context.route_policy_version],
    ["tokenizer", trace.context.tokenizer],
    ["renderer", trace.context.renderer],
    ["snapshot digest", trace.context.snapshot_digest],
    ["trace id", trace.trace_id],
    ["defaults filled", `${formatCount(trace.defaults_filled.length)} fields`],
    ["wrapper time", formatMs(event.timings_ms.total)],
    ...Object.entries((trace as { timings?: Record<string, number> }).timings ?? {}).map(
      ([stage, ms]) => [`${stage} (assembler)`, formatMs(ms)] as [string, ReactNode],
    ),
  ]
  const grant = event.snapshot?.capabilities
  if (grant)
    rows.push([
      "capabilities",
      `${grant.policy_producer} · ${grant.allow_list_version} · ${grant.allowed_ids.join(", ")}`,
    ])
  return (
    <div data-slot="panel">
      <dl data-slot="key-values">
        {rows.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p data-slot="panel-note">
        Timings are measurements: the wrapper's around the whole call, and the assembler's own by
        stage. They are not deterministic and stay outside the payload hash (R-23).
      </p>
    </div>
  )
}

function RawTab({ event }: { readonly event: AssemblyEventV1 }) {
  const snapshot = event.snapshot ?? event.rejection?.snapshot
  return (
    <div data-slot="raw">
      <section aria-label="Snapshot JSON" data-slot="panel">
        <h2 data-label="">{event.snapshot ? "Snapshot" : "Submitted snapshot"}</h2>
        <pre tabIndex={0} aria-label="Snapshot JSON">
          {JSON.stringify(snapshot, null, 2)}
        </pre>
      </section>
      {event.trace ? (
        <section aria-label="Trace JSON" data-slot="panel">
          <h2 data-label="">Trace</h2>
          <pre tabIndex={0} aria-label="Trace JSON">
            {JSON.stringify(event.trace, null, 2)}
          </pre>
        </section>
      ) : null}
    </div>
  )
}

function EventView({ event }: { readonly event: AssemblyEventV1 }) {
  const [search, setSearch] = useSearchParams()
  const available = TABS.filter((tab) => !tab.needsTrace || event.trace !== undefined)
  const requested = search.get("tab")
  const tab: TabId = available.find((t) => t.id === requested)?.id ?? available[0]!.id
  return (
    <div data-slot="content">
      <OutcomeBanner event={event} />
      <Facts event={event} />
      <Tabs
        value={tab}
        onValueChange={(value) => setSearch(value === available[0]!.id ? {} : { tab: value })}
      >
        <TabsList>
          {available.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {event.trace ? (
          <>
            <TabsContent value="items">
              <ItemsTab event={event} />
            </TabsContent>
            <TabsContent value="context">
              <ContextTab event={event} />
            </TabsContent>
          </>
        ) : null}
        <TabsContent value="raw">
          <RawTab event={event} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function Inspector() {
  const { eventId = "" } = useParams()
  const region = regionOf(useEvent(eventId), { what: `Event ${eventId}` })
  const kicker =
    region.status === "ok"
      ? ["Trace", region.data.service.name, region.data.snapshot?.route_policy.route]
          .filter(Boolean)
          .join(" · ")
      : "Trace"
  return (
    <DashboardPage kicker={kicker} title={eventId}>
      <DataRegion region={region} label={`event ${eventId}`}>
        {(event) => <EventView event={event} />}
      </DataRegion>
    </DashboardPage>
  )
}
