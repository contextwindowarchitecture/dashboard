// Serves the app's data in development and preview (dashboard-plan.md 9), as nginx does in a
// deployment: /config.json with the demo's configuration (naming the replay service's base when the
// server proxies one, as vite.config.ts does with VITE_API_TARGET, and the documents' root when
// VITE_DATA_ROOT moves it to the query API's /api/data), and /data/ from the committed demo tree
// (packages/demo-traffic/fixtures) or $VITE_DATA_DIR. JSON files only, 404 on a miss, no listing,
// nothing outside the tree.

import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve, sep } from "node:path"

import type { Plugin, PreviewServer, ViteDevServer } from "vite"

export const DEMO_CONFIG = { dataRoot: "/data", source: "file" } as const
const PREFIX = "/data/"

export type DataRequest =
  | { kind: "config"; body: object }
  | { kind: "file"; path: string }
  | { kind: "not-found" }
  | { kind: "pass" }

export interface DataOptions {
  /** The replay service's base, when the server proxies one. */
  readonly apiBase?: string
  /** Where config.json says the documents are: /data (this plugin's tree) or the API's /api/data. */
  readonly dataRoot?: string
}

export function resolveDataRequest(
  url: string,
  dir: string,
  options: DataOptions = {},
): DataRequest {
  const pathname = url.split("?")[0] ?? ""
  if (pathname === "/config.json") {
    return {
      kind: "config",
      body: {
        ...DEMO_CONFIG,
        ...(options.dataRoot === undefined ? {} : { dataRoot: options.dataRoot }),
        ...(options.apiBase === undefined ? {} : { apiBase: options.apiBase }),
      },
    }
  }
  if (!pathname.startsWith(PREFIX) && pathname !== "/data") return { kind: "pass" }
  let relative: string
  try {
    relative = decodeURIComponent(pathname.slice(PREFIX.length))
  } catch {
    return { kind: "not-found" }
  }
  const root = resolve(dir)
  const path = resolve(root, relative)
  const inside = path.startsWith(root + sep)
  if (!inside || !path.endsWith(".json") || !existsSync(path) || !statSync(path).isFile()) {
    return { kind: "not-found" }
  }
  return { kind: "file", path }
}

export function dataPlugin(dir: string, options: DataOptions = {}): Plugin {
  const mount = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((request, response, next) => {
      const resolved = resolveDataRequest(request.url ?? "/", dir, options)
      if (resolved.kind === "pass") return next()
      if (resolved.kind === "not-found") {
        response.statusCode = 404
        response.setHeader("Content-Type", "text/plain; charset=utf-8")
        response.end("not found")
        return
      }
      response.setHeader("Content-Type", "application/json; charset=utf-8")
      response.setHeader("Cache-Control", "no-cache")
      response.end(
        resolved.kind === "config" ? JSON.stringify(resolved.body) : readFileSync(resolved.path),
      )
    })
  }
  return { name: "cwa-data", configureServer: mount, configurePreviewServer: mount }
}
