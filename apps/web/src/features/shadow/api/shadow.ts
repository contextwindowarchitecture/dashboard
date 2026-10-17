// The shadow client (ADR-0008): GET ${apiBase}/corpora.json for the frozen corpora, and
// POST ${apiBase}/shadow with a corpus's name and a candidate, which the ingest service replays twice
// an event through the pinned assembler. Every answer is read at the boundary into one of the page's
// states; a report is validated against its schema as every document is.

import type { ShadowReportV1 } from "@cwa-dashboard/telemetry/types"
import { validateShadowReportV1 } from "@cwa-dashboard/telemetry/validators"
import { useQuery } from "@tanstack/react-query"

import { useData } from "../../../data/data-context"
import type { Candidate } from "../model/candidate"

export interface CorpusSummary {
  readonly name: string
  readonly created_at: string
  readonly events: number
}

export type CorporaAnswer =
  | { readonly kind: "ok"; readonly corpora: readonly CorpusSummary[] }
  | { readonly kind: "not-configured"; readonly problems: readonly string[] }
  | { readonly kind: "invalid"; readonly url: string }
  | { readonly kind: "failed"; readonly message: string }

export type ShadowAnswer =
  | { readonly kind: "ok"; readonly report: ShadowReportV1 }
  | { readonly kind: "invalid"; readonly problems: readonly string[] }
  | { readonly kind: "not-found"; readonly problems: readonly string[] }
  | { readonly kind: "not-configured"; readonly problems: readonly string[] }
  | { readonly kind: "busy"; readonly message: string }
  | { readonly kind: "timeout"; readonly message: string }
  | { readonly kind: "invalid-response" }
  | { readonly kind: "failed"; readonly message: string }

type Raw = Record<string, unknown>
const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
const trim = (apiBase: string) => apiBase.replace(/\/+$/, "")
const isSummary = (value: unknown): value is CorpusSummary =>
  isRecord(value) &&
  typeof value["name"] === "string" &&
  typeof value["created_at"] === "string" &&
  typeof value["events"] === "number"

export const corporaUrl = (apiBase: string) => `${trim(apiBase)}/corpora.json`

export async function fetchCorpora(
  apiBase: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<CorporaAnswer> {
  const url = corporaUrl(apiBase)
  let response: Response
  try {
    response = await fetchFn(url, signal ? { signal } : undefined)
  } catch {
    return { kind: "failed", message: "The service did not answer." }
  }
  const body: unknown = await response.json().catch(() => undefined)
  const raw = isRecord(body) ? body : {}
  if (response.status === 503 && raw["kind"] === "not-configured") {
    return { kind: "not-configured", problems: strings(raw["problems"]) }
  }
  if (!response.ok) {
    const said = strings(raw["problems"]).join(" ")
    return {
      kind: "failed",
      message: `The service answered ${response.status}${said ? `: ${said}` : ""}`,
    }
  }
  const list = raw["corpora"]
  if (!Array.isArray(list) || !list.every(isSummary)) return { kind: "invalid", url }
  return { kind: "ok", corpora: list }
}

export async function runShadow(
  apiBase: string,
  request: { readonly corpus: string; readonly candidate: Candidate },
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<ShadowAnswer> {
  let response: Response
  try {
    response = await fetchFn(`${trim(apiBase)}/shadow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    })
  } catch (error) {
    if (signal?.aborted) throw error
    return { kind: "failed", message: "The service did not answer." }
  }
  const body: unknown = await response.json().catch(() => undefined)
  if (body === undefined) {
    return { kind: "failed", message: `The service answered ${response.status}, not in JSON.` }
  }
  const raw = isRecord(body) ? body : {}
  const problems = strings(raw["problems"])
  switch (response.status) {
    case 200:
      return validateShadowReportV1(body)
        ? { kind: "ok", report: body }
        : { kind: "invalid-response" }
    case 400:
      return { kind: "invalid", problems }
    case 404:
      return { kind: "not-found", problems }
    case 503:
      return raw["kind"] === "busy"
        ? { kind: "busy", message: problems.join(" ") }
        : { kind: "not-configured", problems }
    case 504:
      return { kind: "timeout", message: problems.join(" ") }
  }
  return {
    kind: "failed",
    message: `The service answered ${response.status}${problems.length ? `: ${problems.join(" ")}` : ""}`,
  }
}

/** The frozen corpora; live, since a corpus may be frozen while the page is open. */
export function useCorpora() {
  const { apiBase, fetchFn = fetch } = useData()
  return useQuery({
    queryKey: ["corpora", apiBase ?? ""],
    queryFn: ({ signal }) => fetchCorpora(apiBase!, fetchFn, signal),
    enabled: apiBase !== undefined,
    refetchOnWindowFocus: true,
    retry: false,
  })
}
