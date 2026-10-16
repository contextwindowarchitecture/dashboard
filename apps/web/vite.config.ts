import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import path from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

import { contentSecurityPolicyPlugin } from "./dev/csp.ts"
import { dataPlugin } from "./dev/data-plugin.ts"

const root = import.meta.dirname
// The data tree the dev and preview servers serve: the committed demo tree unless told otherwise.
const dataDir =
  process.env["VITE_DATA_DIR"] ?? path.resolve(root, "../../packages/demo-traffic/fixtures")

// The replay service (apps/ingest) to proxy /api to, when there is one: `pnpm dev` and the browser
// tests set it, so the app reaches the service on its own origin, as nginx proxies it in a deployment.
const apiTarget = process.env["VITE_API_TARGET"]
const proxy =
  apiTarget === undefined
    ? undefined
    : { "/api": { target: apiTarget, rewrite: (p: string) => p.replace(/^\/api/, "") } }

// The commit the app is built from, for the footer.
function buildCommit(): string {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim()
  } catch {
    return "dev"
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  // Dev only: Vite's client and React's refresh preamble are inline scripts. With a nonce Vite
  // stamps the tags it injects and the policy admits them; the build injects no inline script, so
  // the preview server sends the production policy unchanged.
  const nonce = command === "serve" ? randomBytes(16).toString("base64") : undefined
  return {
    plugins: [
      react(),
      tailwindcss(),
      contentSecurityPolicyPlugin(nonce),
      dataPlugin(dataDir, apiTarget === undefined ? {} : { apiBase: "/api" }),
    ],
    ...(proxy === undefined ? {} : { server: { proxy }, preview: { proxy } }),
    html: nonce === undefined ? {} : { cspNonce: nonce },
    define: { __BUILD_COMMIT__: JSON.stringify(buildCommit()) },
    resolve: {
      alias: {
        "@": path.resolve(root, "./src"),
      },
    },
  }
})
