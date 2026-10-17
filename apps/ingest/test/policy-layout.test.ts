// A policy repository's layout (ADR-0014): a file's path is its identity, from the document's route
// (or id) and version; a path names what the file must hold; a version is safe path segments only.
// Over the registry's own entries.

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import { describe, expect, it } from "vitest"

import { checkFile, fileText, identityOf, policyPath } from "../src/policy-layout.ts"

const POLICY = REGISTRY.route_policies.find((p) => p.version === "illustrative/v1")!
const PROFILE = REGISTRY.profiles[0]!

describe("where a document belongs", () => {
  it("puts a route policy under its route and version, and a profile under its id and version", () => {
    expect(policyPath("route_policy", POLICY)).toEqual({
      ok: true,
      path: `route-policies/${POLICY.route}/illustrative/v1.json`,
    })
    expect(policyPath("profile", PROFILE)).toEqual({
      ok: true,
      path: `profiles/${PROFILE.id}/${PROFILE.version}.json`,
    })
  })

  it("refuses a name or a version that is not safe path segments", () => {
    for (const version of ["../v1", "v1/..", "a//b", "", "/v1", "v 1", "v1/"]) {
      const placed = policyPath("route_policy", { ...POLICY, version })
      expect(placed.ok, version).toBe(false)
    }
    expect(policyPath("route_policy", { ...POLICY, route: "a/b" }).ok).toBe(false)
    expect(policyPath("profile", { ...PROFILE, id: ".." }).ok).toBe(false)
    expect(policyPath("profile", { ...PROFILE, version: "1" }).ok).toBe(false)
    expect(policyPath("profile", { ...PROFILE, version: 1.5 }).ok).toBe(false)
    expect(policyPath("route_policy", null)).toEqual({
      ok: false,
      problem: "A route policy names its route and its version.",
    })
  })
})

describe("what a path names", () => {
  it("reads the kind, the name and the version back from a path", () => {
    expect(identityOf("route-policies/support-chat/illustrative/v1.json")).toEqual({
      kind: "route_policy",
      name: "support-chat",
      version: "illustrative/v1",
    })
    expect(identityOf("profiles/cache-first-chat/2.json")).toEqual({
      kind: "profile",
      name: "cache-first-chat",
      version: 2,
    })
    for (const path of [
      "README.md",
      "route-policies/support-chat.json",
      "profiles/cache-first-chat/v2.json",
      "profiles/a/b/1.json",
      "profiles/cache-first-chat/01.json",
      "route-policies/support-chat/../v1.json",
      "other/support-chat/v1.json",
    ]) {
      expect(identityOf(path), path).toBeUndefined()
    }
  })
})

describe("a file in the repository", () => {
  it("holds what its path names", () => {
    const path = `profiles/${PROFILE.id}/${PROFILE.version}.json`
    expect(checkFile(path, PROFILE)).toEqual([])
    expect(checkFile(path, { ...PROFILE, version: PROFILE.version + 1 })).toEqual([
      `${path}: version is ${PROFILE.version + 1}, the path says ${PROFILE.version}`,
    ])
    expect(checkFile(`profiles/other/${PROFILE.version}.json`, PROFILE)).toEqual([
      `profiles/other/${PROFILE.version}.json: id is ${PROFILE.id}, the path says other`,
    ])
    expect(checkFile("route-policies/x.json", POLICY)).toEqual([
      "route-policies/x.json: not where a route policy or a profile belongs (route-policies/<route>/<version>.json, profiles/<id>/<version>.json)",
    ])
  })

  it("is written as two-space JSON ending in a newline", () => {
    expect(fileText({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}\n')
  })
})
