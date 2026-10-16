// Three turns of questions about a long annual report on the long-context-qa route (illustrative/v1),
// whose policy requires evidence, under the long-context-reinforced profile (instructions as system
// text and repeated after the evidence), as message blocks. Each turn retrieves more of the report
// into a fixed budget; chunks carry summaries their producer computed ahead of time, and the
// assembler steps them down to fit (R-16, R-18). The docs adapter reports the report's page count
// twice, and the newer reading supersedes the older (R-25).

import {
  batch,
  fromRegistry,
  instruction,
  type Item,
  knowledge,
  query,
  type Scenario,
  type ScenarioTurn,
  snapshot,
  toolResult,
  turn,
} from "./build.ts"

const { profile, route_policy } = fromRegistry("long-context-reinforced")
const TENANT = "fjord-capital"

const section = (n: number, body: string, summary: string, relevance: number): Item =>
  knowledge(`annual-report-2025#s${n}`, body, relevance, {
    source: "annual-report-2025",
    source_version: "final",
    freshness: "2026-03-14T00:00:00Z",
    extra: {
      scope: { tenant: TENANT },
      variants: [
        {
          id: `annual-report-2025#s${n}/summary`,
          body: summary,
          method: "summary",
          lineage: "summarised",
        },
      ],
    },
  })

const SECTIONS: Item[] = [
  section(
    1,
    "Revenue grew 11 percent to NOK 4.2 billion, driven by the Nordic payments business, which added 38,000 merchants. Card volumes rose 17 percent while transaction margins narrowed by four basis points under competitive pricing in Sweden and Denmark. Recurring software revenue reached 31 percent of the total, up from 26 percent.",
    "Revenue +11% to NOK 4.2bn; Nordic payments added 38,000 merchants; margins down 4bp.",
    0.91,
  ),
  section(
    2,
    "Operating costs rose 9 percent, mainly from 240 new engineering hires and the migration of the core ledger to a cloud provider, which ran three months late. The board expects the migration's double-running costs of NOK 85 million to end in the second quarter of 2026.",
    "Costs +9% from hiring and a late ledger migration; NOK 85m double-running ends Q2 2026.",
    0.86,
  ),
  section(
    3,
    "Credit losses on the merchant lending book increased to 1.9 percent of loans from 1.2 percent, concentrated in hospitality merchants in Norway. Provisions were raised by NOK 60 million and new lending to the segment was paused in October.",
    "Merchant credit losses 1.9% (from 1.2%), Norwegian hospitality; NOK 60m provisions; lending paused.",
    0.84,
  ),
  section(
    4,
    "The company holds NOK 1.1 billion in cash and an undrawn revolving facility of NOK 500 million. The board proposes a dividend of NOK 2.40 per share and a buyback of up to NOK 300 million over twelve months.",
    "Cash NOK 1.1bn plus NOK 500m undrawn facility; dividend NOK 2.40; buyback up to NOK 300m.",
    0.8,
  ),
  section(
    5,
    "Regulatory risk centres on the revised Payment Services Directive, which will require changes to strong customer authentication flows. The company estimates compliance costs of NOK 40 million across 2026 and 2027.",
    "PSD revision needs SCA changes; NOK 40m compliance cost over 2026-2027.",
    0.78,
  ),
  section(
    6,
    "Employee engagement scored 78 out of 100 in the annual survey, and voluntary attrition fell to 8 percent. The company opened an office in Tallinn with 60 staff.",
    "Engagement 78/100; attrition 8%; new Tallinn office with 60 staff.",
    0.62,
  ),
]

const QUESTIONS = [
  "What drove revenue growth last year?",
  "And what is happening with costs and credit losses?",
  "Given all that, how safe is the proposed dividend?",
]
const ANSWERS = [
  "Revenue grew 11 percent to NOK 4.2 billion, mainly from the Nordic payments business adding 38,000 merchants.",
  "Costs rose 9 percent from hiring and a late ledger migration, and merchant credit losses rose to 1.9 percent of loans.",
]

const pageCount = (reading: number, at: string, pages: number) =>
  toolResult(
    `obs:report-pages-${reading}`,
    `{"document": "annual-report-2025", "pages": ${pages}}`,
    {
      source: "docs-mcp:annual-report-2025",
      source_version: `reading-${reading}`,
      freshness: at,
    },
  )

// What each turn was written to show, at the budget below: no reduction while the evidence is
// short, then more chunks stepping down to their summaries as each turn retrieves more.
const EXPECT: ScenarioTurn["expect"][] = [
  { outcome: "assembled" },
  {
    outcome: "assembled",
    excluded: ["superseded"],
    included: ["obs:report-pages-2"],
    compressed: 2,
  },
  {
    outcome: "assembled",
    excluded: ["superseded"],
    included: ["obs:report-pages-2"],
    compressed: 6,
  },
]

// An instant on the day of the session, at a minute past 17:00 and a second.
const time = (minute: number, second: number) =>
  `2026-10-15T17:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}Z`

function at(k: number, budget: number): ScenarioTurn {
  const minute = 10 + k * 5
  const said = Array.from({ length: k }, (_, i) => [
    turn(`turn:${2 * i + 1}`, QUESTIONS[i]!, "user", {
      source: `conversation:ir-3#${2 * i + 1}`,
      freshness: time(10 + i * 5, 10),
    }),
    turn(`turn:${2 * i + 2}`, ANSWERS[i]!, "model", {
      source: `conversation:ir-3#${2 * i + 2}`,
      freshness: time(10 + i * 5, 40),
    }),
  ]).flat()
  return {
    snapshot: snapshot({
      assembly_time: time(minute + 1, 0),
      scope: { tenant: TENANT, user: "analyst_3", session: "ir-3", task: "report_qa" },
      budget: { input: budget, reserved_output: 1500 },
      profile,
      route_policy,
      tokenizer: "estimate-utf8/v1",
      renderer: "cwa-message-blocks/v1",
      batches: [
        batch("policy-registry", "policy", [
          instruction(
            "policy:ir-v1",
            "You answer analysts' questions about Fjord Capital's published reports. Use only the report excerpts in the evidence, give figures with their units, and say when the report does not cover a question.",
            {
              source: "policy-registry",
              source_version: "ir-v1",
              freshness: "2026-10-01T00:00:00Z",
            },
          ),
        ]),
        batch("document-index", "retrieval", SECTIONS.slice(0, 2 + 2 * k)),
        batch("docs-mcp", "mcp", [
          pageCount(1, time(5, 0), 212),
          // Re-read after the first turn: the newer reading supersedes the older.
          ...(k >= 1 ? [pageCount(2, time(minute, 50), 214)] : []),
        ]),
        batch("conversation", "interaction", [
          ...said,
          query(`turn:${2 * k + 1}`, QUESTIONS[k]!, {
            source: `conversation:ir-3#${2 * k + 1}`,
            freshness: time(minute, 55),
          }),
        ]),
      ],
    }),
    expect: EXPECT[k]!,
  }
}

export function annualReportAt(budget: number): ScenarioTurn[] {
  return [0, 1, 2].map((k) => at(k, budget))
}

export const annualReport: Scenario = {
  id: "annual-report",
  title:
    "Three questions about a long annual report under the long-context profile: each turn retrieves more into a fixed budget, and more chunks step down to their summaries; a re-read page count supersedes the first.",
  service: "investor-relations",
  session: "ir-3",
  redaction: { mode: "full" },
  turns: annualReportAt(500),
}
