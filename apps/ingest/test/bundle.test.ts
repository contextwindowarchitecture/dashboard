// The compliance bundle (dashboard-plan.md DP-11): what a dashboard can show about one call, signed
// so it can be checked without the dashboard, by deploy/verify-bundle.mjs and Node's crypto alone.

import { spawnSync } from "node:child_process"
import { generateKeyPairSync, sign } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import type { AssemblyEventV1, EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { canonicalJson } from "@cwa-dashboard/telemetry/canonical"
import { validateComplianceBundleV1 } from "@cwa-dashboard/telemetry/validators"
import { afterAll, describe, expect, it } from "vitest"

import { buildBundle, signingKeyFrom } from "../src/bundle.ts"
import { replay } from "../src/replay.ts"

const TREE = resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures")
const VERIFY = resolve(import.meta.dirname, "../../../deploy/verify-bundle.mjs")
const event = (id: string) =>
  JSON.parse(readFileSync(join(TREE, "events", `${id}.json`), "utf8")) as AssemblyEventV1
const index = JSON.parse(readFileSync(join(TREE, "events/index.json"), "utf8")) as EventsIndexV1
const first = (test: (row: EventsIndexV1["events"][number]) => boolean) =>
  event(index.events.find(test)!.event_id)

const pemOf = () =>
  generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString()
const KEY = signingKeyFrom(pemOf())
const OTHER = signingKeyFrom(pemOf())
const run = async (snapshot: unknown) => replay(snapshot)
const AT = "2026-10-17T12:00:00.000Z"

const dir = mkdtempSync(join(tmpdir(), "cwa-bundle-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
function verify(bundle: unknown, publicPem: string) {
  writeFileSync(join(dir, "bundle.json"), JSON.stringify(bundle))
  writeFileSync(join(dir, "key.pem"), publicPem)
  return spawnSync(process.execPath, [VERIFY, join(dir, "bundle.json"), join(dir, "key.pem")], {
    encoding: "utf8",
  })
}

describe("the compliance bundle", () => {
  it("replays a full, assembled event to the hash it recorded, and is valid", async () => {
    const recorded = first((r) => r.outcome === "assembled" && r.redaction_mode === "full")
    const bundle = await buildBundle(recorded, run, KEY, AT)
    expect(validateComplianceBundleV1(bundle) ? null : validateComplianceBundleV1.errors).toBeNull()
    expect(bundle.replay).toMatchObject({
      status: "match",
      outcome: "assembled",
      payload_hash: recorded.payload!.hash,
      recorded_hash: recorded.payload!.hash,
    })
    expect(bundle.event).toEqual(recorded)
    expect(bundle.implementation.language).toBe(recorded.assembler.language)
    expect(bundle.implementation.report).not.toBeNull()
    expect(bundle.contract.event).toEqual(recorded.contract)
    expect(bundle.contract.same_commit).toBe(
      recorded.contract.commit === bundle.contract.dashboard.commit,
    )
  })

  it("replays a full refusal to the same refusal", async () => {
    const refused = first((r) => r.outcome === "refused" && r.redaction_mode === "full")
    const bundle = await buildBundle(refused, run, KEY, AT)
    expect(bundle.replay).toMatchObject({ status: "match", outcome: "refused", payload_hash: null })
  })

  it("says the replay differs when the recorded hash is not the one it reproduces", async () => {
    const recorded = first((r) => r.outcome === "assembled" && r.redaction_mode === "full")
    const other = { ...recorded, payload: { ...recorded.payload!, hash: "0".repeat(64) } }
    const bundle = await buildBundle(other, run, KEY, AT)
    expect(bundle.replay.status).toBe("differ")
    expect(bundle.replay.note).toMatch(/non-conformant, not which/)
  })

  it("claims nothing for a redacted or a rejected snapshot, and says why", async () => {
    for (const [test, why] of [
      [(r: EventsIndexV1["events"][number]) => r.redaction_mode === "pii_scrubbed", /redacted/],
      [(r: EventsIndexV1["events"][number]) => r.redaction_mode === "digest_only", /redacted/],
      [
        (r: EventsIndexV1["events"][number]) => r.outcome === "rejected",
        /rejected before assembly/,
      ],
    ] as const) {
      const bundle = await buildBundle(first(test), run, KEY, AT)
      expect(bundle.replay.status).toBe("not-replayed")
      expect(bundle.replay.note).toMatch(why)
      expect(
        validateComplianceBundleV1(bundle) ? null : validateComplianceBundleV1.errors,
      ).toBeNull()
    }
  })

  it("verifies offline with its key, and fails tampered or under another key", async () => {
    const bundle = await buildBundle(
      first((r) => r.outcome === "assembled"),
      run,
      KEY,
      AT,
    )
    const good = verify(bundle, KEY.publicPem)
    expect(good.stdout + good.stderr).toMatch(/valid/)
    expect(good.status).toBe(0)
    const tampered = {
      ...bundle,
      event: { ...bundle.event, recorded_at: "2026-01-01T00:00:00.000Z" },
    }
    expect(verify(tampered, KEY.publicPem).status).toBe(1)
    expect(verify(bundle, OTHER.publicPem).status).toBe(1)
    expect(bundle.signature.key_id).toBe(KEY.keyId)
  })

  it("serializes as the package does, so the verifier agrees on keys any order or script would upset", () => {
    const awkward = { é: 1, z: { Z: [2, "ü", { b: null, a: true }] }, A: -0.5, "": "empty" }
    const value = sign(null, Buffer.from(canonicalJson(awkward), "utf8"), KEY.privateKey).toString(
      "base64",
    )
    const result = verify(
      { ...awkward, signature: { algorithm: "Ed25519", key_id: KEY.keyId, value } },
      KEY.publicPem,
    )
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
  })
})
