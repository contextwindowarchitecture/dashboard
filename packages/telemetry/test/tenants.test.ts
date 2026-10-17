// The tenants document (ADR-0012) and the corpus's tenant: what a store lists and what a corpus
// belongs to.

import { describe, expect, it } from "vitest"

import { validateCorpusV1, validateTenantsV1 } from "../generated/validators.js"

const ok = (validate: typeof validateTenantsV1, value: unknown) =>
  expect(validate(value) ? null : validate.errors).toBeNull()

describe("tenants v1", () => {
  it("lists each tenant with its events", () => {
    ok(validateTenantsV1, {
      $schema: "cwa-dashboard/tenants/v1",
      tenants: [
        { tenant: "default", events: 112 },
        { tenant: "northwind", events: 5 },
      ],
    })
  })

  it("refuses a tenant name a store would not keep, and a negative count", () => {
    expect(
      validateTenantsV1({
        $schema: "cwa-dashboard/tenants/v1",
        tenants: [{ tenant: "A B", events: 1 }],
      }),
    ).toBe(false)
    expect(
      validateTenantsV1({
        $schema: "cwa-dashboard/tenants/v1",
        tenants: [{ tenant: "a", events: -1 }],
      }),
    ).toBe(false)
  })
})

describe("corpus v1: its tenant", () => {
  const corpus = {
    $schema: "cwa-dashboard/corpus/v1",
    name: "chat",
    created_at: "2026-10-17T12:00:00.000Z",
    events: [{ event_id: "01M4YYWX40M0GZY8KQDZEF4C74" }],
  }
  it("belongs to a tenant, the default when it names none", () => {
    ok(validateCorpusV1 as never, { ...corpus, tenant: "northwind" })
    ok(validateCorpusV1 as never, corpus)
    expect(validateCorpusV1({ ...corpus, tenant: "Not Ok" })).toBe(false)
  })
})
