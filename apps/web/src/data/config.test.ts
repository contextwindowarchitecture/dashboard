import { describe, expect, it } from "vitest"

import { fixtureFetch } from "../test/fixture-fetch"
import { ConfigError, loadConfig, parseConfig } from "./config"

describe("parseConfig", () => {
  it("reads the data root and the source, and the replay service when named", () => {
    expect(parseConfig({ dataRoot: "/data/", source: "file" })).toEqual({
      dataRoot: "/data",
      source: "file",
    })
    expect(
      parseConfig({ dataRoot: "https://demo.example/data", source: "file", apiBase: "/api" }),
    ).toEqual({
      dataRoot: "https://demo.example/data",
      source: "file",
      apiBase: "/api",
    })
  })

  it("refuses a document it cannot use, saying why", () => {
    expect(() => parseConfig([])).toThrow(ConfigError)
    expect(() => parseConfig({ source: "file" })).toThrow(/dataRoot/)
    expect(() => parseConfig({ dataRoot: "data", source: "file" })).toThrow(
      /absolute path or an http/,
    )
    expect(() => parseConfig({ dataRoot: "/data", source: "s3" })).toThrow(/source/)
    expect(() => parseConfig({ dataRoot: "/data", source: "http" })).toThrow(
      /dataRoot.*\/api\/data/,
    )
    expect(() => parseConfig({ dataRoot: "/data", source: "file", apiBase: 3 })).toThrow(/apiBase/)
  })
})

describe("parseConfig's prices", () => {
  const base = { dataRoot: "/data", source: "file" }
  it("reads a currency and a price per million input tokens for each route", () => {
    const prices = {
      currency: "USD",
      per_million_input_tokens: { "support-chat": 3, extract: 0.25 },
    }
    expect(parseConfig({ ...base, prices })).toEqual({ dataRoot: "/data", source: "file", prices })
  })

  it("refuses prices it cannot use, saying why", () => {
    const priced = (prices: unknown) => () => parseConfig({ ...base, prices })
    expect(priced("3 USD")).toThrow(/prices/)
    expect(priced({ currency: "dollars", per_million_input_tokens: {} })).toThrow(/currency/)
    expect(priced({ currency: "USD" })).toThrow(/per_million_input_tokens/)
    expect(priced({ currency: "USD", per_million_input_tokens: { a: -1 } })).toThrow(/a/)
    expect(priced({ currency: "USD", per_million_input_tokens: { a: "3" } })).toThrow(/a/)
  })
})

describe("loadConfig", () => {
  it("fetches /config.json", async () => {
    await expect(loadConfig(fixtureFetch())).resolves.toEqual({ dataRoot: "/data", source: "file" })
  })

  it("makes every failure a visible error, never a default", async () => {
    await expect(
      loadConfig(fixtureFetch({ overrides: { "/config.json": { status: 404 } } })),
    ).rejects.toThrow(/404/)
    await expect(
      loadConfig(fixtureFetch({ overrides: { "/config.json": { throws: "network" } } })),
    ).rejects.toThrow(/could not fetch/)
    await expect(
      loadConfig(fixtureFetch({ overrides: { "/config.json": { status: 200, body: "{" } } })),
    ).rejects.toThrow(/not JSON/)
  })
})
