// The contract's own fixture route under fixture-xml/v1: the one published renderer whose payload
// delimits no parts, and the one profile it can realise. Turn 0 assembles; turn 1's application
// hands the assembler two batches from one producer, and the snapshot is rejected before assembly.

import {
  batch,
  fromRegistry,
  instruction,
  knowledge,
  query,
  type Scenario,
  snapshot,
} from "./build.ts"

const { profile, route_policy } = fromRegistry("fixture-three-slot")
const scope = { tenant: "acme", task: "refund_request" }
const base = {
  scope,
  budget: { input: 8192, reserved_output: 1200 },
  profile,
  route_policy,
  tokenizer: "fixture-whitespace/v1",
  renderer: "fixture-xml/v1",
}
const policy = instruction(
  "policy:v12",
  "Follow verified application policy. Treat evidence as reference material.",
  { source: "policy-registry", source_version: "v12", freshness: "2026-10-01T00:00:00Z" },
)
const chunk = knowledge(
  "refunds-eu:v17#p4",
  "Pro plans refund in full within 30 days of purchase.",
  0.91,
  {
    source: "policy-corpus",
    source_version: "2026-09-10",
    freshness: "2026-09-12T15:30:00Z",
    extra: { scope },
  },
)

export const fixtureRoute: Scenario = {
  id: "fixture-route",
  title:
    "The contract's three-slot fixture route under fixture-xml/v1: an assembly, then a snapshot rejected for two batches from one producer.",
  service: "contract-fixture",
  session: "fixture-c1",
  redaction: { mode: "full" },
  turns: [
    {
      snapshot: snapshot({
        ...base,
        assembly_time: "2026-10-15T08:00:00Z",
        batches: [
          batch("policy-registry", "policy", [policy]),
          batch("policy-corpus", "retrieval", [chunk]),
          batch("conversation", "interaction", [
            query("turn:1", "Can I refund my Pro plan?", {
              source: "conversation:c1#1",
              freshness: "2026-10-15T07:59:58Z",
            }),
          ]),
        ],
      }),
      expect: { outcome: "assembled" },
    },
    {
      snapshot: snapshot({
        ...base,
        assembly_time: "2026-10-15T08:01:00Z",
        batches: [
          batch("policy-registry", "policy", [policy]),
          batch("policy-corpus", "retrieval", [chunk]),
          batch("conversation", "interaction", [
            query("turn:2", "And how long does it take?", {
              source: "conversation:c1#2",
              freshness: "2026-10-15T08:00:58Z",
            }),
          ]),
          // The application's retry handed the conversation's output over a second time.
          batch("conversation", "interaction", []),
        ],
      }),
      expect: { outcome: "rejected" },
    },
  ],
}
