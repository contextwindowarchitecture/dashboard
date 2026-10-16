// One call on the spec's example route (support-chat, illustrative/v1) under the policy-first
// profile, as a message request. The retriever floods the knowledge slot from one handbook: the
// route keeps three chunks per source (R-26), drops an exact copy (R-24) and anything below its
// relevance floor (R-13), and the user's profile, read too long ago, is stale (R-8).

import {
  batch,
  fromRegistry,
  instruction,
  knowledge,
  query,
  type Scenario,
  snapshot,
  userState,
} from "./build.ts"

const { profile, route_policy } = fromRegistry("policy-first-chat")
const TENANT = "northwind"

const handbook = (n: number, body: string, relevance: number) =>
  knowledge(`returns-handbook:v8#p${n}`, body, relevance, {
    source: "returns-handbook:v8",
    source_version: "v8",
    freshness: "2026-09-01T00:00:00Z",
    extra: { scope: { tenant: TENANT } },
  })

export const knowledgeFlood: Scenario = {
  id: "knowledge-flood",
  title:
    "A retriever floods the knowledge slot from one handbook: the route keeps three chunks per source, drops an exact copy and a low-relevance chunk, and finds the user's profile stale.",
  service: "support-assistant",
  redaction: { mode: "full" },
  turns: [
    {
      snapshot: snapshot({
        assembly_time: "2026-10-15T13:00:00Z",
        scope: { tenant: TENANT, user: "u_77", task: "returns_question" },
        budget: { input: 8192, reserved_output: 1200 },
        profile,
        route_policy,
        tokenizer: "fixture-whitespace/v1",
        renderer: "cwa-messages/v1",
        batches: [
          batch("policy-registry", "policy", [
            instruction(
              "policy:v12",
              "You are a support agent for Northwind. Answer from the evidence.",
              {
                source: "policy-registry",
                source_version: "v12",
                freshness: "2026-10-01T00:00:00Z",
              },
            ),
          ]),
          batch("state-svc", "state", [
            // Read at the start of a long session: older than the route's five-minute limit.
            userState("user:profile", "plan=team; region=US; tone=detailed", {
              source: "state-svc",
              freshness: "2026-10-15T12:41:00Z",
              extra: { scope: { tenant: TENANT, user: "u_77" } },
            }),
          ]),
          batch("policy-corpus", "retrieval", [
            handbook(
              1,
              "Returns are accepted within 30 days for unused hardware in its original packaging.",
              0.94,
            ),
            handbook(
              2,
              "A prepaid return label is emailed once the return request is approved.",
              0.9,
            ),
            handbook(
              3,
              "Refunds for returned hardware are issued when the warehouse scans the parcel.",
              0.87,
            ),
            handbook(4, "Opened accessories can be returned only if they are faulty.", 0.82),
            handbook(
              5,
              "International returns may take up to 21 days to reach the warehouse.",
              0.79,
            ),
            // The same paragraph indexed twice under another id.
            {
              ...handbook(
                6,
                "Returns are accepted within 30 days for unused hardware in its original packaging.",
                0.93,
              ),
            },
            handbook(7, "The returns team is based in Rotterdam.", 0.31),
          ]),
          batch("conversation", "interaction", [
            query(
              "turn:1",
              "I want to return the dock I bought two weeks ago. How does that work?",
              {
                source: "conversation:u_77#1",
                freshness: "2026-10-15T12:59:58Z",
              },
            ),
          ]),
        ],
      }),
      expect: {
        outcome: "assembled",
        excluded: ["source_diversity_cap", "duplicate_content", "below_threshold", "stale_state"],
      },
    },
  ],
}
