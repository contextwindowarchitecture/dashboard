// A fetch over the committed demo tree, for tests: `${root}/<path>` reads
// packages/demo-traffic/fixtures/<path> from disk and 404s when it is not there, and
// /config.json answers with the configuration a deployment would serve. Overrides answer a URL with
// a status or a body, or throw for it, so every failure state can be produced.

import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"

export const FIXTURES_DIR = resolve(
  import.meta.dirname,
  "../../../../packages/demo-traffic/fixtures",
)
export const DATA_ROOT = "/data"

export type Override = { status: number; body?: string } | { throws: "network" }

export interface FixtureFetchOptions {
  readonly root?: string
  readonly dir?: string
  /** The configuration /config.json answers with; the demo's when absent. */
  readonly config?: unknown
  /** URLs answered otherwise, for failure states. */
  readonly overrides?: Record<string, Override>
  /** Called with every request, for assertions on what a page fetched. */
  readonly onRequest?: (url: string) => void
  /** Holds a request until the promise it returns settles, for states seen mid-request. */
  readonly hold?: (url: string) => Promise<void> | undefined
}

export function fixtureFetch(options: FixtureFetchOptions = {}): typeof fetch {
  const root = options.root ?? DATA_ROOT
  const dir = options.dir ?? FIXTURES_DIR
  const config = options.config ?? { dataRoot: root, source: "file" }
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    options.onRequest?.(url)
    await options.hold?.(url)
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError")
    const override = options.overrides?.[url]
    if (override) {
      if ("throws" in override) throw new TypeError("Failed to fetch")
      return new Response(override.body ?? "", { status: override.status })
    }
    if (url === "/config.json") return Response.json(config)
    if (!url.startsWith(`${root}/`)) return new Response("not found", { status: 404 })
    const relative = decodeURIComponent(url.slice(root.length + 1))
    if (relative.includes("..")) return new Response("not found", { status: 404 })
    try {
      const body = await readFile(join(dir, relative), "utf8")
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } })
    } catch {
      return new Response("not found", { status: 404 })
    }
  }
}
