// The vault client (ADR-0009): GET ${apiBase}/bodies/<sha256> with the operator token, for a body a
// route opted into the vault kept out of its event. The service decides who may read; the page only
// checks that the bytes it was given are the ones the event digests (SHA-256, by WebCrypto) and
// shows nothing otherwise. The token travels in this request only, and the answer is never cached.

export type VaultAnswer =
  | { readonly kind: "ok"; readonly text: string; readonly mediaType: string }
  | { readonly kind: "mismatch" }
  | { readonly kind: "unauthorised" }
  | { readonly kind: "not-found" }
  | { readonly kind: "not-configured"; readonly problems: readonly string[] }
  | { readonly kind: "failed"; readonly message: string }

const SHA256 = /^[0-9a-f]{64}$/

async function digestOf(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export const bodyUrl = (apiBase: string, sha256: string) =>
  `${apiBase.replace(/\/+$/, "")}/bodies/${sha256}`

export async function resolveBody(
  apiBase: string,
  sha256: string,
  token: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<VaultAnswer> {
  if (!SHA256.test(sha256)) return { kind: "failed", message: `${sha256} is not a SHA-256 digest.` }
  let response: Response
  try {
    response = await fetchFn(bodyUrl(apiBase, sha256), {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      ...(signal ? { signal } : {}),
    })
  } catch (error) {
    if (signal?.aborted) throw error
    return { kind: "failed", message: "The service did not answer." }
  }
  if (response.status === 200) {
    const bytes = await response.arrayBuffer()
    if ((await digestOf(bytes)) !== sha256) return { kind: "mismatch" }
    const text = new TextDecoder().decode(bytes)
    const mediaType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim()
    if (mediaType === "application/json") {
      return { kind: "ok", text: JSON.stringify(JSON.parse(text), null, 2), mediaType }
    }
    return { kind: "ok", text, mediaType: response.headers.get("content-type") ?? "" }
  }
  if (response.status === 401) return { kind: "unauthorised" }
  if (response.status === 404) return { kind: "not-found" }
  const body = (await response.json().catch(() => undefined)) as
    { kind?: unknown; problems?: unknown } | undefined
  const problems = Array.isArray(body?.problems) ? body.problems.map(String) : []
  if (response.status === 503 && body?.kind === "not-configured") {
    return { kind: "not-configured", problems }
  }
  return {
    kind: "failed",
    message: `The service answered ${response.status}${problems.length ? `: ${problems.join(" ")}` : ""}`,
  }
}
