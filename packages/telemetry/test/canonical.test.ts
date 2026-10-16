import { describe, expect, it } from "vitest"

import { canonicalJson } from "../src/canonical.ts"

describe("canonicalJson (RFC 8785)", () => {
  it("orders members by UTF-16 code units at every depth and writes numbers as JavaScript does", () => {
    expect(canonicalJson({ b: [{ z: 1, y: 2 }], a: "x", "\u{1F600}": 0, ｚ: 0 })).toBe(
      '{"a":"x","b":[{"y":2,"z":1}],"\u{1F600}":0,"ｚ":0}',
    )
    expect(canonicalJson([1e21, 0.1, -0, 1.5e-7])).toBe("[1e+21,0.1,0,1.5e-7]")
  })
})
