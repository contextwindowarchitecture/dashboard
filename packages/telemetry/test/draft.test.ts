// The draft document (ADR-0013): a route policy or a profile in the making, what it started from,
// and when it was last saved; the document itself may be invalid, as work in progress is.

import { describe, expect, it } from "vitest"

import { validateDraftV1 } from "../generated/validators.js"

const DRAFT = {
  $schema: "cwa-dashboard/draft/v1",
  id: "d3b07384-d9a0-4c9f-8e1b-1f2c3a4b5c6d",
  kind: "profile",
  started_from: { profile: { id: "cache-first-chat", version: 1 } },
  route: "support-chat",
  document: { id: "cache-first-chat", version: 2, route: "support-chat" },
  updated_at: "2026-10-17T12:00:00.000Z",
}

describe("draft v1", () => {
  it("holds a profile or a route policy in the making, valid or not, and where it started", () => {
    expect(validateDraftV1(DRAFT) ? null : validateDraftV1.errors).toBeNull()
    expect(
      validateDraftV1({
        ...DRAFT,
        kind: "route_policy",
        started_from: { route_policy: { route: "support-chat", version: "illustrative/v1" } },
      }),
    ).toBe(true)
    expect(validateDraftV1({ ...DRAFT, started_from: null })).toBe(true)
  })

  it("refuses another kind, an id that could name a path, and a route no policy could have", () => {
    expect(validateDraftV1({ ...DRAFT, kind: "trace" })).toBe(false)
    expect(validateDraftV1({ ...DRAFT, id: "../x" })).toBe(false)
    expect(validateDraftV1({ ...DRAFT, route: "" })).toBe(false)
  })
})
