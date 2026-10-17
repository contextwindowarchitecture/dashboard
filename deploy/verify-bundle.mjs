#!/usr/bin/env node
// Verifies a CWA dashboard compliance bundle offline, with Node's crypto and nothing else: the
// Ed25519 signature over the RFC 8785 serialization of the bundle without its signature, under the
// given public key, and that the bundle names that key's id. Prints what it found; exits 1 unless the
// bundle is valid.
//
//   node deploy/verify-bundle.mjs <bundle.json> <public key PEM>
//
// The public key a dashboard signs with is served at <api base>/signing-key.pem.

import { createHash, createPublicKey, verify } from "node:crypto"
import { readFileSync } from "node:fs"

// RFC 8785: members sorted by their names' UTF-16 code units at every depth, no whitespace, strings
// and numbers as ECMAScript's JSON.stringify writes them. The same as @cwa-dashboard/telemetry's.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object" && value !== null) {
    const members = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    return `{${members.join(",")}}`
  }
  return JSON.stringify(value)
}

const [bundlePath, keyPath] = process.argv.slice(2)
if (!bundlePath || !keyPath) {
  process.stderr.write("usage: verify-bundle.mjs <bundle.json> <public key PEM>\n")
  process.exit(2)
}
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"))
const publicKey = createPublicKey(readFileSync(keyPath, "utf8"))
const keyId = createHash("sha256")
  .update(publicKey.export({ type: "spki", format: "der" }))
  .digest("hex")
const { signature, ...unsigned } = bundle

const problems = []
if (signature?.algorithm !== "Ed25519")
  problems.push(`the signature's algorithm is ${signature?.algorithm}, not Ed25519`)
if (signature?.key_id !== keyId)
  problems.push(`the bundle names key ${signature?.key_id}, not this key's ${keyId}`)
const ok =
  typeof signature?.value === "string" &&
  verify(
    null,
    Buffer.from(canonicalJson(unsigned), "utf8"),
    publicKey,
    Buffer.from(signature.value, "base64"),
  )
if (!ok)
  problems.push("the signature does not verify: the bundle was changed, or signed with another key")

if (problems.length > 0) {
  process.stderr.write(`verify-bundle: not valid:\n  ${problems.join("\n  ")}\n`)
  process.exit(1)
}
const replay = bundle.replay ?? {}
process.stdout.write(
  `verify-bundle: valid, signed by key ${keyId}\n` +
    `  event ${bundle.event?.event_id} (${bundle.event?.outcome}), contract ${bundle.contract?.event?.commit}` +
    ` (the dashboard's lock pins ${bundle.contract?.dashboard?.commit})\n` +
    `  replay: ${replay.status}: ${replay.note}\n`,
)
