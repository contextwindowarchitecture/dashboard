// What the API serves a reader whose roles do not cover an event's route (ADR-0011), made from a real
// event the way apps/ingest's withholdBodies makes it: every body and variant body withheld with its
// digest, the mode kept. For the page's tests; the API's own tests hold the real thing.

import { createHash } from "node:crypto"

import { canonicalJson } from "@cwa-dashboard/telemetry/canonical"
import type { AssemblyEventV1 } from "@cwa-dashboard/telemetry/types"

const digest = (body: unknown) =>
  typeof body === "object" && body !== null && "content_sha256" in body
    ? (body as { content_sha256: string }).content_sha256
    : createHash("sha256")
        .update(typeof body === "string" ? body : canonicalJson(body))
        .digest("hex")

export function withheld(event: AssemblyEventV1): AssemblyEventV1 {
  const copy = structuredClone(event)
  for (const batch of copy.snapshot?.batches ?? []) {
    for (const item of batch.items as Record<string, unknown>[]) {
      if ("body" in item) item["body"] = { withheld: "role", content_sha256: digest(item["body"]) }
      for (const variant of (item["variants"] as Record<string, unknown>[] | undefined) ?? []) {
        if ("body" in variant) {
          variant["body"] = { withheld: "role", content_sha256: digest(variant["body"]) }
        }
      }
    }
  }
  return copy
}
