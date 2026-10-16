// The registry lock's digests (conformance/README.md, Registry; schema/registry_lock.schema.json):
// the lowercase SHA-256 of the RFC 8785 serialization of a whole route policy, and of a profile
// without its evaluation member. The index records them for each event, so a page can tell an
// event that ran a pinned entry from one whose content drifted under the same version (R-20).

import { createHash } from "node:crypto"

import { canonicalJson } from "./canonical.ts"

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")

export const routePolicyDigest = (policy: object) => sha256(canonicalJson(policy))

export function profileDigest(profile: object) {
  const { evaluation: _evaluation, ...pinned } = profile as Record<string, unknown>
  return sha256(canonicalJson(pinned))
}
