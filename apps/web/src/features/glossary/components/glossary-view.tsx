// The glossary (dashboard-plan.md 7.9): every plane, slot, authority value, reason code and
// requirement, in the vendored contract's words, each under the anchor the chips link to. Generated
// from contract/model.json, slot-defaults.json, reasons.json, requirements.json and
// assembler-scope.json; nothing here is written by hand.

import {
  CONTRACT_SOURCE,
  MODEL,
  REASONS,
  REQUIREMENTS,
  SCOPE,
  SLOT_DEFAULTS,
} from "@cwa-dashboard/contract/data"
import type { ReactNode } from "react"
import { Link } from "react-router"

import { DashboardPage } from "../../../components/dashboard/dashboard-page"
import { glossaryHref, glossaryId, type GlossaryKind } from "../../../lib/glossary"

function Entry({
  kind,
  value,
  term,
  children,
}: {
  readonly kind: GlossaryKind
  readonly value: string
  readonly term: ReactNode
  readonly children: ReactNode
}) {
  return (
    <div id={glossaryId(kind, value)} data-slot="glossary-entry">
      <h3 data-slot="glossary-term">{term}</h3>
      {children}
    </div>
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
    <section aria-labelledby={id} data-slot="glossary-section">
      <h2 id={id} data-slot="section-title">
        {title}
      </h2>
      {children}
    </section>
  )
}

const planeOf = (short: string) => MODEL.planes.find((plane) => plane.id.startsWith(short))

export function GlossaryView() {
  return (
    <DashboardPage
      kicker="Reference"
      title="Glossary"
      lede={`The contract's own words for every plane, slot, authority value, reason code and requirement the dashboard shows, from the specification at ${CONTRACT_SOURCE.commit.slice(0, 7)}.`}
    >
      <div data-slot="content">
        <Section id="glossary-planes" title="Planes">
          {MODEL.planes.map((plane) => (
            <Entry key={plane.id} kind="plane" value={plane.id} term={plane.name}>
              <p>{plane.answers}</p>
            </Entry>
          ))}
        </Section>
        <Section id="glossary-slots" title="Slots">
          {MODEL.slots.map((slot) => {
            const defaults = SLOT_DEFAULTS[slot.id]
            const plane = planeOf(defaults.plane)
            return (
              <Entry key={slot.id} kind="slot" value={slot.id} term={<code>{slot.id}</code>}>
                <p>{slot.holds}</p>
                <p>{slot.rule}</p>
                {/* A list, so no link sits in running text (axe, link-in-text-block). */}
                <dl data-slot="key-values">
                  <div>
                    <dt>plane</dt>
                    <dd>
                      {plane ? (
                        <Link to={glossaryHref("plane", plane.id)}>{plane.name}</Link>
                      ) : (
                        defaults.plane
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>default authority</dt>
                    <dd>
                      <Link to={glossaryHref("authority", defaults.authority)}>
                        {defaults.authority}
                      </Link>
                    </dd>
                  </div>
                  <div>
                    <dt>default tier</dt>
                    <dd>{defaults.tier}</dd>
                  </div>
                </dl>
              </Entry>
            )
          })}
        </Section>
        <Section id="glossary-authority" title="Authority">
          {MODEL.authority.map((authority) => (
            <Entry
              key={authority.value}
              kind="authority"
              value={authority.value}
              term={<code>{authority.value}</code>}
            >
              <p>
                {authority.name}: {authority.text}
              </p>
            </Entry>
          ))}
        </Section>
        <Section id="glossary-reasons" title="Reason codes">
          {REASONS.map((reason) => (
            <Entry
              key={reason.code}
              kind="reason"
              value={reason.code}
              term={<code>{reason.code}</code>}
            >
              <p>{reason.text}</p>
              <dl data-slot="key-values">
                <div>
                  <dt>kind</dt>
                  <dd>{reason.kind}</dd>
                </div>
                <div>
                  <dt>rule</dt>
                  <dd>
                    <Link to={glossaryHref("rule", reason.rule)}>{reason.rule}</Link>
                  </dd>
                </div>
              </dl>
            </Entry>
          ))}
        </Section>
        <Section id="glossary-requirements" title="Requirements">
          {REQUIREMENTS.map((requirement) => {
            const scope = SCOPE.find((entry) => entry.id === requirement.id)
            return (
              <Entry
                key={requirement.id}
                kind="rule"
                value={requirement.id}
                term={
                  <>
                    <code>{requirement.id}</code> {requirement.summary}
                  </>
                }
              >
                <p>{requirement.text}</p>
                <p data-slot="cell-note">
                  {requirement.keyword}
                  {scope ? ` · ${scope.scope}: ${scope.note}` : ""}
                </p>
              </Entry>
            )
          })}
        </Section>
      </div>
    </DashboardPage>
  )
}
