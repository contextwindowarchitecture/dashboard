// One call on the extract route (illustrative/v1), whose responses a parser consumes, under the
// extraction profile, as a message request. The output contract has grown into a schema larger
// than the whole budget; protected content is never shed, so the assembler refuses before it
// reduces anything (R-17).

import {
  batch,
  fromRegistry,
  instruction,
  knowledge,
  outputContract,
  query,
  type Scenario,
  snapshot,
} from "./build.ts"

const { profile, route_policy } = fromRegistry("extraction")
const TENANT = "harbor-logistics"

// An invoice-extraction schema with every field the finance team ever asked for.
const FIELDS = Array.from(
  { length: 120 },
  (_, i) =>
    `"field_${String(i + 1).padStart(3, "0")}": {"type": "string", "description": "Invoice attribute ${i + 1} as printed, or null when absent."}`,
)
const SCHEMA = `Return one JSON object matching this schema: {"type": "object", "properties": {${FIELDS.join(", ")}}}`

export const extractionOverflow: Scenario = {
  id: "extraction-overflow",
  title:
    "An extraction route's output contract has grown larger than its budget; protected content is never shed, so the assembler refuses with protected_content_over_budget.",
  service: "invoice-extractor",
  redaction: { mode: "full" },
  turns: [
    {
      snapshot: snapshot({
        assembly_time: "2026-10-15T15:00:00Z",
        scope: { tenant: TENANT, task: "extract_invoice_7731" },
        budget: { input: 2048, reserved_output: 1024 },
        profile,
        route_policy,
        tokenizer: "estimate-utf8/v1",
        renderer: "cwa-messages/v1",
        batches: [
          batch("policy-registry", "policy", [
            instruction(
              "policy:extract-v2",
              "Extract invoice fields exactly as printed. Do not infer missing values.",
              {
                source: "policy-registry",
                source_version: "extract-v2",
                freshness: "2026-10-01T00:00:00Z",
              },
            ),
            outputContract("format:invoice-v9", SCHEMA, {
              source: "policy-registry",
              source_version: "invoice-v9",
              freshness: "2026-10-14T00:00:00Z",
            }),
          ]),
          batch("document-index", "retrieval", [
            knowledge(
              "invoice-7731#page1",
              "INVOICE 7731. Harbor Logistics BV, Rotterdam. Date 2026-10-02. Total EUR 18,420.00, VAT 21%.",
              0.97,
              {
                source: "invoice-7731",
                source_version: "scan-1",
                freshness: "2026-10-02T09:00:00Z",
                extra: { scope: { tenant: TENANT } },
              },
            ),
          ]),
          batch("conversation", "interaction", [
            query("job:7731", "Extract the fields of invoice 7731.", {
              source: "extract-queue:7731",
              freshness: "2026-10-15T14:59:59Z",
            }),
          ]),
        ],
      }),
      expect: { outcome: "refused", refused: "protected_content_over_budget" },
    },
  ],
}
