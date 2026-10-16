// One call on the support-chat route under the registry's conflict-fact/v1 policy, with a draft
// profile of the deployment's own (no published profile binds that policy). Two retrievers
// disagree about the refund window; the application declared them a fact group, and the route's
// precedence decides it for the policy corpus over the wiki (R-11).

import {
  batch,
  draftProfile,
  instruction,
  knowledge,
  outputContract,
  query,
  type Scenario,
  snapshot,
} from "./build.ts"
import { REGISTRY } from "@cwa-dashboard/contract/registry"

const route_policy = structuredClone(
  REGISTRY.route_policies.find((policy) => policy.version === "conflict-fact/v1")!,
)
const profile = draftProfile("billing-facts", route_policy.route, route_policy.version, [
  { slot: "governance.instructions", wrap: "system" },
  { slot: "governance.output_contract", wrap: "xml:format" },
  { slot: "evidence.knowledge", wrap: "xml:evidence" },
  { slot: "interaction.history", wrap: "xml:history" },
  { slot: "interaction.query", wrap: "xml:query" },
])

const scope = { tenant: "northwind", user: "u_208", task: "refund_question" }
const chunk = (id: string, body: string, relevance: number, at: string) =>
  knowledge(id, body, relevance, {
    source: id.split("#")[0],
    source_version: at.slice(0, 10),
    freshness: at,
    extra: { scope: { tenant: "northwind" } },
  })

export const billingFacts: Scenario = {
  id: "billing-facts",
  title:
    "Two retrievers disagree about the refund window; the route's fact precedence keeps the policy corpus and records the wiki page as conflict_lost.",
  service: "support-assistant",
  redaction: { mode: "full" },
  turns: [
    {
      snapshot: snapshot({
        assembly_time: "2026-10-15T12:00:00Z",
        scope,
        budget: { input: 4096, reserved_output: 800 },
        profile,
        route_policy,
        tokenizer: "fixture-whitespace/v1",
        renderer: "cwa-messages/v1",
        conflicts: [
          {
            id: "g-refund-window",
            kind: "fact",
            fact: "refund.window",
            items: ["refunds-eu:v17#p4", "wiki:refunds#window"],
          },
        ] as never,
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
            outputContract("format:chat", "Max 3 sentences. No bullet lists.", {
              source: "policy-registry",
              source_version: "v12",
              freshness: "2026-10-01T00:00:00Z",
            }),
          ]),
          batch("policy-corpus", "retrieval", [
            chunk(
              "refunds-eu:v17#p4",
              "Pro plans refund in full within 30 days of purchase.",
              0.93,
              "2026-09-10T08:00:00Z",
            ),
          ]),
          batch("wiki-corpus", "retrieval", [
            chunk(
              "wiki:refunds#window",
              "Refunds are only possible within 14 days of purchase.",
              0.88,
              "2025-11-02T14:00:00Z",
            ),
          ]),
          batch("conversation", "interaction", [
            query("turn:1", "How long do I have to ask for a refund on Pro?", {
              source: "conversation:u_208#1",
              freshness: "2026-10-15T11:59:58Z",
            }),
          ]),
        ],
      }),
      expect: {
        outcome: "assembled",
        excluded: ["conflict_lost"],
        included: ["refunds-eu:v17#p4"],
      },
    },
  ],
}
