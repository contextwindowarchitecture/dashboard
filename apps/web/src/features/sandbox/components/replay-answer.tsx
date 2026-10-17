// A replay's answer in words (dashboard-plan.md 9): what the assembler decided, as an outcome chip,
// or why there is no decision. Shared by the sandbox and the authoring page's preview.

import { StatusBadge } from "../../../components/dashboard/status-badge"
import type { ReplayAnswer } from "../api/replay"

type Replayed = Extract<ReplayAnswer, { kind: "replayed" }>

export function Outcome({ answer }: { readonly answer: Replayed }) {
  const trace = answer.trace as {
    result?: { input_tokens: number } | null
    refused: { reason: string | null }
  }
  return (
    <StatusBadge
      outcome={answer.outcome}
      {...(trace.result ? { inputTokens: trace.result.input_tokens } : {})}
      {...(trace.refused.reason ? { refusedReason: trace.refused.reason } : {})}
    />
  )
}

const FAILURE: Record<"rejected" | "unsupported" | "invalid-response", string> = {
  rejected: "The snapshot was rejected before assembly:",
  unsupported: "The assembler does not provide a tokenizer or renderer the snapshot names (R-16):",
  "invalid-response": "The service's answer is not a replay:",
}

/** Any answer that is not a replay, in words. */
export function Failure({ answer }: { readonly answer: Exclude<ReplayAnswer, Replayed> }) {
  switch (answer.kind) {
    case "rejected":
    case "unsupported":
    case "invalid-response":
      return (
        <div data-slot="note">
          <p>{FAILURE[answer.kind]}</p>
          <ul>
            {answer.problems.map((problem) => (
              <li key={problem}>
                <code>{problem}</code>
              </li>
            ))}
          </ul>
        </div>
      )
    default:
      return (
        <div data-slot="note">
          <p>{answer.message}</p>
        </div>
      )
  }
}
