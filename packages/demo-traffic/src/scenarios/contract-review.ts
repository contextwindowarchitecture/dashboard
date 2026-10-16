// One call on a contract-review route of the deployment's own, with a draft profile, as message
// blocks. The route keeps a floor of clause evidence (min_tokens) so a review is never written
// from a sliver of the contract; the budget left after the governing text cannot hold that floor,
// so the assembler refuses with slot_floor_over_budget instead of shedding below it (R-16, R-17).

import {
  batch,
  draftProfile,
  instruction,
  knowledge,
  query,
  type Scenario,
  snapshot,
} from "./build.ts"
import type { RoutePolicy } from "@cwa-dashboard/contract/types"

const route_policy = {
  route: "contract-review",
  version: "review/v2",
  producers: {
    "policy-registry": { kind: "policy", slots: ["governance.instructions"] },
    "clause-index": { kind: "retrieval", slots: ["evidence.knowledge"] },
    conversation: { kind: "interaction", slots: ["interaction.query"] },
  },
  slots: {
    "evidence.knowledge": { min_relevance: 0.4, required_scope: ["tenant"], min_tokens: 80 },
  },
} as unknown as RoutePolicy

const profile = draftProfile("contract-review", "contract-review", "review/v2", [
  { slot: "governance.instructions", wrap: "system" },
  { slot: "evidence.knowledge", wrap: "xml:clauses" },
  { slot: "interaction.query", wrap: "xml:query" },
])

const TENANT = "meridian-legal"
const clause = (n: number, body: string, relevance: number) =>
  knowledge(`msa-2026-114#c${n}`, body, relevance, {
    source: "msa-2026-114",
    source_version: "signed",
    freshness: "2026-08-30T00:00:00Z",
    extra: { scope: { tenant: TENANT } },
  })

export const contractReview: Scenario = {
  id: "contract-review",
  title:
    "A contract-review route keeps a floor of clause evidence; the budget cannot hold it, so the assembler refuses with slot_floor_over_budget rather than review from a sliver.",
  service: "contract-reviewer",
  redaction: { mode: "full" },
  turns: [
    {
      snapshot: snapshot({
        assembly_time: "2026-10-15T16:00:00Z",
        scope: { tenant: TENANT, task: "review_msa_2026_114" },
        budget: { input: 130, reserved_output: 2000 },
        profile,
        route_policy,
        tokenizer: "fixture-whitespace/v1",
        renderer: "cwa-message-blocks/v1",
        batches: [
          batch("policy-registry", "policy", [
            instruction(
              "policy:review-v2",
              "You review commercial contracts for Meridian Legal. Flag every clause that shifts liability, limits remedies or renews automatically, and quote it.",
              {
                source: "policy-registry",
                source_version: "review-v2",
                freshness: "2026-10-01T00:00:00Z",
              },
            ),
          ]),
          batch("clause-index", "retrieval", [
            clause(
              7,
              "Either party may terminate for convenience on ninety days written notice, provided that all fees for the then-current term remain payable in full.",
              0.92,
            ),
            clause(
              12,
              "Supplier's aggregate liability under this Agreement shall not exceed the fees paid in the twelve months preceding the claim, except for breach of confidentiality.",
              0.95,
            ),
            clause(
              18,
              "This Agreement renews automatically for successive one-year terms unless either party gives notice of non-renewal at least sixty days before the end of the term.",
              0.9,
            ),
            clause(
              21,
              "Customer shall indemnify Supplier against third-party claims arising from Customer Data, including claims caused by Supplier's processing of it.",
              0.88,
            ),
          ]),
          batch("conversation", "interaction", [
            query("review:114", "Review MSA 2026-114 for liability, remedies and renewal risk.", {
              source: "review-queue:114",
              freshness: "2026-10-15T15:59:59Z",
            }),
          ]),
        ],
      }),
      expect: { outcome: "refused", refused: "slot_floor_over_budget" },
    },
  ],
}
