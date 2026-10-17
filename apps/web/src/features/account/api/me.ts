// Who is signed in (ADR-0010): GET ${apiBase}/me, read at the boundary into one of the account
// control's states, and POST ${apiBase}/auth/logout. The session is a cookie the page cannot read;
// these requests carry it because they are same-origin.

import { useQuery } from "@tanstack/react-query"

import { useData } from "../../../data/data-context"

export type Me =
  | {
      readonly kind: "signed-in"
      readonly name: string
      readonly email?: string
      readonly groups: readonly string[]
    }
  | { readonly kind: "signed-out" }
  /** No sign-in here, or an answer the page cannot read: the control shows nothing. */
  | { readonly kind: "none" }

const trim = (apiBase: string) => apiBase.replace(/\/+$/, "")

export async function fetchMe(
  apiBase: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<Me> {
  let body: unknown
  try {
    const response = await fetchFn(`${trim(apiBase)}/me`, {
      cache: "no-store",
      ...(signal ? { signal } : {}),
    })
    if (!response.ok) return { kind: "none" }
    body = await response.json()
  } catch (error) {
    if (signal?.aborted) throw error
    return { kind: "none" }
  }
  const raw = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>
  if (raw["sign_in"] !== "configured" || typeof raw["signed_in"] !== "boolean")
    return { kind: "none" }
  if (!raw["signed_in"]) return { kind: "signed-out" }
  if (typeof raw["name"] !== "string" || !Array.isArray(raw["groups"])) return { kind: "none" }
  return {
    kind: "signed-in",
    name: raw["name"],
    ...(typeof raw["email"] === "string" ? { email: raw["email"] } : {}),
    groups: raw["groups"].filter((g): g is string => typeof g === "string"),
  }
}

export const loginHref = (apiBase: string, returnTo: string) =>
  `${trim(apiBase)}/auth/login?return=${encodeURIComponent(returnTo)}`

export async function signOut(apiBase: string, fetchFn: typeof fetch): Promise<boolean> {
  try {
    return (await fetchFn(`${trim(apiBase)}/auth/logout`, { method: "POST" })).ok
  } catch {
    return false
  }
}

/** Who is signed in; asked again when the reader comes back to the tab, as a session may have ended. */
export function useMe() {
  const { apiBase, fetchFn = fetch } = useData()
  return useQuery({
    queryKey: ["me", apiBase ?? ""],
    queryFn: ({ signal }) => fetchMe(apiBase!, fetchFn, signal),
    enabled: apiBase !== undefined,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  })
}
