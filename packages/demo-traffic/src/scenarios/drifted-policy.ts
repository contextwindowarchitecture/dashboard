// A canary of the support assistant runs the registry's cache-first-chat profile on support-chat
// under illustrative/v1, but its copy of that route policy raises the knowledge relevance floor from
// 0.5 to 0.7 without a new version. A registry would refuse to load it (R-20; conformance/README.md,
// Registry): the lock pins illustrative/v1 to other content. Nothing in assembly checks the lock, so
// the assembler runs it, and a chunk the pinned policy admits is excluded below_threshold. The
// index's route_policy_sha256 is what shows the drift.

import {
  batch,
  fromRegistry,
  instruction,
  knowledge,
  query,
  type Scenario,
  snapshot,
} from "./build.ts"

const { profile, route_policy } = fromRegistry("cache-first-chat")
const knowledgeRules = (route_policy.slots as Record<string, { min_relevance?: number }>)[
  "evidence.knowledge"
]!
knowledgeRules.min_relevance = 0.7

const scope = { tenant: "northwind", user: "u_311", task: "refund_question" }
const chunk = (id: string, body: string, relevance: number) =>
  knowledge(id, body, relevance, {
    source: id.split("#")[0],
    source_version: "2026-09-10",
    freshness: "2026-09-12T15:30:00Z",
    extra: { scope: { tenant: "northwind" } },
  })

export const driftedPolicy: Scenario = {
  id: "drifted-policy",
  title:
    "A canary runs support-chat illustrative/v1 with a raised relevance floor and no new version; the registry lock pins other content, and a chunk the pinned policy admits is excluded.",
  service: "support-assistant-canary",
  redaction: { mode: "full" },
  turns: [
    {
      snapshot: snapshot({
        assembly_time: "2026-10-15T13:00:00Z",
        scope,
        budget: { input: 4096, reserved_output: 800 },
        profile,
        route_policy,
        tokenizer: "fixture-whitespace/v1",
        renderer: "cwa-message-blocks/v1",
        batches: [
          batch("policy-registry", "policy", [
            instruction(
              "policy:v12",
              "You are a support agent for Northwind. Answer from the evidence and cite it.",
              {
                source: "policy-registry",
                source_version: "v12",
                freshness: "2026-10-01T00:00:00Z",
              },
            ),
          ]),
          batch("policy-corpus", "retrieval", [
            chunk(
              "refunds-eu:v17#p4",
              "Pro plans refund in full within 30 days of purchase.",
              0.91,
            ),
            chunk(
              "refunds-eu:v17#p9",
              "Annual plans refund pro rata after the first 30 days.",
              0.62,
            ),
          ]),
          batch("conversation", "interaction", [
            query("turn:1", "Can I get a refund on my annual Pro plan?", {
              source: "conversation:c311#1",
              freshness: "2026-10-15T12:59:58Z",
              extra: { scope },
            }),
          ]),
        ],
      }),
      expect: {
        outcome: "assembled",
        included: ["refunds-eu:v17#p4"],
        excluded: ["below_threshold"],
      },
    },
  ],
}
