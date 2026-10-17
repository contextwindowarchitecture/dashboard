// The compliance bundle client (dashboard-plan.md DP-11): GET ${apiBase}/bundles/<event id>.json,
// which the ingest service signs when asked. Every answer is read at the boundary into one of the
// page's states; a bundle is validated against its schema as every document is.

import type { ComplianceBundleV1 } from "@cwa-dashboard/telemetry/types"
import { validateComplianceBundleV1 } from "@cwa-dashboard/telemetry/validators"
import { useQuery } from "@tanstack/react-query"

import { useData } from "../../../data/data-context"

export type BundleAnswer =
  | { readonly kind: "ok"; readonly bundle: ComplianceBundleV1; readonly url: string }
  | { readonly kind: "not-configured"; readonly problems: readonly string[] }
  | { readonly kind: "not-found" }
  | { readonly kind: "invalid"; readonly url: string }
  | { readonly kind: "failed"; readonly message: string }

export const EVENT_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/

export const bundleUrl = (apiBase: string, eventId: string) =>
  `${apiBase}/bundles/${encodeURIComponent(eventId)}.json`

export async function fetchBundle(
  apiBase: string,
  eventId: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<BundleAnswer> {
  const url = bundleUrl(apiBase, eventId)
  let response: Response
  try {
    response = await fetchFn(url, signal ? { signal } : undefined)
  } catch {
    return { kind: "failed", message: "The service did not answer." }
  }
  const body: unknown = await response.json().catch(() => undefined)
  const problems = (body as { problems?: unknown } | undefined)?.problems
  if (response.status === 404) return { kind: "not-found" }
  if (
    response.status === 503 &&
    (body as { kind?: unknown } | undefined)?.kind === "not-configured"
  ) {
    return { kind: "not-configured", problems: Array.isArray(problems) ? problems.map(String) : [] }
  }
  if (!response.ok) {
    const said = Array.isArray(problems) ? `: ${problems.join(" ")}` : ""
    return { kind: "failed", message: `The service answered ${response.status}${said}` }
  }
  if (!validateComplianceBundleV1(body)) return { kind: "invalid", url }
  return { kind: "ok", bundle: body, url }
}

/** The bundle for an event; nothing is asked of the service without a base or a valid id. */
export function useBundle(eventId: string | undefined) {
  const { apiBase, fetchFn = fetch } = useData()
  return useQuery({
    queryKey: ["bundle", apiBase ?? "", eventId ?? ""],
    queryFn: ({ signal }) => fetchBundle(apiBase!, eventId!, fetchFn, signal),
    enabled: apiBase !== undefined && eventId !== undefined && EVENT_ID.test(eventId),
    // Each one is a replay signed when asked for; ask again only when the reader does.
    staleTime: Infinity,
    retry: false,
  })
}
