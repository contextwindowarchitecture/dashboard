// The runtime configuration (dashboard-plan.md 9): served beside the build as /config.json, so one
// build serves every deployment. It names where the data tree is served and, when there is one, the
// replay service. A missing or malformed document is an error the app shows, never a default.

export interface AppConfig {
  /** Where the tree (events/, sessions/, fleet.json) is served, without a trailing slash. */
  readonly dataRoot: string
  /** How the tree is read: files in Phase 1; the query API arrives in Phase 2. */
  readonly source: "file"
  /** The Node service's base (POST /replay); absent, the sandbox says it is not configured. */
  readonly apiBase?: string
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
      '"source": "http" reads the query API, which arrives in Phase 2; use "file"',
    )
  }
  if (source !== "file") throw new ConfigError('config.json\'s "source" must be "file"')
  const apiBase = value["apiBase"]
  if (apiBase !== undefined && (typeof apiBase !== "string" || !isLocation(apiBase))) {
    throw new ConfigError('"apiBase", when set, must be an absolute path or an http(s) URL')
  }
  return {
    dataRoot: dataRoot.replace(/\/+$/, ""),
    source,
    ...(apiBase === undefined ? {} : { apiBase: (apiBase as string).replace(/\/+$/, "") }),
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
