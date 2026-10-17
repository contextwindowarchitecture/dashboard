// The vault client (ADR-0009): each way the service answers a resolution, and the check that what
// it returned is the body the event digests. The deposit is the demo vault's own.

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { FIXTURES_DIR } from "../../../test/fixture-fetch"
import { resolveBody } from "./vault"

const VAULT = join(FIXTURES_DIR, "../vault")
const prefix = readdirSync(VAULT).sort()[0]!
const file = readdirSync(join(VAULT, prefix))[0]!
const SHA = file.split(".")[0]!
const TEXT = readFileSync(join(VAULT, prefix, file), "utf8")

const answering = (
  status: number,
  body: string,
  type = "text/plain; charset=utf-8",
  seen?: RequestInit[],
) =>
  (async (_url: string, init?: RequestInit) => {
    seen?.push(init ?? {})
    return new Response(body, { status, headers: { "content-type": type } })
  }) as typeof fetch
const json = (status: number, body: unknown) =>
  answering(status, JSON.stringify(body), "application/json")

describe("resolveBody", () => {
  it("gives the body when its bytes are the ones the event digests, sending the token", async () => {
    const seen: RequestInit[] = []
    const answer = await resolveBody(
      "/api/",
      SHA,
      "op-token",
      answering(200, TEXT, undefined, seen),
    )
    expect(answer).toEqual({ kind: "ok", text: TEXT, mediaType: "text/plain; charset=utf-8" })
    expect(new Headers(seen[0]!.headers).get("authorization")).toBe("Bearer op-token")
    expect(seen[0]!.cache).toBe("no-store")
  })

  it("shows nothing when the vault returns other bytes", async () => {
    expect(await resolveBody("/api", SHA, "t", answering(200, `${TEXT} `))).toEqual({
      kind: "mismatch",
    })
  })

  it("lays out a JSON body, after checking the bytes it came as", async () => {
    const canonical = '{"a":[2,"x"],"b":1}'
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))
    const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
    const answer = await resolveBody(
      "/api",
      sha,
      "t",
      answering(200, canonical, "application/json"),
    )
    expect(answer).toEqual({
      kind: "ok",
      text: JSON.stringify({ a: [2, "x"], b: 1 }, null, 2),
      mediaType: "application/json",
    })
  })

  it("names each way the service declines", async () => {
    expect(
      await resolveBody("/api", SHA, "t", json(401, { problems: ["Send the operator token."] })),
    ).toEqual({
      kind: "unauthorised",
    })
    expect(await resolveBody("/api", SHA, "t", json(404, { problems: [] }))).toEqual({
      kind: "not-found",
    })
    expect(
      await resolveBody(
        "/api",
        SHA,
        "t",
        json(503, { kind: "not-configured", problems: ["No operator token: set VAULT_TOKEN."] }),
      ),
    ).toEqual({ kind: "not-configured", problems: ["No operator token: set VAULT_TOKEN."] })
    expect((await resolveBody("/api", SHA, "t", json(500, {}))).kind).toBe("failed")
    const down = (async () => {
      throw new TypeError("Failed to fetch")
    }) as typeof fetch
    expect((await resolveBody("/api", SHA, "t", down)).kind).toBe("failed")
  })

  it("asks nothing for a digest that is not one", async () => {
    let asked = false
    const fetchFn = (async () => {
      asked = true
      return new Response("")
    }) as typeof fetch
    expect((await resolveBody("/api", "../x", "t", fetchFn)).kind).toBe("failed")
    expect(asked).toBe(false)
  })
})
