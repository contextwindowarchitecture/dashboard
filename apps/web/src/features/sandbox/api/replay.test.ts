import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { createReplayClient } from "./replay"

const cases = resolve(
  import.meta.dirname,
  "../../../../../../packages/contract/vendor/cwa/conformance/cases",
)
const trace = JSON.parse(
  readFileSync(join(cases, "budget-margin", "expected.trace.json"), "utf8"),
) as {
  context: { snapshot_digest: string }
}
const replayed = {
  ok: true,
  outcome: "assembled",
  trace,
  payload_hash: "a".repeat(64),
  payload_bytes: 120,
  snapshot_digest: trace.context.snapshot_digest,
}

/** A fetch that answers every request with `status` and `body`, and records what it was asked. */
function answering(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return { calls, client: createReplayClient("/api", fetchFn) }
}

describe("the replay client", () => {
  it("posts the snapshot as JSON to the service's /replay", async () => {
    const { calls, client } = answering(200, replayed)
    await client.replay({ any: "snapshot" })
    expect(calls[0]!.url).toBe("/api/replay")
    expect(calls[0]!.init?.method).toBe("POST")
    expect(new Headers(calls[0]!.init?.headers).get("content-type")).toBe("application/json")
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ any: "snapshot" })
  })

  it("reads a replay, its trace checked against the contract's schema", async () => {
    expect(await answering(200, replayed).client.replay({})).toEqual({
      kind: "replayed",
      outcome: "assembled",
      trace,
      payloadHash: "a".repeat(64),
      payloadBytes: 120,
      snapshotDigest: trace.context.snapshot_digest,
    })
    const bad = await answering(200, { ...replayed, trace: { not: "a trace" } }).client.replay({})
    expect(bad.kind).toBe("invalid-response")
  })

  it("names each way a replay can fail", async () => {
    const problems = ["budget: required"]
    expect(
      await answering(400, { ok: false, kind: "rejected", problems }).client.replay({}),
    ).toEqual({ kind: "rejected", problems })
    expect(
      await answering(422, { ok: false, kind: "unsupported-component", problems }).client.replay(
        {},
      ),
    ).toEqual({ kind: "unsupported", problems })
    expect(
      (await answering(413, { ok: false, kind: "too-large", problems }).client.replay({})).kind,
    ).toBe("too-large")
    expect(
      (await answering(503, { ok: false, kind: "busy", problems }).client.replay({})).kind,
    ).toBe("busy")
    expect(
      (await answering(504, { ok: false, kind: "timeout", problems }).client.replay({})).kind,
    ).toBe("timeout")
    expect((await answering(502, "bad gateway").client.replay({})).kind).toBe("invalid-response")
  })

  it("says the service is unreachable when nothing answers", async () => {
    const client = createReplayClient("/api", (async () => {
      throw new TypeError("Failed to fetch")
    }) as typeof fetch)
    expect(await client.replay({})).toMatchObject({ kind: "unreachable" })
  })

  it("lets an aborted replay go, so a newer one wins", async () => {
    const controller = new AbortController()
    controller.abort()
    const client = createReplayClient("/api", (async (_url: string, init?: RequestInit) => {
      init?.signal?.throwIfAborted()
      return new Response("{}")
    }) as typeof fetch)
    await expect(client.replay({}, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
  })

  it("reads the service's tokenizers and renderers", async () => {
    const components = {
      tokenizers: [{ id: "estimate-utf8/v1", required: true, provided: true }],
      renderers: [{ id: "cwa-message-blocks/v1", required: false, provided: true }],
    }
    expect(await answering(200, components).client.components()).toEqual(components)
  })
})
