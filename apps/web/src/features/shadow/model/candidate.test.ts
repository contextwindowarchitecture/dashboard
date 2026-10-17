// The candidate the reader pastes: an object holding a route policy, a profile, or both, as the
// contract writes them; the registry's own to start from.

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import { describe, expect, it } from "vitest"

import { candidateChoices, candidateText, parseCandidate } from "./candidate"

describe("parseCandidate", () => {
  it("reads a route policy, a profile, or both", () => {
    const profile = REGISTRY.profiles[0]!
    expect(parseCandidate(JSON.stringify({ profile }))).toEqual({
      ok: true,
      candidate: { profile },
    })
    const route_policy = REGISTRY.route_policies[0]!
    expect(parseCandidate(JSON.stringify({ route_policy, profile }))).toEqual({
      ok: true,
      candidate: { route_policy, profile },
    })
  })

  it("says what is wrong with text that is not JSON", () => {
    const parsed = parseCandidate("{ profile")
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.message).toMatch(/^The candidate is not JSON/)
  })

  it("asks for a route_policy or a profile, as objects, and nothing else", () => {
    for (const text of ["[]", "{}", '{"profile": "cache-first-chat"}', '{"slots": {}}']) {
      const parsed = parseCandidate(text)
      expect(parsed.ok, text).toBe(false)
      expect(!parsed.ok && parsed.message, text).toMatch(/route_policy, a profile, or both/)
    }
    const listed = parseCandidate(JSON.stringify([{ profile: REGISTRY.profiles[0] }]))
    expect(!listed.ok && listed.message).not.toMatch(/also holds/)
    const extra = parseCandidate(JSON.stringify({ profile: REGISTRY.profiles[0], budget: {} }))
    expect(!extra.ok && extra.message).toMatch(/budget/)
  })
})

describe("candidateChoices", () => {
  it("offers every registry profile and route policy, by what the contract names them", () => {
    const choices = candidateChoices()
    expect(choices).toHaveLength(REGISTRY.profiles.length + REGISTRY.route_policies.length)
    const profile = REGISTRY.profiles[0]!
    const choice = choices.find((c) => c.value === `profile:${profile.id}@${profile.version}`)!
    expect(choice.label).toBe(`Profile ${profile.id} v${profile.version} · ${profile.route}`)
    expect(JSON.parse(candidateText(choice.value)!)).toEqual({ profile })
    const policy = REGISTRY.route_policies[0]!
    expect(JSON.parse(candidateText(`route_policy:${policy.route}@${policy.version}`)!)).toEqual({
      route_policy: policy,
    })
    expect(candidateText("profile:nothing@1")).toBeUndefined()
  })
})
