import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { BUILT_ASSEMBLER, TOKENIZERS } from "@cwa-dashboard/assembler"
import { validateAssemblyEventV1 } from "@cwa-dashboard/telemetry/validators"
import { describe, expect, it } from "vitest"

import { bodyDeposits, record, type Recording, ulid } from "../src/wrapper.ts"

const vendor = resolve(import.meta.dirname, "../../contract/vendor/cwa")
const read = (path: string): unknown => JSON.parse(readFileSync(join(vendor, path), "utf8"))
const dirs = (path: string) => readdirSync(join(vendor, path)).sort()
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex")

const RECORDING: Recording = {
  eventId: "01JA2B3C4D5E6F7G8H9JKMNPQR",
  recordedAt: "2026-10-15T09:30:00.000Z",
  service: { name: "conformance", environment: "demo" },
  redaction: { mode: "full" },
  traceId: "01ja2b3c4d5e6f7g8h9jkmnpqr",
}

function expectValid(event: unknown) {
  const ok = validateAssemblyEventV1(event)
  expect(ok ? null : validateAssemblyEventV1.errors).toBeNull()
}

type Item = Record<string, unknown> & { variants?: Record<string, unknown>[] }
const items = (snapshot: unknown) =>
  (snapshot as { batches: { items: unknown[] }[] }).batches.flatMap((batch) => batch.items)

describe("record: an assembly event from one assemble() call", () => {
  it("records every vendored case as a valid event whose outcome, trace and payload are the assembler's", () => {
    for (const id of dirs("conformance/cases")) {
      const snapshot = read(`conformance/cases/${id}/snapshot.json`)
      const event = record(snapshot, RECORDING)
      expectValid(event)
      const expected = read(`conformance/cases/${id}/expected.trace.json`) as {
        refused: { bool: boolean }
        result: { hash: string } | null
      }
      expect(event.outcome, id).toBe(expected.refused.bool ? "refused" : "assembled")
      expect(event.snapshot, id).toEqual(snapshot)
      expect(event.trace?.result, id).toEqual(expected.result)
      if (event.outcome === "assembled") {
        const payload = readFileSync(join(vendor, `conformance/cases/${id}/expected.payload.txt`))
        expect(event.payload, id).toMatchObject({ hash: sha256(payload), bytes: payload.length })
      }
    }
  })

  it("records every vendored rejection with the assembler's problems and what was submitted", () => {
    for (const id of dirs("conformance/rejections")) {
      const snapshot = read(`conformance/rejections/${id}/snapshot.json`)
      const event = record(snapshot, RECORDING)
      expectValid(event)
      expect(event.outcome, id).toBe("rejected")
      expect(event.rejection?.problems.length, id).toBeGreaterThan(0)
    }
  })

  it("names the assembler and the contract from the build, the envelope from the recording", () => {
    const event = record(read("conformance/cases/fixture-three-slot/snapshot.json"), {
      ...RECORDING,
      session: { id: "s-1", turn_index: 3 },
    })
    expect(event.assembler).toEqual({
      language: "typescript",
      name: BUILT_ASSEMBLER.name,
      version: BUILT_ASSEMBLER.version,
    })
    expect(event.contract).toEqual(BUILT_ASSEMBLER.contract)
    expect(event.event_id).toBe(RECORDING.eventId)
    expect(event.recorded_at).toBe(RECORDING.recordedAt)
    expect(event.service).toEqual(RECORDING.service)
    expect(event.session).toEqual({ id: "s-1", turn_index: 3 })
    expect(event.redaction_mode).toBe("full")
    expect(event.timings_ms.total).toBeGreaterThanOrEqual(0)
  })

  it("never changes the snapshot it was given", () => {
    const snapshot = read("conformance/cases/budget-variant-choice/snapshot.json")
    const before = structuredClone(snapshot)
    record(snapshot, { ...RECORDING, redaction: { mode: "digest_only" } })
    expect(snapshot).toEqual(before)
  })
})

describe("record: payload parts", () => {
  // The oracle is the trace and the profile, not the payload: a part renders an included
  // occurrence, and the profile says whether its slot's wrap is system, tools or xml.
  type Snapshot = { renderer: string; profile: { placement: { slot: string; wrap: string }[] } }
  type Trace = { included: { slot: string; item_id: string }[] }
  const section = (wrap: string) => (wrap === "system" || wrap === "tools" ? wrap : "content")
  // included[] follows placement order, and every placement of a slot renders the slot's included
  // items, so a run of k adjacent placements of one slot has k equal runs of rows, in order.
  function wraps(snapshot: Snapshot, rows: Trace["included"]) {
    const result: { id: string; section: string }[] = []
    const placements = snapshot.profile.placement
    let next = 0
    for (let p = 0; p < placements.length;) {
      const slot = placements[p]!.slot
      let k = 1
      while (placements[p + k]?.slot === slot) k += 1
      let run = 0
      while (rows[next + run]?.slot === slot) run += 1
      for (let i = 0; i < run; i += 1) {
        const placement = placements[p + Math.floor(i / (run / k))]!
        result.push({ id: rows[next + i]!.item_id, section: section(placement.wrap) })
      }
      next += run
      p += k
    }
    expect(next).toBe(rows.length)
    return result
  }

  it("lists the parts each published format delimits, in request order, matching the trace", () => {
    const seen = new Set<string>()
    for (const id of dirs("conformance/cases")) {
      const snapshot = read(`conformance/cases/${id}/snapshot.json`) as Snapshot
      const event = record(snapshot, RECORDING)
      if (event.outcome !== "assembled") continue
      seen.add(snapshot.renderer)
      const parts = event.payload!.parts
      const included = wraps(snapshot, (event.trace as unknown as Trace).included)
      const inSection = (name: string) =>
        included.filter((row) => row.section === name).map((row) => row.id)
      const ids = (name: string) =>
        parts!.filter((part) => part.section === name).map((part) => part.id)
      if (snapshot.renderer === "fixture-xml/v1") {
        expect(parts, id).toBeUndefined()
        continue
      }
      expect(
        parts!.map((part) => part.section),
        id,
      ).toEqual([
        ...inSection("system").map(() => "system"),
        ...inSection("tools").map(() => "tools"),
        ...(snapshot.renderer === "cwa-messages/v1"
          ? ["content"]
          : inSection("content").map(() => "content")),
      ])
      expect(ids("system"), id).toEqual(inSection("system"))
      expect(ids("tools"), id).toEqual(inSection("tools"))
      expect(ids("content"), id).toEqual(
        snapshot.renderer === "cwa-messages/v1" ? [undefined] : inSection("content"),
      )
      const total = parts!.reduce((sum, part) => sum + part.bytes, 0)
      expect(total, id).toBeLessThanOrEqual(event.payload!.bytes)
    }
    expect([...seen].sort()).toEqual(["cwa-message-blocks/v1", "cwa-messages/v1", "fixture-xml/v1"])
  })

  it("digests each part's text, the same under every redaction mode", () => {
    const snapshot = read("conformance/cases/blocks-render/snapshot.json")
    const payload = JSON.parse(
      readFileSync(join(vendor, "conformance/cases/blocks-render/expected.payload.txt"), "utf8"),
    ) as { system: { text: string }[] }
    const event = record(snapshot, RECORDING)
    const first = event.payload!.parts![0]!
    expect(first.sha256).toBe(sha256(payload.system[0]!.text))
    expect(first.bytes).toBe(Buffer.byteLength(payload.system[0]!.text))
    const digested = record(snapshot, { ...RECORDING, redaction: { mode: "digest_only" } })
    expect(digested.payload!.parts).toEqual(event.payload!.parts)
  })
})

describe("record: redaction (R-DASH-1, R-DASH-2)", () => {
  const id = "budget-variant-choice"
  const original = () => read(`conformance/cases/${id}/snapshot.json`)
  const tokenizer = (original() as { tokenizer: string }).tokenizer
  const count = TOKENIZERS[tokenizer]!

  it("replaces every body and variant body with its digest and count under digest_only", () => {
    const event = record(original(), { ...RECORDING, redaction: { mode: "digest_only" } })
    expectValid(event)
    const before = items(original()) as Item[]
    const after = items(event.snapshot) as Item[]
    for (const [i, item] of before.entries()) {
      expect(after[i]!["body"]).toEqual({
        redacted: "digest_only",
        content_sha256: sha256(item["body"] as string),
        token_counts: { [tokenizer]: count(item["body"] as string) },
      })
      for (const [v, variant] of (item.variants ?? []).entries()) {
        expect(after[i]!.variants![v]!["body"]).toEqual({
          redacted: "digest_only",
          content_sha256: sha256(variant["body"] as string),
          token_counts: { [tokenizer]: count(variant["body"] as string) },
        })
      }
    }
  })

  it("keeps every other field of every item, and the trace, in every mode", () => {
    const full = record(original(), RECORDING)
    for (const mode of ["digest_only", "pii_scrubbed"] as const) {
      const event = record(original(), { ...RECORDING, redaction: { mode, scrub: ["refund"] } })
      // The same decisions: the trace less its run's timings, which are not deterministic (R-23).
      expect({ ...event.trace, timings: undefined }, mode).toEqual({
        ...full.trace,
        timings: undefined,
      })
      const before = items(original()) as Item[]
      const after = items(event.snapshot) as Item[]
      for (const [i, item] of before.entries()) {
        expect(Object.keys(after[i]!).sort(), mode).toEqual(Object.keys(item).sort())
        for (const [field, value] of Object.entries(item)) {
          if (field === "body" || field === "variants") continue
          expect(after[i]![field], `${mode} ${field}`).toEqual(value)
        }
      }
    }
  })

  it("scrubs the declared terms and e-mail addresses under pii_scrubbed, keeping the original's digest", () => {
    const snapshot = original() as { batches: { items: Item[] }[] }
    const item = snapshot.batches[0]!.items[0]!
    item["body"] = "Ada Lovelace (ada@example.invalid) asks about Ada's refund."
    const event = record(snapshot, {
      ...RECORDING,
      redaction: { mode: "pii_scrubbed", scrub: ["Ada", "Ada Lovelace"] },
    })
    expectValid(event)
    const body = (items(event.snapshot)[0] as Item)["body"]
    expect(body).toEqual({
      redacted: "pii_scrubbed",
      text: "[name] ([email]) asks about [name]'s refund.",
      content_sha256: sha256(item["body"] as string),
      token_counts: { [tokenizer]: count(item["body"] as string) },
    })
  })

  it("digests a body that is not a string by its RFC 8785 serialization, with no count", () => {
    const snapshot = original() as { batches: { items: Item[] }[] }
    snapshot.batches[0]!.items[0]!["body"] = { b: 1, a: [true, null] }
    const event = record(snapshot, { ...RECORDING, redaction: { mode: "digest_only" } })
    expect((items(event.snapshot)[0] as Item)["body"]).toEqual({
      redacted: "digest_only",
      content_sha256: sha256('{"a":[true,null],"b":1}'),
      token_counts: {},
    })
  })

  it("redacts what a rejected snapshot submitted", () => {
    const event = record(read("conformance/rejections/schema-missing-budget/snapshot.json"), {
      ...RECORDING,
      redaction: { mode: "digest_only" },
    })
    expectValid(event)
    for (const item of items(event.rejection!.snapshot) as Item[]) {
      expect((item["body"] as Item)["redacted"]).toBe("digest_only")
    }
  })
})

describe("the vault (ADR-0009)", () => {
  const VAULT = { base: "https://dashboard.example/api" }
  // Every content_sha256 a redacted snapshot holds, bodies and variant bodies, in order.
  const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)
  const digests = (snapshot: unknown) =>
    items(snapshot)
      .filter(object)
      .flatMap((item) => [
        item["body"],
        ...(Array.isArray(item["variants"]) ? item["variants"] : [])
          .filter(object)
          .map((v) => v["body"]),
      ])
      .filter(object)
      .map((body) => body["content_sha256"] as string)

  it("names the vault in an event of a route opted into it, under either redaction", () => {
    const snapshot = read("conformance/cases/budget-variant-choice/snapshot.json")
    for (const mode of ["digest_only", "pii_scrubbed"] as const) {
      const event = record(snapshot, { ...RECORDING, redaction: { mode }, vault: VAULT })
      expectValid(event)
      expect(event.vault).toEqual(VAULT)
    }
    expect(
      record(snapshot, { ...RECORDING, redaction: { mode: "digest_only" } }).vault,
    ).toBeUndefined()
  })

  it("refuses the vault for a route under full, whose bodies are in its events", () => {
    const snapshot = read("conformance/cases/budget-variant-choice/snapshot.json")
    expect(() => record(snapshot, { ...RECORDING, vault: VAULT })).toThrow(/full/)
  })

  it("deposits exactly the bytes each digest covers, every body and variant body once", () => {
    for (const path of [
      ...dirs("conformance/cases").map((id) => `conformance/cases/${id}`),
      ...dirs("conformance/rejections").map((id) => `conformance/rejections/${id}`),
    ]) {
      const snapshot = read(`${path}/snapshot.json`)
      const deposits = bodyDeposits(snapshot)
      for (const deposit of deposits) {
        expect(sha256(Buffer.from(deposit.text, "utf8")), path).toBe(deposit.sha256)
        expect(["text/plain; charset=utf-8", "application/json"]).toContain(deposit.media_type)
      }
      const event = record(snapshot, { ...RECORDING, redaction: { mode: "digest_only" } })
      const redacted = event.snapshot ?? event.rejection?.snapshot
      expect(
        deposits.map((d) => d.sha256),
        path,
      ).toEqual([...new Set(digests(redacted))])
    }
  })

  it("deposits a body that is not a string as its RFC 8785 serialization, and a repeated one once", () => {
    const snapshot = {
      tokenizer: "estimate-utf8",
      batches: [
        {
          items: [
            { id: "a", body: { b: 1, a: [2, "x"] } },
            { id: "b", body: "text" },
            { id: "c", body: "text", variants: [{ body: { a: [2, "x"], b: 1 } }] },
          ],
        },
      ],
    }
    expect(bodyDeposits(snapshot).map(({ media_type, text }) => ({ media_type, text }))).toEqual([
      { media_type: "application/json", text: '{"a":[2,"x"],"b":1}' },
      { media_type: "text/plain; charset=utf-8", text: "text" },
    ])
  })
})

describe("ulid", () => {
  it("encodes the time in its first ten characters, so ids sort by time", () => {
    const random = () => 0.5
    const early = ulid(Date.parse("2026-10-15T09:30:00.000Z"), random)
    const late = ulid(Date.parse("2026-10-15T09:30:00.001Z"), random)
    expect(early).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(early < late).toBe(true)
    expect(early.slice(10)).toBe(late.slice(10))
  })

  it("is the same for the same time and randomness", () => {
    let seed = 7
    const next = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const a = ulid(0, next)
    seed = 7
    expect(ulid(0, next)).toBe(a)
  })
})
