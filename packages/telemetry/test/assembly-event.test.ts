import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { validateAssemblyEventV1 } from "../generated/validators.js"

const vendor = resolve(import.meta.dirname, "../../contract/vendor/cwa")
const read = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(vendor, path), "utf8")) as Record<string, unknown>
const clone = <T>(value: T): T => structuredClone(value)

// Events built from vendored conformance cases: the snapshot, trace and payload are the contract's,
// and only the envelope around them is written here.
const ENVELOPE = {
  $schema: "cwa-dashboard/assembly-event/v1",
  event_id: "01JA2B3C4D5E6F7G8H9JKMNPQR",
  recorded_at: "2026-10-15T09:30:00.000Z",
  service: { name: "refund-assistant", environment: "demo" },
  assembler: {
    language: "typescript",
    name: "@contextwindowarchitecture/assembler",
    version: "0.0.1",
  },
  contract: {
    repository: "contextwindowarchitecture/contextwindowarchitecture",
    commit: "16de4be6e4c9f1d0a7b2c3d4e5f60718293a4b5c",
    lock_sha256: "a".repeat(64),
  },
  redaction_mode: "full",
  timings_ms: { total: 3.2 },
}

function fromCase(id: string) {
  const snapshot = read(`conformance/cases/${id}/snapshot.json`)
  const trace = read(`conformance/cases/${id}/expected.trace.json`) as {
    result: { hash: string } | null
    refused: { bool: boolean }
  }
  if (trace.refused.bool) return { ...clone(ENVELOPE), outcome: "refused", snapshot, trace }
  const payload = readFileSync(join(vendor, `conformance/cases/${id}/expected.payload.txt`))
  return {
    ...clone(ENVELOPE),
    outcome: "assembled",
    snapshot,
    trace,
    payload: { hash: trace.result!.hash, bytes: payload.length },
  }
}

function rejected(id: string) {
  return {
    ...clone(ENVELOPE),
    outcome: "rejected",
    rejection: {
      problems: ["/budget is required"],
      snapshot: read(`conformance/rejections/${id}/snapshot.json`),
    },
  }
}

type Event = Record<string, unknown>
const assembled = (): Event => fromCase("fixture-three-slot")
const refused = (): Event => fromCase("protected-over-budget")
const withVariants = (): Event => fromCase("budget-variant-choice")

function errors(event: unknown): string[] {
  validateAssemblyEventV1(event)
  return (validateAssemblyEventV1.errors ?? []).map(
    (error) => `${error.instancePath} ${error.message}`,
  )
}
const expectValid = (event: unknown) => expect(errors(event)).toEqual([])
const expectInvalid = (event: unknown) => expect(validateAssemblyEventV1(event)).toBe(false)

describe("assembly-event v1: the outcomes", () => {
  it("accepts an assembled, a refused and a rejected event built from the vendored cases", () => {
    expectValid(assembled())
    expectValid(refused())
    expectValid(withVariants())
    expectValid(rejected("schema-missing-budget"))
  })

  it("holds the envelope to its own $schema", () => {
    expectInvalid({ ...assembled(), $schema: "cwa-dashboard/assembly-event/v2" })
  })

  it("requires every envelope field", () => {
    for (const field of [
      "$schema",
      "event_id",
      "recorded_at",
      "service",
      "assembler",
      "contract",
      "redaction_mode",
      "outcome",
      "timings_ms",
    ]) {
      const event = assembled()
      delete event[field]
      expect(validateAssemblyEventV1(event), field).toBe(false)
    }
  })

  it("accepts no field of its own beyond v1's", () => {
    expectInvalid({ ...assembled(), cost_usd: 0.01 })
  })

  it("requires a valid trace, snapshot and payload when assembled", () => {
    for (const field of ["trace", "snapshot", "payload"]) {
      const event = assembled()
      delete event[field]
      expect(validateAssemblyEventV1(event), field).toBe(false)
    }
    const event = assembled()
    delete (event["trace"] as Event)["context"]
    expectInvalid(event)
    const noBudget = assembled()
    delete (noBudget["snapshot"] as Event)["budget"]
    expectInvalid(noBudget)
  })

  it("matches the outcome to the trace's refusal", () => {
    expectInvalid({ ...assembled(), outcome: "refused", payload: undefined })
    const claimsAssembled = refused()
    claimsAssembled["outcome"] = "assembled"
    claimsAssembled["payload"] = { hash: "b".repeat(64), bytes: 10 }
    expectInvalid(claimsAssembled)
  })

  it("carries no payload for a refusal", () => {
    expectInvalid({ ...refused(), payload: { hash: "b".repeat(64), bytes: 10 } })
  })

  it("carries a rejection's problems and what was submitted, and no trace, payload or snapshot", () => {
    const event = rejected("schema-missing-budget")
    expectValid(event)
    expectInvalid({ ...event, rejection: { ...(event["rejection"] as Event), problems: [] } })
    expectInvalid({ ...event, trace: assembled()["trace"] })
    expectInvalid({ ...event, payload: assembled()["payload"] })
    expectInvalid({ ...event, snapshot: assembled()["snapshot"] })
    const noRejection: Event = { ...event }
    delete noRejection["rejection"]
    expectInvalid(noRejection)
    expectInvalid({ ...assembled(), rejection: event["rejection"] })
  })

  it("holds identifiers to their forms", () => {
    expectInvalid({ ...assembled(), event_id: "not-a-ulid" })
    expectInvalid({ ...assembled(), assembler: { ...ENVELOPE.assembler, language: "java" } })
    expectInvalid({ ...assembled(), contract: { ...ENVELOPE.contract, commit: "16de4be" } })
    expectInvalid({ ...assembled(), session: { id: "s-1", turn_index: -1 } })
    expectValid({ ...assembled(), session: { id: "s-1", turn_index: 0 } })
    expectValid({ ...assembled(), otel: { trace_id: "c".repeat(32), span_id: "d".repeat(16) } })
    expectInvalid({
      ...assembled(),
      prefix: { sha256: "e".repeat(64), through_slot: "governance.instructions", bytes: 1 },
    })
  })
})

describe("assembly-event v1: payload parts", () => {
  const part = (section: string, id?: string) => ({
    section,
    ...(id === undefined ? {} : { id }),
    sha256: "e".repeat(64),
    bytes: 12,
  })
  const withParts = (parts: unknown[]) => {
    const event = assembled()
    event["payload"] = { ...(event["payload"] as Event), parts }
    return event
  }

  it("accepts the parts a payload's published format delimits, in request order", () => {
    expectValid(
      withParts([
        part("system", "policy:v12"),
        part("tools", "cap:refund"),
        part("content", "kb:1"),
      ]),
    )
    expectValid(withParts([part("system", "policy:v12"), part("content")]))
    expectValid(withParts([]))
  })

  it("holds each part to its section, digest and size", () => {
    expectInvalid(withParts([part("messages", "x")]))
    expectInvalid(withParts([{ ...part("system", "a"), sha256: "short" }]))
    expectInvalid(withParts([{ ...part("system", "a"), bytes: -1 }]))
    expectInvalid(withParts([{ section: "system", id: "a", sha256: "e".repeat(64) }]))
  })
})

// --- redaction -----------------------------------------------------------------------------------

type Body = unknown
const sha256 = (body: Body) =>
  createHash("sha256")
    .update(typeof body === "string" ? body : JSON.stringify(body))
    .digest("hex")

// Every body and variant body of every candidate, replaced. The token count is a placeholder: the
// schema checks the redacted body's shape; the generator's tests check its numbers.
function redact(event: Event, mode: "digest_only" | "pii_scrubbed"): Event {
  const replace = (body: Body) =>
    mode === "digest_only"
      ? {
          redacted: "digest_only",
          content_sha256: sha256(body),
          token_counts: { "fixture-whitespace/v1": 3 },
        }
      : {
          redacted: "pii_scrubbed",
          text: "[name] asked about order [id]",
          content_sha256: sha256(body),
          token_counts: { "fixture-whitespace/v1": 3 },
        }
  const snapshot = (event["snapshot"] ?? (event["rejection"] as Event)["snapshot"]) as {
    batches: { items: Record<string, unknown>[] }[]
  }
  for (const batch of snapshot.batches) {
    for (const item of batch.items) {
      if (item === null || typeof item !== "object") continue
      if ("body" in item) item["body"] = replace(item["body"])
      for (const variant of (item["variants"] as Event[] | undefined) ?? []) {
        variant["body"] = replace(variant["body"])
      }
    }
  }
  event["redaction_mode"] = mode
  return event
}

const firstItem = (event: Event) =>
  ((event["snapshot"] as Event)["batches"] as { items: Event[] }[])[0]!.items[0]!

describe("assembly-event v1: redaction (R-DASH-1, R-DASH-2)", () => {
  it("accepts each mode's body form, on items and on their variants", () => {
    expectValid(redact(withVariants(), "digest_only"))
    expectValid(redact(withVariants(), "pii_scrubbed"))
    expectValid(redact(rejected("schema-missing-budget"), "digest_only"))
  })

  it("keeps every metadata field in every mode: a mode touches bodies only", () => {
    for (const mode of ["digest_only", "pii_scrubbed"] as const) {
      const before = firstItem(assembled())
      const after = firstItem(redact(assembled(), mode))
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
      for (const [field, value] of Object.entries(before)) {
        if (field !== "body") expect(after[field], `${mode} ${field}`).toEqual(value)
      }
    }
  })

  it("refuses a body left readable under digest_only, on an item or a variant", () => {
    const item = redact(withVariants(), "digest_only")
    firstItem(item)["body"] = "the original text"
    expectInvalid(item)

    const variant = redact(withVariants(), "digest_only")
    const batches = (variant["snapshot"] as Event)["batches"] as { items: Event[] }[]
    const withVariant = batches
      .flatMap((batch) => batch.items)
      .find((i) => ((i["variants"] as unknown[] | undefined) ?? []).length > 0)!
    ;(withVariant["variants"] as Event[])[0]!["body"] = "the original variant"
    expectInvalid(variant)
  })

  it("refuses a redacted body in a full event, and the other mode's form in each", () => {
    const full = assembled()
    firstItem(full)["body"] = {
      redacted: "digest_only",
      content_sha256: "f".repeat(64),
      token_counts: {},
    }
    expectInvalid(full)

    const scrubbed = redact(assembled(), "pii_scrubbed")
    scrubbed["redaction_mode"] = "digest_only"
    expectInvalid(scrubbed)
    const digested = redact(assembled(), "digest_only")
    digested["redaction_mode"] = "pii_scrubbed"
    expectInvalid(digested)
  })

  it("holds a redacted body to its digest and counts", () => {
    const event = redact(assembled(), "digest_only")
    firstItem(event)["body"] = {
      redacted: "digest_only",
      content_sha256: "short",
      token_counts: {},
    }
    expectInvalid(event)
    firstItem(event)["body"] = {
      redacted: "digest_only",
      content_sha256: "f".repeat(64),
      token_counts: { "fixture-whitespace/v1": -1 },
    }
    expectInvalid(event)
  })
})
