// Sign-in (ADR-0010): the API is the OpenID Connect client, with the authorization code flow, PKCE,
// a state and a nonce, through openid-client, which checks the ID token against the issuer's keys.
// The page only ever holds cookies it cannot read: cwa_login while a login is in flight (Lax, as the
// issuer's redirect back is a navigation from another site) and cwa_session after (Strict). The
// store keeps each id's SHA-256, never the id.

import { createHash, randomBytes } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"

import * as oidc from "openid-client"

import { LOGIN_MS, MAX_MS, type Session, type SessionStore } from "./sessions.ts"

export interface AuthConfig {
  readonly issuer: string
  readonly clientId: string
  readonly clientSecret: string
  /** The public address of /auth/callback, as registered with the issuer. */
  readonly redirectUri: string
  /** The scopes asked for; `groups` is how roles arrive (Dex, Keycloak). */
  readonly scopes?: string
}

const SETTINGS = [
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_REDIRECT_URI",
] as const

/** The configuration the environment names: all four settings, or none; some is a mistake. */
export function authConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
): AuthConfig | undefined {
  const given = SETTINGS.filter((name) => (env[name] ?? "") !== "")
  if (given.length === 0) return undefined
  if (given.length < SETTINGS.length) {
    throw new Error(
      `Sign-in needs all of ${SETTINGS.join(", ")}; missing ${SETTINGS.filter((n) => !given.includes(n)).join(", ")}`,
    )
  }
  return {
    issuer: env["OIDC_ISSUER"]!,
    clientId: env["OIDC_CLIENT_ID"]!,
    clientSecret: env["OIDC_CLIENT_SECRET"]!,
    redirectUri: env["OIDC_REDIRECT_URI"]!,
    ...((env["OIDC_SCOPES"] ?? "") === "" ? {} : { scopes: env["OIDC_SCOPES"]! }),
  }
}

const hash = (id: string) => createHash("sha256").update(id).digest("hex")
const newId = () => randomBytes(32).toString("base64url")

function cookies(request: IncomingMessage): Map<string, string> {
  const jar = new Map<string, string>()
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=")
    if (at > 0) jar.set(part.slice(0, at).trim(), part.slice(at + 1).trim())
  }
  return jar
}

const cookie = (name: string, value: string, sameSite: "Lax" | "Strict", maxAgeMs: number) =>
  `${name}=${value}; HttpOnly; Secure; SameSite=${sameSite}; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}`

/** A path on this site to return to, or `/`: one leading slash, never two, never a backslash. */
export function returnPath(given: string | null): string {
  if (given === null || !/^\/(?![/\\])/.test(given) || /[\\\p{Cc}]/u.test(given)) return "/"
  return given
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"])

export interface AuthOptions {
  readonly config: AuthConfig
  readonly sessions: SessionStore
  readonly now?: () => Date
  /** An issuer over plain HTTP: allowed on the loopback interface (tests), else only when asked. */
  readonly allowHttp?: boolean
}

export type Auth = ReturnType<typeof createAuth>

export function createAuth({ config, sessions, now = () => new Date(), allowHttp }: AuthOptions) {
  const issuer = new URL(config.issuer)
  const insecure =
    issuer.protocol === "http:" && (allowHttp === true || LOOPBACK.has(issuer.hostname))
  const site = new URL(config.redirectUri).origin
  let discovered: Promise<oidc.Configuration> | undefined
  // Discovered once and kept; a failure is forgotten, so the next sign-in asks again.
  const client = () => {
    discovered ??= oidc
      .discovery(issuer, config.clientId, config.clientSecret, undefined, {
        // The ID token's signature is checked against the issuer's keys too, not left to TLS: the
        // library leaves it out by default for a token fetched over TLS (OIDC Core 3.1.3.7), and an
        // issuer reached over plain HTTP has no TLS to stand in for it.
        execute: [
          oidc.enableNonRepudiationChecks,
          ...(insecure ? [oidc.allowInsecureRequests] : []),
        ],
      })
      .catch((error: unknown) => {
        discovered = undefined
        throw error
      })
    return discovered
  }

  const send = (
    response: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string | string[]> = {},
  ) => {
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    })
    response.end(JSON.stringify(body))
  }
  const fail = (
    response: ServerResponse,
    status: number,
    kind: string,
    problem: string,
    headers = {},
  ) => send(response, status, { ok: false, kind, problems: [problem] }, headers)

  /** The signed-in reader of a request, or undefined. */
  async function identify(request: IncomingMessage): Promise<Session | undefined> {
    const id = cookies(request).get("cwa_session")
    return id === undefined || id === "" ? undefined : sessions.session(hash(id), now())
  }

  async function login(response: ServerResponse, url: URL) {
    let configuration: oidc.Configuration
    try {
      configuration = await client()
    } catch (error) {
      process.stderr.write(
        `ingest: sign-in: the issuer did not answer: ${error instanceof Error ? error.message : String(error)}\n`,
      )
      return fail(response, 503, "unavailable", "The issuer did not answer; try again shortly.")
    }
    const verifier = oidc.randomPKCECodeVerifier()
    const state = oidc.randomState()
    const nonce = oidc.randomNonce()
    const id = newId()
    await sessions.saveLogin(
      hash(id),
      { state, nonce, verifier, returnTo: returnPath(url.searchParams.get("return")) },
      now(),
    )
    const to = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: config.redirectUri,
      scope: config.scopes ?? "openid profile email groups",
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
    })
    response.writeHead(302, {
      location: to.href,
      "cache-control": "no-store",
      "set-cookie": cookie("cwa_login", id, "Lax", LOGIN_MS),
    })
    response.end()
  }

  async function callback(request: IncomingMessage, response: ServerResponse, url: URL) {
    const spent = cookie("cwa_login", "", "Lax", 0)
    const id = cookies(request).get("cwa_login")
    const pending =
      id === undefined || id === "" ? undefined : await sessions.takeLogin(hash(id), now())
    if (pending === undefined) {
      return fail(response, 400, "no-login", "No sign-in is under way here; start again.", {
        "set-cookie": spent,
      })
    }
    let claims: oidc.IDToken | undefined
    try {
      const configuration = await client()
      const answer = new URL(config.redirectUri)
      answer.search = url.search
      const tokens = await oidc.authorizationCodeGrant(configuration, answer, {
        pkceCodeVerifier: pending.verifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      })
      claims = tokens.claims()
    } catch (error) {
      // The detail stays in the log: it can name the issuer's internals, never a token.
      process.stderr.write(
        `ingest: sign-in refused: ${error instanceof Error ? error.message : String(error)}\n`,
      )
      return fail(
        response,
        400,
        "refused",
        "The issuer's answer did not check out; sign in again.",
        { "set-cookie": spent },
      )
    }
    if (claims === undefined) {
      return fail(response, 400, "refused", "The issuer sent no ID token; sign in again.", {
        "set-cookie": spent,
      })
    }
    const text = (key: string) =>
      typeof claims![key] === "string" && claims![key] !== "" ? (claims![key] as string) : undefined
    const groups = Array.isArray(claims["groups"])
      ? claims["groups"].filter((g): g is string => typeof g === "string")
      : []
    const email = text("email")
    const session = newId()
    await sessions.createSession(
      hash(session),
      {
        subject: claims.sub,
        name: text("name") ?? text("preferred_username") ?? email ?? claims.sub,
        ...(email === undefined ? {} : { email }),
        groups,
      },
      now(),
    )
    response.writeHead(302, {
      location: pending.returnTo,
      "cache-control": "no-store",
      "set-cookie": [spent, cookie("cwa_session", session, "Strict", MAX_MS)],
    })
    response.end()
  }

  async function logout(request: IncomingMessage, response: ServerResponse) {
    const origin = request.headers.origin
    if (origin !== undefined && origin !== site) {
      return fail(response, 403, "forbidden", "A sign-out comes from this site only.")
    }
    const id = cookies(request).get("cwa_session")
    if (id !== undefined && id !== "") await sessions.endSession(hash(id))
    response.writeHead(204, {
      "cache-control": "no-store",
      "set-cookie": cookie("cwa_session", "", "Strict", 0),
    })
    response.end()
  }

  async function me(request: IncomingMessage, response: ServerResponse) {
    const session = await identify(request)
    if (session === undefined)
      return send(response, 200, { sign_in: "configured", signed_in: false })
    return send(response, 200, {
      sign_in: "configured",
      signed_in: true,
      name: session.name,
      ...(session.email === undefined ? {} : { email: session.email }),
      groups: session.groups,
      expires_at: session.expiresAt.toISOString(),
    })
  }

  return { identify, login, callback, logout, me }
}
