// The shadow client's answers, each way the service can answer. A real report is the browser test's
// (e2e/smoke.spec.ts), against the ingest service, since only it replays.

import { describe, expect, it } from "vitest"

import { fixtureFetch, type Override } from "../../../test/fixture-fetch"
import { fetchCorpora, runShadow } from "./shadow"

const answer = (status: number, body: unknown): Override => ({
  status,
  body: typeof body === "string" ? body : JSON.stringify(body),
})
const corpora = (override: Override) =>
  fetchCorpora("/api", fixtureFetch({ overrides: { "/api/corpora.json": override } }))
const shadow = (override: Override | { throws: "network" }) =>
  runShadow(
    "/api",
    { corpus: "chat", candidate: { profile: {} } },
    fixtureFetch({ overrides: { "/api/shadow": override } }),
  )

describe("fetchCorpora", () => {
  it("reads the frozen corpora", async () => {
    const list = [{ name: "chat", created_at: "2026-10-16T09:00:00.000Z", events: 12 }]
    expect(await corpora(answer(200, { corpora: list }))).toEqual({ kind: "ok", corpora: list })
  })

  it("names the setting when the service has no store", async () => {
    expect(
      await corpora(answer(503, { kind: "not-configured", problems: ["No event store: set X."] })),
    ).toEqual({ kind: "not-configured", problems: ["No event store: set X."] })
  })

  it("calls a list it cannot read invalid, and a failure failed", async () => {
    expect(await corpora(answer(200, { corpora: [{ name: 3 }] }))).toEqual({
      kind: "invalid",
      url: "/api/corpora.json",
    })
    expect((await corpora(answer(500, "{}"))).kind).toBe("failed")
    expect((await corpora({ throws: "network" })).kind).toBe("failed")
  })
})

describe("runShadow", () => {
  it("asks for the corpus and the candidate", async () => {
    const seen: { url: string; body: unknown }[] = []
    const fetchFn: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return new Response("{}", { status: 404 })
    }
    await runShadow("/api/", { corpus: "chat", candidate: { profile: { id: "p" } } }, fetchFn)
    expect(seen).toEqual([
      { url: "/api/shadow", body: { corpus: "chat", candidate: { profile: { id: "p" } } } },
    ])
  })

  it("names each way the service refuses", async () => {
    const problems = ["candidate must hold a route_policy, a profile, or both."]
    expect(await shadow(answer(400, { kind: "invalid", problems }))).toEqual({
      kind: "invalid",
      problems,
    })
    expect(await shadow(answer(404, { kind: "not-found", problems: ["No corpus chat."] }))).toEqual(
      { kind: "not-found", problems: ["No corpus chat."] },
    )
    expect(
      await shadow(answer(503, { kind: "busy", problems: ["A shadow run is under way."] })),
    ).toEqual({ kind: "busy", message: "A shadow run is under way." })
    expect(
      await shadow(answer(503, { kind: "not-configured", problems: ["No event store."] })),
    ).toEqual({ kind: "not-configured", problems: ["No event store."] })
    expect(await shadow(answer(504, { kind: "timeout", problems: ["Too slow."] }))).toEqual({
      kind: "timeout",
      message: "Too slow.",
    })
  })

  it("calls a report it cannot read invalid, and silence failed", async () => {
    expect(await shadow(answer(200, { $schema: "cwa-dashboard/shadow-report/v1" }))).toEqual({
      kind: "invalid-response",
    })
    expect((await shadow({ throws: "network" })).kind).toBe("failed")
    expect((await shadow(answer(500, "not json"))).kind).toBe("failed")
  })
})
