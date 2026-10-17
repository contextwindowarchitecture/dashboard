import { describe, expect, it } from "vitest"

import {
  formatCount,
  formatInstant,
  formatMoney,
  formatMs,
  formatPercent,
  formatTokens,
  NOT_AVAILABLE,
} from "./format"

describe("format", () => {
  it("writes counts and tokens with the unit, in en-US", () => {
    expect(formatCount(3740)).toBe("3,740")
    expect(formatTokens(3740)).toBe("3,740 tokens")
    expect(formatTokens(1)).toBe("1 token")
    expect(formatTokens(0)).toBe("0 tokens")
  })

  it("writes milliseconds to a precision that suits their size", () => {
    expect(formatMs(0.784)).toBe("0.78 ms")
    expect(formatMs(12.44)).toBe("12.4 ms")
    expect(formatMs(312.6)).toBe("313 ms")
  })

  it("writes money in the configured currency, to three significant digits, and nothing without one", () => {
    expect(formatMoney(0.001332, "USD")).toBe("$0.00133")
    expect(formatMoney(1234.5, "EUR")).toBe("€1,230")
    expect(formatMoney(0, "USD")).toBe("$0")
    expect(formatMoney(undefined, "USD")).toBe("Not available")
    expect(formatMoney(3, undefined)).toBe("Not available")
  })

  it("writes instants in UTC, to the second", () => {
    expect(formatInstant("2026-10-15T09:30:00.123Z")).toBe("2026-10-15 09:30:00Z")
    expect(formatInstant("2026-10-15T11:30:00+02:00")).toBe("2026-10-15 09:30:00Z")
  })

  it("writes a rate as a percentage to one decimal", () => {
    expect(formatPercent(0.1234)).toBe("12.3%")
    expect(formatPercent(0)).toBe("0.0%")
    expect(formatPercent(undefined)).toBe(NOT_AVAILABLE)
  })

  it("says Not available, never 0, for a value it does not have", () => {
    expect(formatTokens(undefined)).toBe(NOT_AVAILABLE)
    expect(formatMs(Number.NaN)).toBe(NOT_AVAILABLE)
    expect(formatCount(null)).toBe(NOT_AVAILABLE)
    expect(formatInstant("not a time")).toBe(NOT_AVAILABLE)
  })
})
