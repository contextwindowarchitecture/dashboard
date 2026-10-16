// The replay client (dashboard-plan.md 9): POST ${apiBase}/replay with a snapshot, and GET
// ${apiBase}/replay/components. Every answer is read at the boundary: a replay's trace is checked
// against the contract's schema with the precompiled validator (no eval, so the CSP holds), loaded
// with the first answer so it stays out of the app's first chunk, and
// each way the service can fail has a name the page can say. An aborted request rejects, so the
// newer one wins.

export type ReplayAnswer =
  | {
      readonly kind: "replayed"
      readonly outcome: "assembled" | "refused"
      readonly trace: unknown
      readonly payloadHash: string | null
      readonly payloadBytes: number | null
      readonly snapshotDigest: string
    }
  // One member per kind, so a check of `kind` narrows to its fields.
  | { readonly kind: "rejected"; readonly problems: readonly string[] }
  | { readonly kind: "unsupported"; readonly problems: readonly string[] }
  | { readonly kind: "invalid-response"; readonly problems: readonly string[] }
  | { readonly kind: "too-large"; readonly message: string }
  | { readonly kind: "busy"; readonly message: string }
  | { readonly kind: "timeout"; readonly message: string }
  | { readonly kind: "unreachable"; readonly message: string }

export interface Component {
  readonly id: string
  readonly required: boolean
  readonly provided: boolean
}
export interface Components {
  readonly tokenizers: readonly Component[]
  readonly renderers: readonly Component[]
}

export interface ReplayClient {
  replay(snapshot: unknown, signal?: AbortSignal): Promise<ReplayAnswer>
  components(signal?: AbortSignal): Promise<Components>
}

type Raw = Record<string, unknown>
const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
// By name, not class: an AbortError may come from another realm's DOMException.
const isAbort = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError"

async function readReplayed(body: Raw): Promise<ReplayAnswer> {
  const { validateTrace } = await import("@cwa-dashboard/contract/validators")
  const { outcome, trace, payload_hash, payload_bytes, snapshot_digest } = body
  const problems: string[] = []
  if (outcome !== "assembled" && outcome !== "refused")
    problems.push("outcome is not assembled or refused")
  if (!validateTrace(trace)) {
    problems.push(
      ...(validateTrace.errors ?? []).map(
        (e) => `trace${e.instancePath} ${e.message ?? "is invalid"}`,
      ),
    )
  }
  if (
    payload_hash !== null &&
    (typeof payload_hash !== "string" || !/^[0-9a-f]{64}$/.test(payload_hash))
  )
    problems.push("payload_hash is not a SHA-256")
  if (payload_bytes !== null && typeof payload_bytes !== "number")
    problems.push("payload_bytes is not a number")
  if (typeof snapshot_digest !== "string") problems.push("snapshot_digest is missing")
  if (problems.length > 0) return { kind: "invalid-response", problems }
  return {
    kind: "replayed",
    outcome: outcome as "assembled" | "refused",
    trace,
    payloadHash: payload_hash as string | null,
    payloadBytes: payload_bytes as number | null,
    snapshotDigest: snapshot_digest as string,
  }
}

export function createReplayClient(apiBase: string, fetchFn: typeof fetch = fetch): ReplayClient {
  const base = apiBase.replace(/\/+$/, "")
  return {
    async replay(snapshot, signal) {
      let response: Response
      try {
        response = await fetchFn(`${base}/replay`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(snapshot),
          ...(signal ? { signal } : {}),
        })
      } catch (error) {
        if (isAbort(error) || signal?.aborted) throw error
        return {
          kind: "unreachable",
          message: `The replay service at ${base} did not answer: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
      let body: unknown
      try {
        body = await response.json()
      } catch {
        return {
          kind: "invalid-response",
          problems: [`HTTP ${response.status} with a body that is not JSON`],
        }
      }
      const raw = isRecord(body) ? body : {}
      const message = strings(raw["problems"]).join(" ") || `HTTP ${response.status}`
      switch (response.status) {
        case 200:
          return await readReplayed(raw)
        case 400:
          if (raw["kind"] === "rejected")
            return { kind: "rejected", problems: strings(raw["problems"]) }
          break
        case 422:
          return { kind: "unsupported", problems: strings(raw["problems"]) }
        case 413:
          return { kind: "too-large", message }
        case 503:
          return { kind: "busy", message }
        case 504:
          return { kind: "timeout", message }
      }
      return { kind: "invalid-response", problems: [`HTTP ${response.status}: ${message}`] }
    },
    async components(signal) {
      const response = await fetchFn(`${base}/replay/components`, signal ? { signal } : undefined)
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${base}/replay/components`)
      const body = (await response.json()) as unknown
      const list = (value: unknown): Component[] =>
        (Array.isArray(value) ? value : []).filter(isRecord).map((c) => ({
          id: String(c["id"]),
          required: c["required"] === true,
          provided: c["provided"] === true,
        }))
      return isRecord(body)
        ? { tokenizers: list(body["tokenizers"]), renderers: list(body["renderers"]) }
        : { tokenizers: [], renderers: [] }
    },
  }
}
