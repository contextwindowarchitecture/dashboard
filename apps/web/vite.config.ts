import { randomBytes } from "node:crypto"
import path from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

import { contentSecurityPolicyPlugin } from "./dev/csp.ts"

const root = import.meta.dirname

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  // Dev only: Vite's client and React's refresh preamble are inline scripts. With a nonce Vite
  // stamps the tags it injects and the policy admits them; the build injects no inline script, so
  // the preview server sends the production policy unchanged.
  const nonce = command === "serve" ? randomBytes(16).toString("base64") : undefined
  return {
    plugins: [react(), tailwindcss(), contentSecurityPolicyPlugin(nonce)],
    html: nonce === undefined ? {} : { cspNonce: nonce },
    resolve: {
      alias: {
        "@": path.resolve(root, "./src"),
      },
    },
  }
})
