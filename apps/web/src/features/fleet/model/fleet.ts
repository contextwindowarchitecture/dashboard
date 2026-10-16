// The fleet's view model (dashboard-plan.md 7.7): each implementation's published conformance run,
// counted by outcome, with the contract it ran against and the required tokenizers and renderers it
// says it lacks; each case with its rules; and each service's contract commit beside the one the
// dashboard's lock pins, with the latency its wrapper measured, or none where it measured none.

import { COMPONENTS } from "@cwa-dashboard/contract/data"
import type { FleetReportV1 } from "@cwa-dashboard/telemetry/types"

type Implementation = FleetReportV1["implementations"][number]

/** What every implementation provides (conformance/README.md, Tokenizers and renderers). */
export const REQUIRED = {
  tokenizers: COMPONENTS.tokenizers.filter((c) => c.required).map((c) => c.id),
  renderers: COMPONENTS.renderers.filter((c) => c.required).map((c) => c.id),
}

const tally = <O extends string>(list: readonly { outcome: string }[], outcomes: readonly O[]) =>
  Object.fromEntries([
    ["total", list.length],
    ...outcomes.map((outcome) => [outcome, list.filter((c) => c.outcome === outcome).length]),
  ]) as Record<O | "total", number>

export function conformanceRows(fleet: FleetReportV1) {
  return fleet.implementations.map((implementation) => {
    const { report } = implementation
    const listed = implementation.tokenizers !== undefined || implementation.renderers !== undefined
    return {
      language: implementation.language,
      name: implementation.name,
      version: implementation.version,
      source: implementation.source,
      contractCommit: report.contract.commit,
      sameContract: report.contract.commit === fleet.contract.commit,
      cases: tally(report.cases, ["passed", "failed", "skipped"] as const),
      /** Undefined when the report did not run the rejection cases: none of them counts (R-17). */
      rejections:
        report.rejections === undefined
          ? undefined
          : tally(report.rejections, ["rejected", "failed", "skipped"] as const),
      tokenizers: implementation.tokenizers,
      renderers: implementation.renderers,
      /** Undefined when the implementation does not say what it provides. */
      missingRequired: listed
        ? [
            ...REQUIRED.tokenizers.filter((id) => !(implementation.tokenizers ?? []).includes(id)),
            ...REQUIRED.renderers.filter((id) => !(implementation.renderers ?? []).includes(id)),
          ]
        : undefined,
    }
  })
}

export type ConformanceRow = ReturnType<typeof conformanceRows>[number]

export interface CaseRow {
  readonly id: string
  readonly kind: "case" | "rejection"
  readonly outcome: string
  readonly rules: readonly string[]
  readonly detail: string | undefined
}

export function caseRows(implementation: Implementation, rule?: string): CaseRow[] {
  const { report } = implementation
  const rows: CaseRow[] = [
    ...report.cases.map((c) => ({ ...c, kind: "case" as const })),
    ...(report.rejections ?? []).map((c) => ({ ...c, kind: "rejection" as const })),
  ].map((c) => ({ id: c.id, kind: c.kind, outcome: c.outcome, rules: c.rules, detail: c.detail }))
  return rule === undefined ? rows : rows.filter((row) => row.rules.includes(rule))
}

export function serviceRows(fleet: FleetReportV1) {
  return fleet.services.map((service) => {
    const latency = service.latency_ms as {
      samples: number
      p50?: number
      p95?: number
      p99?: number
    }
    return {
      ...service,
      sameContract: service.contract_commit === fleet.contract.commit,
      latency:
        latency.samples === 0
          ? undefined
          : { samples: latency.samples, p50: latency.p50!, p95: latency.p95!, p99: latency.p99! },
    }
  })
}

export type ServiceRow = ReturnType<typeof serviceRows>[number]
