// A session's outcomes as a strip (dashboard-plan.md 8, Outcome strip; STYLE.md 3, Outcomes): one
// mark per turn in turn order, an assembly in ink, a refusal and a rejection in the accent, the
// rejection hollow. The strip is decoration; the counts beside it say the same in words.

import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"

import { formatCount } from "../../lib/format"

type Outcome = EventsIndexV1["events"][number]["outcome"]

const MARK = 8
const GAP = 2

export function OutcomeStrip({
  outcomes,
  counts,
}: {
  readonly outcomes: readonly Outcome[]
  readonly counts: Readonly<Record<Outcome, number>>
}) {
  const words = (["assembled", "refused", "rejected"] as const)
    .filter((outcome) => counts[outcome] > 0)
    .map((outcome) => `${formatCount(counts[outcome])} ${outcome}`)
    .join(" · ")
  return (
    <span data-slot="outcome-strip">
      <svg
        aria-hidden="true"
        width={outcomes.length * (MARK + GAP)}
        height={MARK + 2}
        viewBox={`0 0 ${outcomes.length * (MARK + GAP)} ${MARK + 2}`}
      >
        {outcomes.map((outcome, i) => (
          <rect
            key={i}
            data-outcome={outcome}
            x={i * (MARK + GAP) + 0.5}
            y={1.5}
            width={MARK - 1}
            height={MARK - 1}
          />
        ))}
      </svg>
      <span>{words}</span>
    </span>
  )
}
