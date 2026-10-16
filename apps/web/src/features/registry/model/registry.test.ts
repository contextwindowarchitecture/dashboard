import { readFileSync } from "node:fs"
import { join } from "node:path"

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { EventsIndexV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { promotable, registryModel } from "./registry"

const index = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "events/index.json"), "utf8"),
) as EventsIndexV1
const rows = index.events
const model = registryModel(REGISTRY, rows)
const pinnedPolicy = (route: string, version: string) =>
  REGISTRY.lock.route_policies.find((e) => e.route === route && e.version === version)!.sha256

describe("registryModel", () => {
  it("lists every route policy and profile the registry holds, with the lock's digest", () => {
    expect(model.policies.map((p) => `${p.route} ${p.version}`)).toEqual(
      REGISTRY.route_policies.map((p) => `${p.route} ${p.version}`),
    )
    expect(model.profiles.map((p) => `${p.id} v${p.version}`)).toEqual(
      REGISTRY.profiles.map((p) => `${p.id} v${p.version}`),
    )
    for (const entry of model.policies)
      expect(entry.sha256).toBe(pinnedPolicy(entry.route, entry.version))
  })

  it("counts the events that ran each entry, pinned and drifted apart", () => {
    for (const entry of model.policies) {
      const ran = rows.filter(
        (r) => r.route === entry.route && r.route_policy_version === entry.version,
      )
      expect(entry.usage.events, `${entry.route} ${entry.version}`).toBe(ran.length)
      expect(entry.usage.pinned).toBe(
        ran.filter((r) => r.route_policy_sha256 === entry.sha256).length,
      )
      expect(entry.usage.pinned + entry.usage.drifted).toBe(entry.usage.events)
    }
    for (const entry of model.profiles) {
      const ran = rows.filter(
        (r) => r.profile?.id === entry.id && r.profile.version === entry.version,
      )
      expect(entry.usage.events, entry.id).toBe(ran.length)
    }
  })

  it("names every event that ran a pinned identity with other content", () => {
    const canary = rows.filter((r) => r.service === "support-assistant-canary")
    expect(canary.length).toBeGreaterThan(0)
    expect(model.drift.map((d) => d.event_id)).toEqual(
      expect.arrayContaining(canary.map((r) => r.event_id)),
    )
    for (const d of model.drift) {
      const row = rows.find((r) => r.event_id === d.event_id)!
      if (d.kind === "route_policy") {
        expect(row.route_policy_sha256).not.toBe(
          pinnedPolicy(row.route!, row.route_policy_version!),
        )
      }
    }
    const illustrative = model.policies.find(
      (p) => p.route === "support-chat" && p.version === "illustrative/v1",
    )!
    expect(illustrative.usage.drifted).toBe(canary.length)
  })

  it("lists the identities the events ran that the registry does not hold, and only those", () => {
    const held = new Set(REGISTRY.route_policies.map((p) => `${p.route} ${p.version}`))
    const ran = new Set(
      rows.flatMap((r) => (r.route ? [`${r.route} ${r.route_policy_version}`] : [])),
    )
    expect(model.unregisteredPolicies.map((u) => `${u.route} ${u.version}`).sort()).toEqual(
      [...ran].filter((k) => !held.has(k)).sort(),
    )
    for (const u of model.unregisteredPolicies) expect(u.events).toBeGreaterThan(0)
  })

  it("finds the route policy each profile binds (R-20)", () => {
    for (const entry of model.profiles) {
      expect(entry.binds?.version, entry.id).toBe(entry.profile.route_policy_version)
      expect(entry.binds?.route).toBe(entry.profile.route)
    }
    const orphan = registryModel(
      {
        ...REGISTRY,
        profiles: [{ ...REGISTRY.profiles[0]!, route_policy_version: "missing/v9" }],
      },
      rows,
    )
    expect(orphan.profiles[0]!.binds).toBeUndefined()
  })
})

describe("promotable (R-19)", () => {
  const draft = REGISTRY.profiles[0]!
  const evaluated = {
    ...draft,
    model_family: "example-model/2026-09",
    evaluation: {
      status: "evaluated",
      suite: "support-chat-eval/v3",
      date: "2026-10-01",
      result: "passed",
      artifact: "s3://evals/support-chat/v3/run-12",
    },
  } as unknown as typeof draft

  it("is false for every published profile, all of them unevaluated drafts", () => {
    for (const profile of REGISTRY.profiles) expect(promotable(profile), profile.id).toBe(false)
  })

  it("needs a concrete model family and an evaluation with suite, date, result and artifact", () => {
    expect(promotable(evaluated)).toBe(true)
    expect(promotable({ ...evaluated, model_family: null } as typeof draft)).toBe(false)
    for (const field of ["suite", "date", "result", "artifact"]) {
      const evaluation = { ...(evaluated.evaluation as object), [field]: null }
      expect(promotable({ ...evaluated, evaluation } as unknown as typeof draft), field).toBe(false)
    }
  })
})
