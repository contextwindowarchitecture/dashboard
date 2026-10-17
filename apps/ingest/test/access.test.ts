// The access file and what it grants (ADR-0011): roles by anonymity, sign-in and group, their
// union; and an event's bodies withheld from a reader who does not own its route, over real demo
// events in every redaction mode.

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { canonicalJson } from "@cwa-dashboard/telemetry/canonical"
import { validateAssemblyEventV1 } from "@cwa-dashboard/telemetry/validators"
import { describe, expect, it } from "vitest"

import { accessFrom, mayOwn, mayRead, rolesOf, withholdBodies } from "../src/access.ts"
import { DEMO_EVENTS } from "./store-contract.ts"

const ACCESS = accessFrom({
  anonymous: [],
  signed_in: ["viewer"],
  groups: {
    "cwa:owners": ["owner:support-chat"],
    "cwa:auditors": ["auditor"],
    "cwa:all": ["owner:*"],
  },
})

describe("accessFrom", () => {
  it("refuses a role it does not know, a key it does not know, and a group with no roles listed", () => {
    expect(() => accessFrom({ anonymous: ["admin"] })).toThrow(/admin/)
    expect(() => accessFrom({ anonymous: [], everyone: [] })).toThrow(/everyone/)
    expect(() => accessFrom({ groups: { x: "viewer" } })).toThrow(/groups\.x/)
    expect(() => accessFrom({ anonymous: ["owner:"] })).toThrow(/owner:/)
  })

  it("defaults what it is not given to nothing", () => {
    expect(rolesOf(accessFrom({}), undefined)).toEqual(new Set())
  })
})

describe("rolesOf", () => {
  it("unites what anonymity, sign-in and every group grant, so signing in never narrows", () => {
    const open = accessFrom({ anonymous: ["viewer", "owner:*"], signed_in: [] })
    expect(rolesOf(open, { groups: [] })).toEqual(new Set(["viewer", "owner:*"]))
    expect(rolesOf(ACCESS, undefined)).toEqual(new Set())
    expect(rolesOf(ACCESS, { groups: ["cwa:owners", "cwa:auditors", "elsewhere"] })).toEqual(
      new Set(["viewer", "owner:support-chat", "auditor"]),
    )
  })

  it("lets every role read what a viewer reads, and only owners own", () => {
    for (const role of [
      "viewer",
      "auditor",
      "operator",
      "owner:support-chat",
      "owner:*",
    ] as const) {
      expect(mayRead(new Set([role])), role).toBe(true)
    }
    expect(mayRead(new Set())).toBe(false)
    expect(mayOwn(new Set(["owner:support-chat"]), "support-chat")).toBe(true)
    expect(mayOwn(new Set(["owner:support-chat"]), "extract")).toBe(false)
    expect(mayOwn(new Set(["owner:*"]), "extract")).toBe(true)
    expect(mayOwn(new Set(["auditor", "operator", "viewer"]), "support-chat")).toBe(false)
  })
})

describe("withholdBodies", () => {
  const sha = (body: unknown) =>
    createHash("sha256")
      .update(typeof body === "string" ? body : canonicalJson(body))
      .digest("hex")
  const bodies = (event: (typeof DEMO_EVENTS)[number]) =>
    (event.snapshot ?? (event.rejection?.snapshot as typeof event.snapshot))!.batches.flatMap((b) =>
      (b.items as Record<string, unknown>[]).flatMap((i) => [
        // A conformance case's item may lack a body; there is nothing to withhold.
        ...("body" in i ? [i["body"]] : []),
        ...((i["variants"] as Record<string, unknown>[] | undefined) ?? [])
          .filter((v) => "body" in v)
          .map((v) => v["body"]),
      ]),
    )

  it("withholds every body with its digest, in every mode, and keeps the mode and every other field", () => {
    for (const mode of ["full", "pii_scrubbed", "digest_only"] as const) {
      const event = DEMO_EVENTS.find((e) => e.redaction_mode === mode && e.snapshot !== undefined)!
      const served = withholdBodies(event)
      expect(
        validateAssemblyEventV1(served) ? null : validateAssemblyEventV1.errors,
        mode,
      ).toBeNull()
      expect(served.redaction_mode).toBe(mode)
      const before = bodies(event)
      const after = bodies(served)
      expect(after).toEqual(
        before.map((body) => ({
          withheld: "role",
          content_sha256:
            typeof body === "object" && body !== null && "content_sha256" in body
              ? (body as { content_sha256: string }).content_sha256
              : sha(body),
        })),
      )
      // Everything but the bodies is the same.
      const blank = (e: typeof event) => {
        const copy = structuredClone(e)
        for (const batch of copy.snapshot!.batches)
          for (const item of batch.items as Record<string, unknown>[]) {
            item["body"] = null
            for (const v of (item["variants"] as Record<string, unknown>[] | undefined) ?? [])
              v["body"] = null
          }
        return copy
      }
      expect(blank(served)).toEqual(blank(event))
    }
  })

  it("never changes the event it is given", () => {
    // Its own copy, from disk: the shared demo events may have passed through other tests.
    const id = DEMO_EVENTS.find(
      (e) => e.redaction_mode === "full" && e.snapshot !== undefined,
    )!.event_id
    const event = JSON.parse(
      readFileSync(
        join(import.meta.dirname, `../../../packages/demo-traffic/fixtures/events/${id}.json`),
        "utf8",
      ),
    ) as (typeof DEMO_EVENTS)[number]
    const before = JSON.stringify(event)
    withholdBodies(event)
    expect(JSON.stringify(event)).toBe(before)
  })
})

describe("the repository's access files", () => {
  // A typo here would stop the service at start; better to stop the tests.
  const ROOT = join(import.meta.dirname, "../../..")
  for (const path of ["deploy/overlays/prod-sign-in/access.json", "apps/web/e2e/access.json"]) {
    it(`${path} is one the service reads`, () => {
      expect(() => accessFrom(JSON.parse(readFileSync(join(ROOT, path), "utf8")))).not.toThrow()
    })
  }

  it("keeps the public demo open to anonymous readers, bodies and all (P3-D5)", () => {
    const live = accessFrom(
      JSON.parse(readFileSync(join(ROOT, "deploy/overlays/prod-sign-in/access.json"), "utf8")),
    )
    const anonymous = rolesOf(live, undefined)
    expect(mayRead(anonymous)).toBe(true)
    expect(mayOwn(anonymous, "support-chat")).toBe(true)
  })
})
