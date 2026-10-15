import { describe, expect, it } from "vitest"

import { sourceFiles } from "../test/source-files"

// AGENTS.md, "Never invent vocabulary": the prototype that preceded this repository used codes,
// rule numbers and field names the published contract does not have (dashboard-plan.md 2.3). The
// contract's own words replace them; none of these may appear in the app's source.
const PROTOTYPE = [
  "AUTHORITY_ELEVATION_BLOCKED",
  "CAPABILITY_NOT_GRANTED",
  "ITEM_EXPIRED",
  "CONFLICT_LOST_PRECEDENCE",
  "SUPERSEDED_BY_NEWER_VERSION",
  "BELOW_RELEVANCE_THRESHOLD",
  "SCOPE_MISMATCH",
  "SOURCE_CAP_EXCEEDED",
  "BUDGET_SHED_DROPPABLE",
  "REQUIRED_SLOT_EMPTY_AFTER_ADMISSION",
  "REQUIRED_SLOT_MISSING",
  "PROTECTED_BUDGET_OVERFLOW",
  "EVIDENCE_DID_NOT_FIT_BUDGET",
  "required_slots",
  "slot_floors",
  "source_caps",
  "facts_precedence",
  "capability_grants",
  "tokens_original",
  "tokens_admitted",
  "budget_shedding",
  "conflict_resolution",
  "R-25 digested",
  "Digested Candidate Envelope",
]

describe("the app's source speaks the contract", () => {
  it("names none of the prototype's invented codes, rules or fields", () => {
    for (const { name, text } of sourceFiles()) {
      for (const word of PROTOTYPE) expect(text.includes(word), `${name}: ${word}`).toBe(false)
    }
  })
})
