// The glossary's anchors (dashboard-plan.md 7.9): one per reason code, requirement, slot, plane and
// authority value, so a chip anywhere can link to what the contract says about it.

export type GlossaryKind = "reason" | "rule" | "slot" | "plane" | "authority"

/** The element id of an entry: "reason-expired", "rule-R-9", "slot-evidence.knowledge". */
export const glossaryId = (kind: GlossaryKind, value: string) => `${kind}-${value}`

export const glossaryHref = (kind: GlossaryKind, value: string) =>
  `/glossary#${encodeURIComponent(glossaryId(kind, value))}`
