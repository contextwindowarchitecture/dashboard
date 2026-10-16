import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { CONTENT_SECURITY_POLICY } from "./csp.ts"

const nginx = resolve(import.meta.dirname, "../../../deploy/base/nginx")
const conf = readFileSync(resolve(nginx, "dashboard.conf"), "utf8")
const headers = readFileSync(resolve(nginx, "headers.inc"), "utf8")
const proxy = readFileSync(resolve(nginx, "ingest-proxy.conf"), "utf8")
// Each location block, by its match, with its body.
const locations = new Map(
  // A block ends at the closing brace on a line of its own, since a location's pattern may hold braces.
  [...`${conf}\n${proxy}`.matchAll(/^location\s+(.+?)\s*\{\n([\s\S]*?)^\}/gm)].map(
    (m) => [m[1]!.trim(), m[2]!] as const,
  ),
)

describe("the deployment's nginx", () => {
  it("sends the Content Security Policy the app is tested under, exactly", () => {
    const sent = /add_header Content-Security-Policy "([^"]+)" always;/.exec(headers)
    expect(sent?.[1]).toBe(CONTENT_SECURITY_POLICY)
  })

  it("repeats the security headers in every location that sets a header of its own", () => {
    for (const [match, body] of locations) {
      if (body.includes("add_header"))
        expect(body, match).toContain("include /opt/app-root/etc/nginx.default.d/headers.inc;")
    }
  })

  it("proxies /api/ to the ingest service, taking bodies as large as the service does", () => {
    const api = locations.get("/api/")!
    expect(api).toMatch(/proxy_pass http:\/\/dashboard-ingest:8090\/;/)
    const limit = /client_max_body_size (\d+)m;/.exec(api)
    expect(Number(limit?.[1])).toBeGreaterThanOrEqual(4)
  })

  it("caches an event for good, and never what changes as events arrive", () => {
    expect(locations.get('~ "^/data/events/[0-9A-HJKMNP-TV-Z]{26}\\.json$"')).toContain("immutable")
    for (const changing of [
      "= /data/events/index.json",
      "/data/events/index/",
      "/data/sessions/",
      "= /data/fleet.json",
      "= /config.json",
      "= /index.html",
    ]) {
      expect(locations.get(changing), changing).toContain(
        'add_header Cache-Control "no-cache" always;',
      )
    }
    expect(conf).toMatch(/autoindex off;/)
  })
})
