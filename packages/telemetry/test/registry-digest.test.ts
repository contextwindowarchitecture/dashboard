import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { profileDigest, routePolicyDigest } from "../src/registry-digest.ts"

const registry = resolve(import.meta.dirname, "../../contract/vendor/cwa/conformance/registry")
const read = <T>(name: string) => JSON.parse(readFileSync(resolve(registry, name), "utf8")) as T

type Entry = { sha256: string }
const lock = read<{
  profiles: (Entry & { id: string; version: number })[]
  route_policies: (Entry & { route: string; version: string })[]
}>("lock.json")

describe("the registry digests", () => {
  it("reproduce every route policy digest the vendored lock pins", () => {
    const policies = read<{ route: string; version: string }[]>("route-policies.json")
    expect(policies.length).toBe(lock.route_policies.length)
    for (const policy of policies) {
      const pinned = lock.route_policies.find(
        (e) => e.route === policy.route && e.version === policy.version,
      )!
      expect(routePolicyDigest(policy), `${policy.route} ${policy.version}`).toBe(pinned.sha256)
    }
  })

  it("reproduce every profile digest the vendored lock pins, the evaluation left out", () => {
    const profiles = read<{ id: string; version: number; evaluation: unknown }[]>("profiles.json")
    expect(profiles.length).toBe(lock.profiles.length)
    for (const profile of profiles) {
      const pinned = lock.profiles.find(
        (e) => e.id === profile.id && e.version === profile.version,
      )!
      expect(profileDigest(profile), profile.id).toBe(pinned.sha256)
      expect(profileDigest({ ...profile, evaluation: { status: "passed" } })).toBe(pinned.sha256)
    }
  })
})
