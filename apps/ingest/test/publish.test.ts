// What Publish writes (ADR-0014): the author by name, and by login where the issuer gives one, with
// the issuer's subject kept in the table.

import { REGISTRY } from "@cwa-dashboard/contract/registry"
import type { DraftV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { pullBody } from "../src/publish.ts"

const PROFILE = REGISTRY.profiles[0]!
const DRAFT: DraftV1 = {
  $schema: "cwa-dashboard/draft/v1",
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  kind: "profile",
  started_from: null,
  route: PROFILE.route,
  document: PROFILE,
  updated_at: "2026-10-17T12:00:00.000Z",
}
const body = (author: { name: string; subject: string; username?: string }) =>
  pullBody({
    draft: DRAFT,
    author,
    tenant: "default",
    path: "profiles/x/1.json",
    shadow: { kind: "not-asked" },
  })

describe("the pull request's author", () => {
  it("is named by login where the issuer gives one", () => {
    expect(body({ name: "Ada Lovelace", subject: "s-1", username: "ada-l" })).toContain(
      "by **Ada Lovelace** (@ada-l), from nothing in the registry.",
    )
  })

  it("is named alone where it does not, the subject kept in the table", () => {
    const text = body({ name: "Ada Lovelace", subject: "s-1" })
    expect(text).toContain("by **Ada Lovelace**, from nothing in the registry.")
    expect(text).not.toContain("@")
    expect(text).toContain("| Author's subject | `s-1` |")
  })

  it("never mentions a login GitHub would not link", () => {
    expect(body({ name: "Ada", subject: "s-1", username: "ada lovelace <x>" })).toContain(
      "by **Ada**, from",
    )
  })
})
