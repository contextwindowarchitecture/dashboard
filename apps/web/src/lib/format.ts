// Every number and instant the dashboard shows goes through here (STYLE.md 4): en-US, tabular in
// the UI, with its unit named. A value the app does not have is "Not available", never 0.

export const NOT_AVAILABLE = "Not available"

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
const known = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value)

export function formatCount(value: number | null | undefined): string {
  return known(value) ? integer.format(value) : NOT_AVAILABLE
}

export function formatTokens(value: number | null | undefined): string {
  return known(value)
    ? `${integer.format(value)} ${value === 1 ? "token" : "tokens"}`
    : NOT_AVAILABLE
}

/** Milliseconds: two decimals under ten, one under a hundred, none above. */
export function formatMs(value: number | null | undefined): string {
  if (!known(value)) return NOT_AVAILABLE
  const digits = value < 10 ? 2 : value < 100 ? 1 : 0
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value)} ms`
}

/** An instant in UTC to the second: "2026-10-15 09:30:00Z". */
export function formatInstant(value: string | null | undefined): string {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(time)) return NOT_AVAILABLE
  return `${new Date(time).toISOString().slice(0, 19).replace("T", " ")}Z`
}

/** A rate between 0 and 1 as a percentage to one decimal: "12.3%". */
export function formatPercent(value: number | null | undefined): string {
  return known(value)
    ? `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value * 100)}%`
    : NOT_AVAILABLE
}

/**
 * Money in the configured currency, to three significant digits, since the cost of one window's
 * tokens can be a fraction of a cent. Without an amount or a currency there is no figure to show.
 */
export function formatMoney(
  value: number | null | undefined,
  currency: string | undefined,
): string {
  if (!known(value) || currency === undefined) return NOT_AVAILABLE
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumSignificantDigits: 3,
  }).format(value)
}
