// The drafts client (ADR-0013): a signed-in author's drafts at ${apiBase}/drafts.json and
// ${apiBase}/drafts/<id>.json, in the tenant the page reads. Each answer read at the boundary; a
// draft validated as every document is.

import type { DraftV1 } from "@cwa-dashboard/telemetry/types"
import { validateDraftV1 } from "@cwa-dashboard/telemetry/validators"
import { useQuery } from "@tanstack/react-query"

import { useData } from "../../../data/data-context"
import { DEFAULT_TENANT } from "../../../data/tenant"

export interface DraftSummary {
  readonly id: string
  readonly kind: DraftV1["kind"]
  readonly route: string
  readonly started_from: DraftV1["started_from"]
  readonly updated_at: string
}

const at = (apiBase: string, path: string, tenant: string) =>
  `${apiBase.replace(/\/+$/, "")}${path}${tenant === DEFAULT_TENANT ? "" : `?tenant=${encodeURIComponent(tenant)}`}`

const problemsOf = async (response: Response) => {
  const body = (await response.json().catch(() => undefined)) as { problems?: unknown } | undefined
  return Array.isArray(body?.problems)
    ? body.problems.map(String).join(" ")
    : `HTTP ${response.status}`
}

export function useDrafts() {
  const { apiBase, fetchFn = fetch, tenant = DEFAULT_TENANT } = useData()
  return useQuery({
    queryKey: ["drafts", apiBase ?? "", tenant],
    queryFn: async ({ signal }): Promise<DraftSummary[]> => {
      const response = await fetchFn(at(apiBase!, "/drafts.json", tenant), {
        signal,
        cache: "no-store",
      })
      if (!response.ok) throw new Error(await problemsOf(response))
      const body = (await response.json()) as { drafts?: unknown }
      return Array.isArray(body.drafts) ? (body.drafts as DraftSummary[]) : []
    },
    enabled: apiBase !== undefined,
    retry: false,
  })
}

export type DraftAnswer =
  | { readonly kind: "ok"; readonly draft: DraftV1 }
  | { readonly kind: "not-found" }
  | { readonly kind: "failed"; readonly message: string }

export function useDraft(id: string) {
  const { apiBase, fetchFn = fetch, tenant = DEFAULT_TENANT } = useData()
  return useQuery({
    queryKey: ["draft", apiBase ?? "", tenant, id],
    queryFn: async ({ signal }): Promise<DraftAnswer> => {
      const response = await fetchFn(
        at(apiBase!, `/drafts/${encodeURIComponent(id)}.json`, tenant),
        {
          signal,
          cache: "no-store",
        },
      )
      if (response.status === 404) return { kind: "not-found" }
      if (!response.ok) return { kind: "failed", message: await problemsOf(response) }
      const body: unknown = await response.json()
      return validateDraftV1(body)
        ? { kind: "ok", draft: body }
        : { kind: "failed", message: "The service answered with something that is not a draft." }
    },
    enabled: apiBase !== undefined,
    retry: false,
    staleTime: Infinity,
  })
}

export interface DraftBody {
  readonly kind: DraftV1["kind"]
  readonly started_from: DraftV1["started_from"]
  readonly document: unknown
}

export async function putDraft(
  apiBase: string,
  tenant: string,
  id: string,
  body: DraftBody,
  fetchFn: typeof fetch,
): Promise<{ ok: true; draft: DraftV1 } | { ok: false; message: string }> {
  try {
    const response = await fetchFn(at(apiBase, `/drafts/${encodeURIComponent(id)}.json`, tenant), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!response.ok) return { ok: false, message: await problemsOf(response) }
    return { ok: true, draft: (await response.json()) as DraftV1 }
  } catch {
    return { ok: false, message: "The service did not answer." }
  }
}

export async function deleteDraft(
  apiBase: string,
  tenant: string,
  id: string,
  fetchFn: typeof fetch,
) {
  const response = await fetchFn(at(apiBase, `/drafts/${encodeURIComponent(id)}.json`, tenant), {
    method: "DELETE",
  })
  return response.ok
}

/** What Publish answered (ADR-0014): the pull request, the file and the commands by hand, or why not. */
export type PublishAnswer =
  | {
      readonly kind: "published"
      readonly repository: string
      readonly path: string
      readonly branch: string
      readonly number: number
      readonly url: string
    }
  | {
      readonly kind: "by-hand"
      readonly path: string
      readonly file: string
      readonly branch: string
      readonly commands: readonly string[]
      readonly problems: readonly string[]
    }
  | { readonly kind: "refused"; readonly status: number; readonly problems: readonly string[] }

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []

export async function publishDraft(
  apiBase: string,
  tenant: string,
  id: string,
  request: { readonly corpus?: string },
  fetchFn: typeof fetch,
): Promise<PublishAnswer> {
  let response: Response
  try {
    response = await fetchFn(at(apiBase, `/drafts/${encodeURIComponent(id)}/publish`, tenant), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    })
  } catch {
    return { kind: "refused", status: 0, problems: ["The service did not answer."] }
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.ok && body["kind"] === "published" && typeof body["url"] === "string") {
    return {
      kind: "published",
      repository: String(body["repository"]),
      path: String(body["path"]),
      branch: String(body["branch"]),
      number: Number(body["number"]),
      url: body["url"],
    }
  }
  if (response.ok && body["kind"] === "by-hand" && typeof body["file"] === "string") {
    return {
      kind: "by-hand",
      path: String(body["path"]),
      file: body["file"],
      branch: String(body["branch"]),
      commands: strings(body["commands"]),
      problems: strings(body["problems"]),
    }
  }
  const problems = strings(body["problems"])
  return {
    kind: "refused",
    status: response.status,
    problems: problems.length > 0 ? problems : [`The service answered ${response.status}.`],
  }
}
