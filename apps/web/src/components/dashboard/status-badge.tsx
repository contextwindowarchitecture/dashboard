// An event's outcome as a chip (STYLE.md 3, Outcomes): an assembly quietly, with its tokens; a
// refusal loudly, by its code; a rejection loudly, with its problem count.

import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"

import { formatCount, formatTokens } from "../../lib/format"
import { Badge } from "../ui/badge"

export interface StatusBadgeProps {
  readonly outcome: AssemblyEventV1["outcome"]
  readonly inputTokens?: number
  readonly refusedReason?: string
  readonly problemCount?: number
}

export function StatusBadge({
  outcome,
  inputTokens,
  refusedReason,
  problemCount,
}: StatusBadgeProps) {
  if (outcome === "assembled") {
    return (
      <Badge variant="outline" data-tone="ok">
        {inputTokens === undefined ? "assembled" : `assembled · ${formatTokens(inputTokens)}`}
      </Badge>
    )
  }
  if (outcome === "refused") {
    return (
      <Badge variant="outline" data-tone="bad">
        refused
        {refusedReason ? (
          <>
            {" "}
            · <span data-identifier="">{refusedReason}</span>
          </>
        ) : null}
      </Badge>
    )
  }
  const problems =
    problemCount === undefined
      ? ""
      : ` · ${formatCount(problemCount)} ${problemCount === 1 ? "problem" : "problems"}`
  return (
    <Badge variant="outline" data-tone="bad">
      {`rejected${problems}`}
    </Badge>
  )
}
