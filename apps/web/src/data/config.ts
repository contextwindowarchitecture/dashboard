// The runtime configuration (dashboard-plan.md 9): served beside the build as /config.json, so one
// build serves every deployment. It names where the data tree is served and, when there is one, the
// replay service, and what input tokens cost, if anyone has said. A missing or malformed document is an
// error the app shows, never a default.

export interface AppConfig {
  /** Where the tree (events/, sessions/, fleet.json) is served, without a trailing slash. */
  readonly dataRoot: string
  /** How the documents are read: as files at dataRoot, whether a tree or the query API serves them. */
  readonly source: "file"
  /** The Node service's base (POST /replay); absent, the sandbox says it is not configured. */
  readonly apiBase?: string
  /** What input tokens cost, by route; absent, every money figure reads "Not available". */
  readonly prices?: Prices
}

/** Prices are configuration only: no figure is ever written in code (AGENTS.md). */
export interface Prices {
  /** An ISO 4217 code: USD, EUR. */
  readonly currency: string
  /** What a million input tokens cost on a route, in the currency. */
  readonly per_million_input_tokens: Readonly<Record<string, number>>
}

function parsePrices(value: unknown): Prices {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError('"prices", when set, must be an object')
  }
  const { currency, per_million_input_tokens: table } = value as Record<string, unknown>
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    throw new ConfigError('"prices.currency" must be an ISO 4217 code, such as "USD"')
  }
  if (typeof table !== "object" || table === null || Array.isArray(table)) {
    throw new ConfigError('"prices.per_million_input_tokens" must map routes to prices')
  }
  for (const [route, price] of Object.entries(table)) {
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      throw new ConfigError(
        `"prices.per_million_input_tokens.${route}" must be a number of 0 or more`,
      )
    }
  }
  return { currency, per_million_input_tokens: table as Record<string, number> }
}

export class ConfigError extends Error {
  override readonly name = "ConfigError"
}

export const CONFIG_URL = "/config.json"

const isLocation = (value: string) => value.startsWith("/") || /^https?:\/\//.test(value)

/** Checks a parsed config.json and throws a ConfigError naming what is wrong. */
export function parseConfig(json: unknown): AppConfig {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new ConfigError("config.json is not a JSON object")
  }
  const value = json as Record<string, unknown>
  const dataRoot = value["dataRoot"]
  if (typeof dataRoot !== "string" || dataRoot.trim() === "") {
    throw new ConfigError('config.json has no "dataRoot" string')
  }
  if (!isLocation(dataRoot)) {
    throw new ConfigError(`"dataRoot" must be an absolute path or an http(s) URL, not ${dataRoot}`)
  }
  const source = value["source"]
  if (source === "http") {
    throw new ConfigError(
      'There is no "source": "http": the query API serves the tree\'s documents at the tree\'s paths (ADR-0007), so keep "source": "file" and set "dataRoot" to its data path, /api/data',
    )
  }
  if (source !== "file") throw new ConfigError('config.json\'s "source" must be "file"')
  const apiBase = value["apiBase"]
  if (apiBase !== undefined && (typeof apiBase !== "string" || !isLocation(apiBase))) {
    throw new ConfigError('"apiBase", when set, must be an absolute path or an http(s) URL')
  }
  const prices = value["prices"]
  return {
    dataRoot: dataRoot.replace(/\/+$/, ""),
    source,
    ...(apiBase === undefined ? {} : { apiBase: (apiBase as string).replace(/\/+$/, "") }),
    ...(prices === undefined ? {} : { prices: parsePrices(prices) }),
  }
}

/** Fetches and checks /config.json, bypassing the HTTP cache. */
export async function loadConfig(
  fetchFn: typeof fetch = fetch,
  url: string = CONFIG_URL,
): Promise<AppConfig> {
  let response: Response
  try {
    response = await fetchFn(url, { cache: "no-store" })
  } catch (error) {
    throw new ConfigError(`could not fetch ${url}: ${errorMessage(error)}`)
  }
  if (!response.ok) throw new ConfigError(`${url} answered ${response.status}`)
  let json: unknown
  try {
    json = await response.json()
  } catch (error) {
    throw new ConfigError(`${url} is not JSON: ${errorMessage(error)}`)
  }
  return parseConfig(json)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
