import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { DEMO_CONFIG, resolveDataRequest } from "./data-plugin.ts"

const dir = resolve(import.meta.dirname, "../../../packages/demo-traffic/fixtures")

describe("resolveDataRequest", () => {
  it("serves the configuration and the tree's JSON files", () => {
    expect(resolveDataRequest("/config.json", dir)).toEqual({ kind: "config", body: DEMO_CONFIG })
    expect(resolveDataRequest("/data/events/index.json", dir)).toEqual({
      kind: "file",
      path: resolve(dir, "events/index.json"),
    })
    expect(resolveDataRequest("/data/fleet.json?v=1", dir)).toEqual({
      kind: "file",
      path: resolve(dir, "fleet.json"),
    })
  })

  it("answers 404 for a miss, a directory, anything but JSON, and anything outside the tree", () => {
    for (const url of [
      "/data/events/none.json",
      "/data/events/",
      "/data/events",
      "/data/../package.json",
      "/data/%2e%2e/package.json",
      "/data/x.txt",
    ]) {
      expect(resolveDataRequest(url, dir), url).toEqual({ kind: "not-found" })
    }
  })

  it("leaves every other address to the app", () => {
    expect(resolveDataRequest("/traces", dir)).toEqual({ kind: "pass" })
    expect(resolveDataRequest("/datasets", dir)).toEqual({ kind: "pass" })
  })
})
