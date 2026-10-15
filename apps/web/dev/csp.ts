// The dashboard's Content Security Policy, defined once (AGENTS.md, "Never loosen the Content
// Security Policy"). The dev and preview servers send it on every response, so the browser tests
// run under it, and the deployment's nginx headers are held to this string by a test.
//
// Scripts are the app's own files only: no inline script and no eval, which is why the validators
// are generated at build and the assembler never runs in the browser. Styles allow inline
// attributes and elements, which the generated primitives inject; fonts and images allow data:
// URIs, which the build inlines for small assets.

import type { Plugin, PreviewServer, ViteDevServer } from "vite"

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ")

/** The policy, admitting by nonce the inline scripts the dev server injects (its client, React's refresh). */
export function contentSecurityPolicy(nonce: string | undefined): string {
  return nonce === undefined
    ? CONTENT_SECURITY_POLICY
    : CONTENT_SECURITY_POLICY.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`)
}

/** Sends the policy on every response of the dev and preview servers. */
export function contentSecurityPolicyPlugin(nonce: string | undefined): Plugin {
  const mount = (server: ViteDevServer | PreviewServer, policy: string) => {
    server.middlewares.use((_request, response, next) => {
      response.setHeader("Content-Security-Policy", policy)
      next()
    })
  }
  return {
    name: "cwa-content-security-policy",
    configureServer: (server) => mount(server, contentSecurityPolicy(nonce)),
    configurePreviewServer: (server) => mount(server, CONTENT_SECURITY_POLICY),
  }
}
