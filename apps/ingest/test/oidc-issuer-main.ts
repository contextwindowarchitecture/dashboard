// The test issuer as a process, for the browser tests over the query API (playwright.api.config.ts):
// OIDC_TEST_PORT, OIDC_TEST_CLIENT_ID and OIDC_TEST_CLIENT_SECRET from the environment; it signs Ada
// in, a member of cwa:owners. Never part of a deployment.

import { startIssuer } from "./oidc-issuer.ts"

const issuer = await startIssuer({
  port: Number(process.env["OIDC_TEST_PORT"]),
  clientId: process.env["OIDC_TEST_CLIENT_ID"]!,
  clientSecret: process.env["OIDC_TEST_CLIENT_SECRET"]!,
  person: {
    sub: "test|ada",
    name: "Ada Lovelace",
    email: "ada@example.com",
    groups: ["cwa:owners"],
  },
})
process.stdout.write(`test issuer: ${issuer.url}\n`)
const stop = () => void issuer.close().then(() => process.exit(0))
process.on("SIGTERM", stop)
process.on("SIGINT", stop)
