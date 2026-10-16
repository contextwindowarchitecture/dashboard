// Two calls on a policy-desk route of the deployment's own, with a draft profile. Two governing
// instructions both claim to govern; the application declared them an instruction group, and the
// route asks for more context rather than pick one (R-11): the assembly refuses with
// conflict_unresolved and a request_context recovery. In the second call the policy owner has
// withdrawn one of them, and the assembly goes ahead.

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
  route: "policy-desk",
  version: "desk/v1",
  producers: {
    "policy-registry": { kind: "policy", slots: ["governance.instructions"] },
    "policy-corpus": { kind: "retrieval", slots: ["evidence.knowledge"] },
    conversation: { kind: "interaction", slots: ["interaction.history", "interaction.query"] },
  },
  slots: { "evidence.knowledge": { min_relevance: 0.5, required_scope: ["tenant"] } },
  on_unresolved_instruction: "request_context",
} as unknown as RoutePolicy

const profile = draftProfile("policy-desk", "policy-desk", "desk/v1", [
  { slot: "governance.instructions", wrap: "system" },
  { slot: "evidence.knowledge", wrap: "xml:evidence" },
  { slot: "interaction.query", wrap: "xml:query" },
])

const scope = { tenant: "northwind", user: "agent_12", task: "policy_lookup" }
const CITE = instruction(
  "policy:cite-v12",
  "Always cite the internal policy document id for every answer.",
  {
    source: "policy-registry",
    source_version: "v12",
    freshness: "2026-10-01T00:00:00Z",
    extra: { conflict_policy: "governs" },
  },
)
const NO_IDS = instruction(
  "policy:no-internal-ids",
  "Never mention internal document ids to anyone.",
  {
    source: "policy-registry",
    source_version: "privacy-v3",
    freshness: "2026-10-10T00:00:00Z",
    extra: { conflict_policy: "governs" },
  },
)
const CHUNK = knowledge(
  "travel-policy:v4#p2",
  "Economy class is required for flights under six hours.",
  0.9,
  {
    source: "travel-policy:v4",
    source_version: "v4",
    freshness: "2026-09-01T00:00:00Z",
    extra: { scope: { tenant: "northwind" } },
  },
)

const call = (at: string, instructions: ReturnType<typeof instruction>[], grouped: boolean) =>
  snapshot({
    assembly_time: at,
    scope,
    budget: { input: 4096, reserved_output: 800 },
    profile,
    route_policy,
    tokenizer: "estimate-utf8/v1",
    renderer: "cwa-messages/v1",
    conflicts: grouped
      ? ([
          {
            id: "g-cite-ids",
            kind: "instruction",
            items: ["policy:cite-v12", "policy:no-internal-ids"],
          },
        ] as never)
      : [],
    batches: [
      batch("policy-registry", "policy", instructions),
      batch("policy-corpus", "retrieval", [CHUNK]),
      batch("conversation", "interaction", [
        query(`q:${at}`, "Can I fly business class to Berlin, and where does it say so?", {
          source: "conversation:agent_12",
          freshness: at.replace(/:00Z$/, ":00Z"),
        }),
      ]),
    ],
  })

export const policyDesk: Scenario = {
  id: "policy-desk",
  title:
    "Two governing instructions conflict and the route asks for context instead of choosing: conflict_unresolved with request_context; once one is withdrawn, the next call assembles.",
  service: "policy-desk",
  session: "desk-agent-12",
  redaction: { mode: "full" },
  turns: [
    {
      snapshot: call("2026-10-15T14:00:00Z", [CITE, NO_IDS], true),
      expect: { outcome: "refused", refused: "conflict_unresolved" },
    },
    {
      snapshot: call("2026-10-15T14:20:00Z", [NO_IDS], false),
      expect: { outcome: "assembled", included: ["policy:no-internal-ids", "travel-policy:v4#p2"] },
    },
  ],
}
