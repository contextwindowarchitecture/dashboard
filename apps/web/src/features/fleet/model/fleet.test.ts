import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { FleetReportV1 } from "@cwa-dashboard/telemetry/types"
import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { caseRows, conformanceRows, REQUIRED, serviceRows } from "./fleet"

const fleet = JSON.parse(readFileSync(join(FIXTURES_DIR, "fleet.json"), "utf8")) as FleetReportV1

describe("REQUIRED", () => {
  it("is the contract's required tokenizers and renderers", () => {
    expect(REQUIRED).toEqual({
      tokenizers: ["fixture-whitespace/v1", "estimate-utf8/v1"],
      renderers: ["fixture-xml/v1", "cwa-messages/v1"],
    })
  })
})

describe("conformanceRows", () => {
  it("counts each implementation's cases and rejections by outcome", () => {
    const rows = conformanceRows(fleet)
    expect(rows.map((r) => r.language)).toEqual(fleet.implementations.map((i) => i.language))
    for (const [i, row] of rows.entries()) {
      const report = fleet.implementations[i]!.report
      const count = (list: { outcome: string }[] | undefined, outcome: string) =>
        (list ?? []).filter((c) => c.outcome === outcome).length
      expect(row.cases).toEqual({
        total: report.cases.length,
        passed: count(report.cases, "passed"),
        failed: count(report.cases, "failed"),
        skipped: count(report.cases, "skipped"),
      })
      expect(row.rejections).toEqual({
        total: report.rejections!.length,
        rejected: count(report.rejections, "rejected"),
        failed: count(report.rejections, "failed"),
        skipped: count(report.rejections, "skipped"),
      })
    }
  })

  it("says whether each ran against the contract the dashboard's lock pins", () => {
    for (const row of conformanceRows(fleet)) {
      expect(row.contractCommit).toMatch(/^[0-9a-f]{40}$/)
      expect(row.sameContract).toBe(row.contractCommit === fleet.contract.commit)
    }
  })

  it("has no rejection counts for a report that did not run them, since none count (R-17)", () => {
    const withoutRejections = structuredClone(fleet)
    delete (withoutRejections.implementations[0]!.report as { rejections?: unknown }).rejections
    expect(conformanceRows(withoutRejections)[0]!.rejections).toBeUndefined()
  })

  it("names the required tokenizers and renderers an implementation says it lacks, and none it never listed", () => {
    const rows = conformanceRows(fleet)
    const typescript = rows.find((r) => r.language === "typescript")!
    expect(typescript.missingRequired).toEqual([])
    expect(rows.find((r) => r.language === "go")!.missingRequired).toBeUndefined()
    const lacking = structuredClone(fleet)
    lacking.implementations.find((i) => i.language === "typescript")!.renderers = ["fixture-xml/v1"]
    expect(
      conformanceRows(lacking).find((r) => r.language === "typescript")!.missingRequired,
    ).toEqual(["cwa-messages/v1"])
  })
})

describe("caseRows", () => {
  const typescript = fleet.implementations.find((i) => i.language === "typescript")!

  it("lists cases and rejections, each with its outcome and rules", () => {
    const rows = caseRows(typescript)
    expect(rows).toHaveLength(typescript.report.cases.length + typescript.report.rejections!.length)
    expect(rows.filter((r) => r.kind === "rejection")).toHaveLength(
      typescript.report.rejections!.length,
    )
  })

  it("keeps only those that exercise a rule, when one is given", () => {
    const rows = caseRows(typescript, "R-26")
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.rules).toContain("R-26")
  })
})

describe("serviceRows", () => {
  it("compares each service's contract commit with the lock's, and keeps unmeasured latency unmeasured", () => {
    const rows = serviceRows(fleet)
    for (const [i, row] of rows.entries()) {
      const service = fleet.services[i]!
      expect(row.sameContract).toBe(service.contract_commit === fleet.contract.commit)
      if (service.latency_ms.samples === 0) expect(row.latency).toBeUndefined()
      else
        expect(row.latency).toEqual({
          samples: service.latency_ms.samples,
          p50: service.latency_ms.p50,
          p95: service.latency_ms.p95,
          p99: service.latency_ms.p99,
        })
    }
    const silent = structuredClone(fleet)
    silent.services[0]!.latency_ms = { samples: 0 }
    expect(serviceRows(silent)[0]!.latency).toBeUndefined()
  })
})
