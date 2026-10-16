// A five-turn support conversation on the spec's own example route (support-chat,
// illustrative/v1), placed by the cache-first profile and rendered as message blocks, so every
// occurrence is a part the dashboard can compare from turn to turn. The budget stays fixed while
// the history grows: by turn 4 the droppable steering examples no longer fit, and by turn 5 a
// knowledge chunk steps down to the summary its producer computed ahead of time.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import type { Snapshot } from "@cwa-dashboard/contract/types"

import {
  batch,
  example,
  fromRegistry,
  type Item,
  query,
  type Scenario,
  type ScenarioTurn,
  snapshot,
  turn,
} from "./build.ts"

// The specification's example snapshot: its producers, items and capabilities are this route's.
const EXAMPLE = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../contract/vendor/cwa/examples/messages-snapshot.json"),
    "utf8",
  ),
) as Snapshot
const itemsOf = (producer: string) =>
  structuredClone((EXAMPLE.batches.find((b) => b.producer.id === producer)?.items ?? []) as Item[])

const { profile, route_policy } = fromRegistry("cache-first-chat")

// The conversation, user and model in turn; turn k asks the k-th user line.
const LINES: { said: "user" | "model"; text: string }[] = [
  {
    said: "user",
    text: "Hi, I bought the Pro plan last month and it is not what I expected. Is my order refundable?",
  },
  {
    said: "model",
    text: "I can check that for you. Pro plans are refundable in full within 30 days of purchase. Could you share your order number?",
  },
  { said: "user", text: "It is order 8821. I paid with my company card, if that matters." },
  {
    said: "model",
    text: "Thanks. Order 8821 was placed 12 days ago for 240 EUR, so it is inside the 30-day window. The refund goes back to the card you paid with.",
  },
  {
    said: "user",
    text: "Great. How long does the money take to arrive, and do I lose access to the Pro features straight away?",
  },
  {
    said: "model",
    text: "Refunds reach the original card within 5 to 10 business days. Pro features stay active until the refund is issued, then the account returns to the free plan.",
  },
  {
    said: "user",
    text: "Understood. Before you process it, can you confirm there is no cancellation fee for EU customers?",
  },
  {
    said: "model",
    text: "There is no cancellation fee for EU customers on a refund inside the 30-day window. I can process it now if you confirm.",
  },
  { said: "user", text: "Yes, please process the refund for order 8821 now." },
]

const STEERING = [
  example(
    "ex:refund-confirm",
    "Example. User: please refund my order. Agent: I have checked the order against the refund policy; it qualifies, and the refund is issued to the original payment method. You will see it within 5 to 10 business days.",
    { source: "policy-registry", source_version: "examples-v4", freshness: "2026-09-01T00:00:00Z" },
  ),
  example(
    "ex:refund-decline",
    "Example. User: refund my annual plan from last year. Agent: I have checked the order; it is outside the 30-day window, so I cannot refund it, but I can stop the renewal so you are not charged again.",
    { source: "policy-registry", source_version: "examples-v4", freshness: "2026-09-01T00:00:00Z" },
  ),
]

// A long knowledge chunk with a summary its producer computed ahead of time (R-18).
const TERMS: Item = {
  ...itemsOf("policy-corpus").find((i) => i["id"] === "billing-faq:v3#p1")!,
  body: "Refunds are always returned to the original payment method. Card refunds settle within 5 to 10 business days depending on the issuing bank; bank transfers settle within 3 business days. Store credit is never offered in place of a refund unless the customer asks for it in writing. Partial refunds are prorated by unused days for annual plans only; monthly plans refund in full or not at all.",
  variants: [
    {
      id: "billing-faq:v3#p1/summary",
      body: "Refunds go back to the original payment method within 5 to 10 business days.",
      method: "summary",
      lineage: "summarised",
    },
  ],
}

// What each turn was written to show, at the budget below.
const EXPECT: ScenarioTurn["expect"][] = [
  { outcome: "assembled" },
  { outcome: "assembled" },
  { outcome: "assembled" },
  { outcome: "assembled", excluded: ["over_budget"] },
  { outcome: "assembled", excluded: ["over_budget"], compressed: 1 },
]

function turnAt(k: number, budget: number): ScenarioTurn {
  const minute = String(k * 2).padStart(2, "0")
  const asked = 2 * k
  const history = LINES.slice(0, asked).map((line, i) =>
    turn(`turn:${i + 1}`, line.text, line.said, {
      source: `conversation:refund-7#${i + 1}`,
      freshness: `2026-10-15T09:${minute}:${String(i).padStart(2, "0")}Z`,
    }),
  )
  const corpus = itemsOf("policy-corpus").map((i) => (i["id"] === TERMS["id"] ? TERMS : i))
  return {
    snapshot: snapshot({
      assembly_time: `2026-10-15T09:${minute}:30Z`,
      scope: { tenant: "northwind", user: "u_91", session: "refund-7", task: "refund_request" },
      budget: { input: budget, reserved_output: 1200, margin_percent: 15 },
      profile,
      route_policy,
      tokenizer: "estimate-utf8/v1",
      renderer: "cwa-message-blocks/v1",
      capabilities: EXAMPLE.capabilities!,
      batches: [
        batch("policy-registry", "policy", [...itemsOf("policy-registry"), ...STEERING]),
        batch("capability-policy", "capability_policy", itemsOf("capability-policy")),
        batch("state-svc", "state", fresh(itemsOf("state-svc"), `2026-10-15T09:${minute}:20Z`)),
        batch("policy-corpus", "retrieval", corpus),
        batch(
          "crm-mcp",
          "mcp",
          k >= 2 ? fresh(itemsOf("crm-mcp"), `2026-10-15T09:${minute}:25Z`) : [],
        ),
        batch("memory-svc", "memory", itemsOf("memory-svc")),
        batch("conversation", "interaction", [
          ...history,
          query(`turn:${asked + 1}`, LINES[asked]!.text, {
            source: `conversation:refund-7#${asked + 1}`,
            freshness: `2026-10-15T09:${minute}:29Z`,
          }),
        ]),
      ],
    }),
    expect: EXPECT[k]!,
  }
}

// State and tool results are observed at each turn, so they stay inside the route's max age.
const fresh = (items: Item[], at: string) => items.map((i) => ({ ...i, freshness: at }))

export function refundSessionAt(budget: number): ScenarioTurn[] {
  return [0, 1, 2, 3, 4].map((k) => turnAt(k, budget))
}

export const refundSession: Scenario = {
  id: "refund-session",
  title:
    "A five-turn refund conversation under the cache-first profile with message blocks: the growing history sheds the steering examples at turn 4 and steps a knowledge chunk down to its summary at turn 5.",
  service: "support-assistant",
  session: "refund-7",
  redaction: { mode: "full" },
  turns: refundSessionAt(720),
}
