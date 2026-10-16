import { describe, expect, it } from "vitest"

import { fixtureFetch } from "../test/fixture-fetch"
import { createFileSource, SourceError } from "./source"

const source = (options: Parameters<typeof fixtureFetch>[0] = {}) =>
  createFileSource("/data/", fixtureFetch(options))

async function failure(promise: Promise<unknown>): Promise<SourceError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof SourceError) return error
    throw error
  }
  throw new Error("expected a SourceError")
}

describe("createFileSource", () => {
  it("reads the index, an event, a session and the fleet report from the tree", async () => {
    const files = source()
    const index = (await files.index()) as { $schema: string; events: { event_id: string }[] }
    expect(index.$schema).toBe("cwa-dashboard/events-index/v1")
    const id = index.events[0]!.event_id
    expect(((await files.event(id)) as { event_id: string }).event_id).toBe(id)
    expect(((await files.session("refund-7")) as { session_id: string }).session_id).toBe(
      "refund-7",
    )
    expect(((await files.fleet()) as { $schema: string }).$schema).toBe(
      "cwa-dashboard/fleet-report/v1",
    )
    expect(files.url("events/index.json")).toBe("/data/events/index.json")
  })

  it("tells each kind of failure apart", async () => {
    expect((await failure(source().event("01JA2B3C4D5E6F7G8H9JKMNPQR"))).kind).toBe("not-found")
    expect(
      (await failure(source({ overrides: { "/data/fleet.json": { status: 503 } } }).fleet())).kind,
    ).toBe("http")
    expect(
      (await failure(source({ overrides: { "/data/fleet.json": { throws: "network" } } }).fleet()))
        .kind,
    ).toBe("network")
    expect(
      (
        await failure(
          source({ overrides: { "/data/fleet.json": { status: 200, body: "{" } } }).fleet(),
        )
      ).kind,
    ).toBe("parse")
    const controller = new AbortController()
    controller.abort()
    expect((await failure(source().fleet(controller.signal))).kind).toBe("aborted")
  })

  it("never fetches outside the tree, whatever an id holds", async () => {
    const requested: string[] = []
    const files = createFileSource(
      "/data",
      fixtureFetch({ onRequest: (url) => requested.push(url) }),
    )
    expect((await failure(files.event("../fleet"))).kind).toBe("not-found")
    expect(requested).toEqual([])
    expect((await failure(files.session("a/b"))).kind).toBe("not-found")
    // The index lives beside the events; an event id is a ULID, so "index" names no event.
    expect((await failure(files.event("index"))).kind).toBe("not-found")
  })
})
