// A route policy (dashboard-plan.md 7.5): its flags, producers, slot rules (every field the schema
// defines, a dash where the policy sets none), facts, fitting order, tier upgrades and default
// overrides, the lock's digest, and the events that ran it, the drifted ones named.

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { ReactNode } from "react"
import { Link, useParams } from "react-router"

import { DashboardPage } from "../../../components/dashboard/dashboard-page"
import { DataRegion } from "../../../components/dashboard/data-region"
import { SlotBadge } from "../../../components/dashboard/slot-badge"
import { useIndex } from "../../../data/queries"
import { regionOf } from "../../../data/region"
import { formatCount } from "../../../lib/format"
import { registryModel, SLOT_RULE_FIELDS, type PolicyEntry } from "../model/registry"
import { ABSENT, DriftNote, Value } from "./registry-parts"

type Raw = Record<string, unknown>

function Facts({ entry }: { readonly entry: PolicyEntry }) {
  const policy = entry.policy as unknown as Raw
  const fact = (label: string, value: ReactNode) => (
    <li>
      <span data-label="">{label}</span> {value}
    </li>
  )
  return (
    <ul aria-label="Route policy facts" data-slot="facts">
      {fact("lock sha256", <code>{entry.sha256 ?? "not pinned"}</code>)}
      {(
        ["parser", "requires_evidence", "clock_skew_seconds", "on_unresolved_instruction"] as const
      ).map((flag) => (
        <li key={flag}>
          <span data-label="">{flag}</span>{" "}
          <code>
            <Value value={policy[flag]} />
          </code>
        </li>
      ))}
      {fact(
        "events",
        <code>
          {formatCount(entry.usage.events)} · {formatCount(entry.usage.pinned)} pinned ·{" "}
          {formatCount(entry.usage.drifted)} drifted
        </code>,
      )}
    </ul>
  )
}

function Section({
  id,
  title,
  children,
}: {
  readonly id: string
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <section aria-labelledby={id} data-slot="panel">
      <h2 id={id} data-slot="panel-header" data-label="">
        {title}
      </h2>
      <div role="region" aria-labelledby={id} tabIndex={0} data-slot="scroll-region">
        {children}
      </div>
    </section>
  )
}

function Producers({ policy }: { readonly policy: Raw }) {
  const producers = Object.entries((policy["producers"] ?? {}) as Record<string, Raw>)
  return (
    <Section id="policy-producers" title="Producers">
      <table aria-label="Producers" data-slot="chart-table" data-wide="">
        <thead>
          <tr>
            <th scope="col">producer</th>
            <th scope="col">kind</th>
            <th scope="col">slots</th>
            <th scope="col">verified</th>
          </tr>
        </thead>
        <tbody>
          {producers.map(([id, producer]) => (
            <tr key={id}>
              <th scope="row" data-mono="">
                {id}
              </th>
              <td data-mono="">{String(producer["kind"])}</td>
              <td>
                <ul data-slot="chip-row" aria-label={`${id}: slots`}>
                  {((producer["slots"] ?? []) as string[]).map((slot) => (
                    <li key={slot}>
                      <SlotBadge slot={slot} />
                    </li>
                  ))}
                </ul>
              </td>
              <td data-mono="">
                <Value value={producer["verified"]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

function SlotRules({ policy }: { readonly policy: Raw }) {
  const slots = Object.entries((policy["slots"] ?? {}) as Record<string, Raw>)
  return (
    <Section id="policy-slot-rules" title="Slot rules">
      {slots.length > 0 ? (
        <table aria-label="Slot rules" data-slot="chart-table" data-wide="">
          <thead>
            <tr>
              <th scope="col">slot</th>
              {SLOT_RULE_FIELDS.map((field) => (
                <th key={field} scope="col">
                  {field}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map(([slot, rules]) => (
              <tr key={slot}>
                <th scope="row" data-mono="">
                  {slot}
                </th>
                {SLOT_RULE_FIELDS.map((field) => (
                  <td key={field} data-mono="">
                    <Value value={rules[field]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p data-slot="cell-note">
          The policy sets no slot rules; every slot keeps the contract's defaults.
        </p>
      )}
    </Section>
  )
}

function FactPrecedence({ policy }: { readonly policy: Raw }) {
  const facts = Object.entries((policy["facts"] ?? {}) as Record<string, Raw>)
  if (facts.length === 0) return null
  return (
    <Section id="policy-facts" title="Facts">
      <table aria-label="Facts" data-slot="chart-table" data-wide="">
        <thead>
          <tr>
            <th scope="col">fact</th>
            <th scope="col">precedence</th>
            <th scope="col">scope</th>
            <th scope="col">freshness_tiebreak</th>
            <th scope="col">on_unresolved</th>
          </tr>
        </thead>
        <tbody>
          {facts.map(([key, fact]) => (
            <tr key={key}>
              <th scope="row" data-mono="">
                {key}
              </th>
              <td>
                <ol data-slot="chip-row" aria-label={`${key}: precedence`}>
                  {((fact["precedence"] ?? []) as string[]).map((producer) => (
                    <li key={producer} data-mono="">
                      {producer}
                    </li>
                  ))}
                </ol>
              </td>
              <td data-mono="">
                <Value value={fact["scope"]} />
              </td>
              <td data-mono="">
                <Value value={fact["freshness_tiebreak"]} />
              </td>
              <td data-mono="">
                <Value value={fact["on_unresolved"]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

function Fitting({ policy }: { readonly policy: Raw }) {
  const order = (policy["fitting_order"] ?? []) as { slot: string; action: string }[]
  const upgrades = Object.entries((policy["tier_upgrades"] ?? {}) as Record<string, string>)
  const overrides = Object.entries((policy["default_overrides"] ?? {}) as Record<string, Raw>)
  return (
    <section aria-labelledby="policy-fitting" data-slot="panel" data-padded="">
      <h2 id="policy-fitting" data-slot="panel-header" data-label="">
        Fitting and defaults
      </h2>
      <dl data-slot="key-values">
        <div>
          <dt>fitting_order</dt>
          <dd>
            {order.length > 0 ? (
              <ol aria-label="Fitting order">
                {order.map((step, i) => (
                  <li key={i} data-mono="">
                    {step.slot} · {step.action}
                  </li>
                ))}
              </ol>
            ) : (
              ABSENT
            )}
          </dd>
        </div>
        <div>
          <dt>tier_upgrades</dt>
          <dd data-mono="">
            {upgrades.length > 0
              ? upgrades.map(([slot, tier]) => `${slot} → ${tier}`).join(", ")
              : ABSENT}
          </dd>
        </div>
        <div>
          <dt>default_overrides</dt>
          <dd data-mono="">
            {overrides.length > 0
              ? overrides.map(([slot, fields]) => `${slot}: ${JSON.stringify(fields)}`).join("; ")
              : ABSENT}
          </dd>
        </div>
      </dl>
    </section>
  )
}

export function PolicyView() {
  const { route = "", version = "" } = useParams()
  const region = regionOf(useIndex(), { what: "The index" })
  const title = `${route} ${version}`
  return (
    <DashboardPage kicker="Route policy" title={title}>
      <DataRegion region={region} label={`route policy ${title}`}>
        {(index) => {
          const model = registryModel(REGISTRY, index.events)
          const entry = model.policies.find((p) => p.route === route && p.version === version)
          if (entry === undefined)
            return (
              <div data-slot="missing-panel">
                <p>Route policy {title} is not in the registry.</p>
                <p>
                  <Link to="/registry/policies">All route policies</Link>
                </p>
              </div>
            )
          const policy = entry.policy as unknown as Raw
          return (
            <div data-slot="content">
              <Facts entry={entry} />
              <DriftNote
                drift={model.drift.filter((d) => d.kind === "route_policy" && d.identity === title)}
              />
              <Producers policy={policy} />
              <SlotRules policy={policy} />
              <FactPrecedence policy={policy} />
              <Fitting policy={policy} />
              <p data-slot="panel-note">
                <Link to={`/traces?route=${encodeURIComponent(route)}`}>
                  Events on {route} in the stream
                </Link>{" "}
                · {formatCount(entry.usage.events)} of them on {version}
              </p>
            </div>
          )
        }}
      </DataRegion>
    </DashboardPage>
  )
}
