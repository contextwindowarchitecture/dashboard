// The seven failure modes as guardrail monitors (dashboard-plan.md 7.6). Their names and stories are
// the CWA workshop's (W0, "Context engineering foundations", part 1: "What it looks like in
// production"); the website's home page numbers the same modes 01, 03 and 05. The codes each card
// counts and the requirements it cites are the contract's. A count is the number of events in the
// window whose trace records one of the codes, and each card says what that does not show: a
// monitor can find a decision the assembler recorded, never prove a failure did not happen.

import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"

export interface Guardrail {
  readonly number: string
  readonly name: string
  /** What the failure looks like in production, in the workshop's words. */
  readonly story: string
  /** The reason codes whose events the card counts; none when the index cannot show it. */
  readonly codes: readonly string[]
  /** The requirements that prevent it. */
  readonly requirements: readonly string[]
  /** What the count is. */
  readonly measure: string
  /** What the count does not show. */
  readonly caveat: string
}

const EVENTS = "Events in the window whose trace records one of these codes."

export const GUARDRAILS: readonly Guardrail[] = [
  {
    number: "01",
    name: "Authority inversion",
    story:
      "A retrieved document, a tool result or a pasted message changes the model's behaviour because it contains imperative text",
    codes: [
      "authority_not_allowed",
      "untrusted_in_governance",
      "tier_upgrade_not_allowed",
      "protected_tier_changed",
    ],
    requirements: ["R-1", "R-10", "R-16", "R-5"],
    measure: EVENTS,
    caveat:
      "Conflicts decided by authority are not counted here, and an instruction the renderer kept in its place leaves no row. Enforcing rule zero outside the model is the application's (R-5), so a count of 0 is no proof that nothing happened.",
  },
  {
    number: "02",
    name: "Instruction-shaped evidence",
    story: "Evidence that reads like an instruction is followed as one",
    codes: ["untrusted_content_unmarked"],
    requirements: ["R-10", "R-7", "R-5"],
    measure: EVENTS,
    caveat:
      "Marked untrusted content that was admitted and rendered as evidence is the contract working, not an exclusion, so it is not counted. What the model does with it is the application's to test (R-5).",
  },
  {
    number: "03",
    name: "Stale-as-current",
    story:
      "An old fact is presented with the same standing as a current one, and the model picks the wrong one",
    codes: ["expired", "stale_state", "not_eligible", "future_freshness", "superseded"],
    requirements: ["R-2", "R-3", "R-8", "R-9", "R-25"],
    measure: EVENTS,
    caveat:
      "expired counts every slot's expiries, memory's included. A fact a route has no age limit for is never stale to the assembler.",
  },
  {
    number: "04",
    name: "Memory that never expires",
    story:
      "A summary or inferred preference from months ago is still steering answers, and nothing can revoke it",
    codes: ["revoked", "source_invalid"],
    requirements: ["R-9", "R-14"],
    measure: EVENTS,
    caveat:
      "The index does not say which slot a code was in, so expired memory is counted under 03; the inspector shows the slot of each row.",
  },
  {
    number: "05",
    name: "Displacement under budget",
    story:
      "The important part of the prompt is pushed out, or truncated mid-thought, when the window fills",
    codes: ["over_budget", "slot_floor_over_budget", "protected_content_over_budget"],
    requirements: ["R-16", "R-17", "R-18"],
    measure: EVENTS,
    caveat:
      "Steps down to a summary are compressions, not omissions; the compression rate counts them.",
  },
  {
    number: "06",
    name: "Redundant re-reading",
    story: "The same text is sent again and again in a form that no cache can reuse",
    codes: [],
    requirements: ["R-7"],
    measure:
      "Measured per session from the payload parts each turn shares with the turn before, not counted from the index.",
    caveat:
      "Only renderers whose payload delimits its parts can be measured; under fixture-xml/v1 nothing can.",
  },
  {
    number: "07",
    name: "Missing trigger",
    story: "The model is not told what, in all that context, it is being asked to respond to",
    codes: ["required_slot_missing"],
    requirements: ["R-4"],
    measure: EVENTS,
    caveat:
      "Declaring parser: true on every route whose responses a parser reads is the application's (R-4).",
  },
]

type Row = EventsIndexV1["events"][number]

/** Each guardrail's count over the rows, by number; absent where the index cannot show it. */
export function guardrailCounts(rows: readonly Row[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const guardrail of GUARDRAILS) {
    if (guardrail.codes.length === 0) continue
    counts.set(
      guardrail.number,
      rows.filter((row) =>
        guardrail.codes.some(
          (code) => row.reason_codes.includes(code) || row.refused_reason === code,
        ),
      ).length,
    )
  }
  return counts
}
