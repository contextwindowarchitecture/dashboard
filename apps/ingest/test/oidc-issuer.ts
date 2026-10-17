// An OpenID Connect issuer in this process, for the sign-in tests (ADR-0010): discovery, its keys, an
// authorization endpoint that signs the configured person straight in, and a token endpoint that
// checks the code, the PKCE verifier and the client's secret before it signs an RS256 ID token. It
// can be told to answer wrongly, one way at a time, so each check the API relies on is seen to hold.
// No network leaves the machine.

import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

export type Fault = "nonce" | "audience" | "signature" | "expired" | "issuer"

export interface IssuerOptions {
  readonly clientId: string
  readonly clientSecret: string
  /** The claims of the person who signs in. */
  readonly person: Record<string, unknown>
  /** A fixed port, for a browser test that names it in configuration; any free one when absent. */
  readonly port?: number
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url")

export async function startIssuer(options: IssuerOptions) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const kid = "test-key"
  const codes = new Map<string, { nonce: string; challenge: string; redirectUri: string }>()
  let fault: Fault | undefined
  let person = options.person
  let url = ""

  function idToken(nonce: string) {
    const now = Math.floor(Date.now() / 1000)
    const payload = {
      iss: fault === "issuer" ? "https://elsewhere.example" : url,
      sub: String(person["sub"]),
      aud: fault === "audience" ? "another-client" : options.clientId,
      iat: now,
      exp: fault === "expired" ? now - 3600 : now + 300,
      nonce: fault === "nonce" ? "not-the-nonce" : nonce,
      ...person,
    }
    const signed = `${base64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`
    const signature = sign("sha256", Buffer.from(signed), privateKey)
    if (fault === "signature") signature[0] = signature[0]! ^ 0xff
    return `${signed}.${base64url(signature)}`
  }

  const server: Server = createServer((request, response) => {
    const at = new URL(request.url ?? "/", url)
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body))
    }
    if (at.pathname === "/.well-known/openid-configuration") {
      return json(200, {
        issuer: url,
        authorization_endpoint: `${url}/authorize`,
        token_endpoint: `${url}/token`,
        jwks_uri: `${url}/keys`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
        scopes_supported: ["openid", "profile", "email", "groups"],
      })
    }
    if (at.pathname === "/keys") {
      return json(200, {
        keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }],
      })
    }
    if (at.pathname === "/authorize") {
      const q = at.searchParams
      if (q.get("client_id") !== options.clientId || q.get("code_challenge_method") !== "S256") {
        return json(400, { error: "invalid_request" })
      }
      const code = base64url(randomBytes(16))
      codes.set(code, {
        nonce: q.get("nonce") ?? "",
        challenge: q.get("code_challenge") ?? "",
        redirectUri: q.get("redirect_uri") ?? "",
      })
      const back = new URL(q.get("redirect_uri")!)
      back.searchParams.set("code", code)
      back.searchParams.set("state", q.get("state") ?? "")
      response.writeHead(302, { location: back.href }).end()
      return
    }
    if (at.pathname === "/token" && request.method === "POST") {
      let text = ""
      request.on("data", (chunk) => (text += chunk))
      request.on("end", () => {
        const form = new URLSearchParams(text)
        const basic = (request.headers.authorization ?? "").replace(/^Basic /, "")
        const [basicId, basicSecret] = Buffer.from(basic, "base64")
          .toString()
          .split(":")
          .map(decodeURIComponent)
        const clientId = form.get("client_id") ?? basicId
        const secret = form.get("client_secret") ?? basicSecret
        if (clientId !== options.clientId || secret !== options.clientSecret) {
          return json(401, { error: "invalid_client" })
        }
        const granted = codes.get(form.get("code") ?? "")
        codes.delete(form.get("code") ?? "")
        const verifier = form.get("code_verifier") ?? ""
        const challenge = base64url(createHash("sha256").update(verifier).digest())
        if (
          granted === undefined ||
          granted.redirectUri !== form.get("redirect_uri") ||
          challenge !== granted.challenge
        ) {
          return json(400, { error: "invalid_grant" })
        }
        return json(200, {
          access_token: base64url(randomBytes(16)),
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken(granted.nonce),
        })
      })
      return
    }
    json(404, { error: "not_found" })
  })
  await new Promise<void>((done) => server.listen(options.port ?? 0, "127.0.0.1", done))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url,
    /** Answer wrongly in this one way from now on; undefined answers rightly again. */
    misbehave: (next: Fault | undefined) => (fault = next),
    signInAs: (next: Record<string, unknown>) => (person = next),
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
}
