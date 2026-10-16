// The stage walk's steps (dashboard-plan.md 7.3; STYLE.md 7, Choreographies): the trace's excluded
// rows stage by stage, in the order conformance/README.md fixes, and, for a refusal, the refusal last.
// Built from the trace and nothing else.

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"

import { excludedByStage, type StageGroup } from "./inspector"

export type Step =
  | { readonly kind: "stage"; readonly stage: StageGroup["stage"] }
  | { readonly kind: "refusal"; readonly stage: "refusal"; readonly code: string }

export function stageTimeline(event: AssemblyEventV1): Step[] {
  const steps: Step[] = excludedByStage(event).map((group) => ({
    kind: "stage",
    stage: group.stage,
  }))
  const refused = event.trace?.refused
  if (refused?.bool && refused.reason)
    steps.push({ kind: "refusal", stage: "refusal", code: refused.reason })
  return steps
}
