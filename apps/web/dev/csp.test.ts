import { describe, expect, it } from "vitest"

import { CONTENT_SECURITY_POLICY, contentSecurityPolicy } from "./csp.ts"

const directives = (policy: string) =>
  new Map(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/)
      return [name!, values] as const
    }),
  )

// AGENTS.md, "Never loosen the Content Security Policy".
describe("the Content Security Policy", () => {
  it("runs only the app's own scripts, with no inline script and no eval", () => {
    const policy = directives(CONTENT_SECURITY_POLICY)
    expect(policy.get("script-src")).toEqual(["'self'"])
    expect(policy.get("default-src")).toEqual(["'self'"])
    expect(policy.get("connect-src")).toEqual(["'self'"])
    expect(policy.get("worker-src")).toEqual(["'self'"])
    expect(policy.get("frame-ancestors")).toEqual(["'none'"])
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-eval|wasm-unsafe-eval|https?:|\*/)
  })

  it("admits the dev server's injected scripts by nonce, and nothing else", () => {
    const dev = directives(contentSecurityPolicy("abc123"))
    expect(dev.get("script-src")).toEqual(["'self'", "'nonce-abc123'"])
    const others = (map: Map<string, readonly string[]>) =>
      [...map].filter(([name]) => name !== "script-src")
    expect(others(dev)).toEqual(others(directives(CONTENT_SECURITY_POLICY)))
    expect(contentSecurityPolicy(undefined)).toBe(CONTENT_SECURITY_POLICY)
  })
})
