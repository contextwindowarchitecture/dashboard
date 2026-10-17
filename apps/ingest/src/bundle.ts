// The compliance bundle (dashboard-plan.md DP-11; P2-D6): what the dashboard can show about one
// assemble() call, signed so it can be checked without the dashboard. It holds the event as stored,
// the contract it ran against beside the one the dashboard's lock pins, the published conformance
// report of its language, and a replay of its snapshot through the pinned assembler with what that
// does and does not prove (the sandbox's rules: parity is claimed for a full event only, and a
// difference means one of two assemblers is non-conformant, not which). The signature is Ed25519
// over the RFC 8785 serialization of the bundle without its signature; deploy/verify-bundle.mjs
// checks it offline.

import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto"
import { readFileSync } from "node:fs"

import { BUILT_ASSEMBLER } from "@cwa-dashboard/assembler"
import { IMPLEMENTATIONS } from "@cwa-dashboard/contract/implementations"
import { canonicalJson } from "@cwa-dashboard/telemetry/canonical"
import type { AssemblyEventV1, ComplianceBundleV1 } from "@cwa-dashboard/telemetry/types"

import type { ReplayResult } from "./replay.ts"

export interface SigningKey {
  readonly privateKey: KeyObject
  readonly publicPem: string
  /** The SHA-256 of the public key's SubjectPublicKeyInfo DER, lowercase hex. */
  readonly keyId: string
}

/** The signing key from a PKCS #8 PEM; anything but an Ed25519 key is refused. */
export function signingKeyFrom(pem: string): SigningKey {
  const privateKey = createPrivateKey(pem)
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw new Error("SIGNING_KEY must be an Ed25519 key")
  const publicKey = createPublicKey(privateKey)
  const der = publicKey.export({ type: "spki", format: "der" })
  return {
    privateKey,
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    keyId: createHash("sha256").update(der).digest("hex"),
  }
}

const LOCK_BYTES = readFileSync(
  new URL("../../../packages/contract/vendor/cwa.lock.json", import.meta.url),
)
const LOCK = JSON.parse(LOCK_BYTES.toString("utf8")) as { repository: string; spec_commit: string }
const DASHBOARD_LOCK = {
  repository: LOCK.repository,
  commit: LOCK.spec_commit,
  lock_sha256: createHash("sha256").update(LOCK_BYTES).digest("hex"),
}

type Replay = ComplianceBundleV1["replay"]
const ASSEMBLER = {
  language: BUILT_ASSEMBLER.language,
  name: BUILT_ASSEMBLER.name,
  version: BUILT_ASSEMBLER.version,
}

async function replayOf(
  event: AssemblyEventV1,
  run: (snapshot: unknown) => Promise<ReplayResult>,
): Promise<Replay> {
  if (event.outcome === "rejected" || event.snapshot === undefined) {
    return {
      assembler: ASSEMBLER,
      status: "not-replayed",
      note: "The snapshot was rejected before assembly, so there is no decision to reproduce.",
    }
  }
  if (event.redaction_mode !== "full") {
    return {
      assembler: ASSEMBLER,
      status: "not-replayed",
      note: `The bodies were redacted (${event.redaction_mode}) before the event left the service, so its snapshot is not the one assembled, and a replay would prove nothing about the recorded decision.`,
    }
  }
  const who = `The dashboard's ${ASSEMBLER.language} assembler ${ASSEMBLER.version}`
  const across =
    event.assembler.language === ASSEMBLER.language
      ? ""
      : ` The event was recorded by the ${event.assembler.language} assembler, so this is a cross-implementation check.`
  const differs = (what: string): Replay => ({
    assembler: ASSEMBLER,
    status: "differ",
    note: `${who} ${what}: one of the two assemblers is non-conformant, not which.${across}`,
  })
  const result = await run(event.snapshot)
  if (result.status === 422) {
    return {
      assembler: ASSEMBLER,
      status: "not-replayed",
      note: `${who} does not provide a component the snapshot names: ${result.body.problems.join("; ")}`,
    }
  }
  if (result.status === 400)
    return { ...differs("rejected the snapshot the service assembled"), outcome: "rejected" }
  const { outcome, payload_hash, trace } = result.body
  const recorded = event.payload?.hash ?? null
  const base = { assembler: ASSEMBLER, outcome, payload_hash, recorded_hash: recorded }
  if (event.outcome === "assembled" && outcome === "assembled" && payload_hash === recorded) {
    return {
      ...base,
      status: "match",
      note: `${who} reproduced the recorded payload hash.${across}`,
    }
  }
  const replayedReason = (trace as { refused?: { reason?: string } }).refused?.reason
  if (
    event.outcome === "refused" &&
    outcome === "refused" &&
    replayedReason === event.trace?.refused.reason
  ) {
    return {
      ...base,
      status: "match",
      note: `${who} refused it for the same reason, ${replayedReason}.${across}`,
    }
  }
  return { ...base, ...differs("decided otherwise than the event records") }
}

export async function buildBundle(
  event: AssemblyEventV1,
  run: (snapshot: unknown) => Promise<ReplayResult>,
  key: SigningKey,
  generatedAt: string,
): Promise<ComplianceBundleV1> {
  const report = IMPLEMENTATIONS.find((i) => i.id === event.assembler.language)?.report ?? null
  const unsigned = {
    $schema: "cwa-dashboard/compliance-bundle/v1" as const,
    generated_at: generatedAt,
    event,
    contract: {
      event: { ...event.contract },
      dashboard: DASHBOARD_LOCK,
      same_commit: event.contract.commit === DASHBOARD_LOCK.commit,
      same_lock: event.contract.lock_sha256 === DASHBOARD_LOCK.lock_sha256,
    },
    implementation: { language: event.assembler.language, report },
    replay: await replayOf(event, run),
  }
  const value = sign(null, Buffer.from(canonicalJson(unsigned), "utf8"), key.privateKey)
  return {
    ...unsigned,
    signature: { algorithm: "Ed25519", key_id: key.keyId, value: value.toString("base64") },
  } as ComplianceBundleV1
}
