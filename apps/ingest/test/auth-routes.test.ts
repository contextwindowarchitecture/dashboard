// Sign-in (ADR-0010), through the routes, against an OpenID Connect issuer in this process: the flow
// end to end, every check on the issuer's answer, the cookies' attributes, where a reader may return,
// the session's end, and what answers when sign-in is not configured.

import { createHash } from "node:crypto"

import { PGlite } from "@electric-sql/pglite"
import { afterEach, describe, expect, it } from "vitest"

import { authConfigFrom, createAuth } from "../src/auth.ts"
import { createPostgresStore } from "../src/postgres-store.ts"
import type { Runner } from "../src/runner.ts"
import { createIngestServer } from "../src/server.ts"
import { IDLE_MS } from "../src/sessions.ts"
import { type Fault, startIssuer } from "./oidc-issuer.ts"
import { freePort, me, setCookie, signIn } from "./sign-in.ts"

const CLIENT = { clientId: "cwa-dashboard", clientSecret: "client-secret" }
const ADA = {
  sub: "github|42",
  name: "Ada Lovelace",
  preferred_username: "ada-l",
  email: "ada@example.com",
  groups: ["cwa:owners"],
}
const idle: Runner = { run: async () => ({ status: 503 }) as never, close: async () => {} }

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function serve(options: { configured?: boolean; clock?: { now: Date } } = {}) {
  const issuer = await startIssuer({ ...CLIENT, person: ADA })
  const db = new PGlite()
  const store = await createPostgresStore(db)
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const auth =
    options.configured === false
      ? undefined
      : createAuth({
          config: { issuer: issuer.url, ...CLIENT, redirectUri: `${base}/auth/callback` },
          sessions: store.sessions,
          ...(options.clock ? { now: () => options.clock!.now } : {}),
        })
  const server = createIngestServer({
    runner: idle,
    maxBodyBytes: 1024 * 1024,
    maxQueue: 8,
    store,
    ...(auth === undefined ? {} : { auth }),
  })
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done))
  cleanups.push(async () => {
    await new Promise((done) => server.close(() => done(undefined)))
    await db.close()
    await issuer.close()
  })
  return { base, issuer, db }
}

describe("sign-in", () => {
  it("sends the reader to the issuer with PKCE, a state and a nonce, holding the login in a Lax cookie", async () => {
    const { base, issuer } = await serve()
    const { login, loginCookie } = await signIn(base)
    expect(login.status).toBe(302)
    const to = new URL(login.headers.get("location")!)
    expect(to.origin + to.pathname).toBe(`${issuer.url}/authorize`)
    expect(to.searchParams.get("code_challenge_method")).toBe("S256")
    expect(to.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(to.searchParams.get("state")).toBeTruthy()
    expect(to.searchParams.get("nonce")).toBeTruthy()
    expect(to.searchParams.get("redirect_uri")).toBe(`${base}/auth/callback`)
    expect(to.searchParams.get("scope")?.split(" ")).toEqual(
      expect.arrayContaining(["openid", "groups"]),
    )
    expect(loginCookie!.attributes).toEqual(
      expect.arrayContaining(["httponly", "secure", "samesite=lax", "path=/", "max-age=600"]),
    )
  })

  it("signs the reader in, returns them where they were, and knows who they are", async () => {
    const { base } = await serve()
    const { callback, session } = await signIn(base, "/traces?outcome=refused")
    expect(callback.status).toBe(302)
    expect(callback.headers.get("location")).toBe("/traces?outcome=refused")
    expect(session!.value).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(session!.attributes).toEqual(
      expect.arrayContaining(["httponly", "secure", "samesite=strict", "path=/", "max-age=43200"]),
    )
    // The login cookie is spent.
    expect(setCookie(callback, "cwa_login")!.attributes).toContain("max-age=0")
    expect(await me(base, session!.value)).toMatchObject({
      sign_in: "configured",
      signed_in: true,
      name: "Ada Lovelace",
      // The issuer's preferred_username: through Dex, the GitHub login.
      username: "ada-l",
      email: "ada@example.com",
      groups: ["cwa:owners"],
    })
    expect(await me(base)).toEqual({ sign_in: "configured", signed_in: false })
  })

  it("keeps only the session id's hash", async () => {
    const { base, db } = await serve()
    const { session } = await signIn(base)
    const { rows } = await db.query<{ id_hash: string }>("select id_hash from cwa_sessions")
    expect(rows.map((r) => r.id_hash)).toEqual([
      createHash("sha256").update(session!.value).digest("hex"),
    ])
  })

  for (const fault of ["nonce", "audience", "signature", "expired", "issuer"] as Fault[]) {
    it(`refuses an ID token with the wrong ${fault}, and signs no one in`, async () => {
      const { base, issuer, db } = await serve()
      issuer.misbehave(fault)
      const { callback, session } = await signIn(base)
      expect(callback.status).toBe(400)
      expect(session).toBeUndefined()
      expect((await db.query("select * from cwa_sessions")).rows).toHaveLength(0)
    })
  }

  it("uses a login once, and refuses a callback with no login, or another state", async () => {
    const { base } = await serve()
    const { authorize, loginCookie } = await signIn(base)
    const again = await fetch(authorize.headers.get("location")!, {
      redirect: "manual",
      headers: { cookie: `cwa_login=${loginCookie!.value}` },
    })
    expect(again.status).toBe(400)
    const none = await fetch(authorize.headers.get("location")!, { redirect: "manual" })
    expect(none.status).toBe(400)
    // A fresh login, answered with a state that is not its own.
    const login = await fetch(`${base}/auth/login`, { redirect: "manual" })
    const cookie = setCookie(login, "cwa_login")!.value
    const answer = await fetch(login.headers.get("location")!, { redirect: "manual" })
    const forged = new URL(answer.headers.get("location")!)
    forged.searchParams.set("state", "not-the-state")
    const refused = await fetch(forged, {
      redirect: "manual",
      headers: { cookie: `cwa_login=${cookie}` },
    })
    expect(refused.status).toBe(400)
    expect(setCookie(refused, "cwa_session")).toBeUndefined()
  })

  it("returns a reader only to a path on this site", async () => {
    const { base } = await serve()
    for (const elsewhere of [
      "//evil.example/x",
      "https://evil.example",
      "/\\evil.example",
      "traces",
      "",
    ]) {
      const { callback } = await signIn(base, elsewhere)
      expect(callback.headers.get("location"), elsewhere).toBe("/")
    }
  })

  it("signs out on request from this site, and refuses one from another", async () => {
    const { base } = await serve()
    const { session } = await signIn(base)
    const cookie = `cwa_session=${session!.value}`
    const foreign = await fetch(`${base}/auth/logout`, {
      method: "POST",
      headers: { cookie, origin: "https://evil.example" },
    })
    expect(foreign.status).toBe(403)
    expect((await me(base, session!.value)).signed_in).toBe(true)
    const out = await fetch(`${base}/auth/logout`, {
      method: "POST",
      headers: { cookie, origin: base },
    })
    expect(out.status).toBe(204)
    expect(setCookie(out, "cwa_session")!.attributes).toContain("max-age=0")
    expect((await me(base, session!.value)).signed_in).toBe(false)
  })

  it("forgets a session left idle", async () => {
    const clock = { now: new Date("2026-10-17T12:00:00.000Z") }
    const { base } = await serve({ clock })
    const { session } = await signIn(base)
    expect((await me(base, session!.value)).signed_in).toBe(true)
    clock.now = new Date(clock.now.getTime() + IDLE_MS + 1)
    expect((await me(base, session!.value)).signed_in).toBe(false)
  })

  it("says sign-in is not configured, and sends no one anywhere", async () => {
    const { base } = await serve({ configured: false })
    expect(await me(base)).toEqual({ sign_in: "not-configured", signed_in: false })
    const login = await fetch(`${base}/auth/login`, { redirect: "manual" })
    expect(login.status).toBe(503)
    expect(((await login.json()) as { problems: string[] }).problems.join(" ")).toMatch(
      /OIDC_ISSUER/,
    )
  })
})

describe("authConfigFrom", () => {
  const ALL = {
    OIDC_ISSUER: "https://dex.example",
    OIDC_CLIENT_ID: "cwa-dashboard",
    OIDC_CLIENT_SECRET: "secret",
    OIDC_REDIRECT_URI: "https://dashboard.example/api/auth/callback",
  }

  it("reads all four settings, and the scopes when given", () => {
    expect(authConfigFrom(ALL)).toEqual({
      issuer: "https://dex.example",
      clientId: "cwa-dashboard",
      clientSecret: "secret",
      redirectUri: "https://dashboard.example/api/auth/callback",
    })
    expect(authConfigFrom({ ...ALL, OIDC_SCOPES: "openid email" })?.scopes).toBe("openid email")
  })

  it("is no sign-in without any, and a mistake with some", () => {
    expect(authConfigFrom({})).toBeUndefined()
    expect(authConfigFrom({ OIDC_ISSUER: "" })).toBeUndefined()
    expect(() => authConfigFrom({ ...ALL, OIDC_CLIENT_SECRET: "" })).toThrow(
      /missing OIDC_CLIENT_SECRET/,
    )
  })
})

describe("an issuer reached at an internal address", () => {
  it("signs in through it while the tokens and the reader name the public one", async () => {
    // The issuer calls itself by the address a browser reaches it at, which this process cannot.
    const PUBLIC = "http://login.example.invalid/dex"
    const issuer = await startIssuer({ ...CLIENT, person: ADA, publicUrl: PUBLIC })
    const db = new PGlite()
    const store = await createPostgresStore(db)
    const port = await freePort()
    const base = `http://127.0.0.1:${port}`
    const server = createIngestServer({
      runner: idle,
      maxBodyBytes: 1024 * 1024,
      maxQueue: 8,
      store,
      auth: createAuth({
        config: {
          issuer: PUBLIC,
          internal: issuer.listening,
          ...CLIENT,
          redirectUri: `${base}/auth/callback`,
        },
        sessions: store.sessions,
        // Its public address is plain HTTP and not this machine's, as in the compose stack.
        allowHttp: true,
      }),
    })
    await new Promise<void>((done) => server.listen(port, "127.0.0.1", done))
    cleanups.push(async () => {
      await new Promise((done) => server.close(() => done(undefined)))
      await db.close()
      await issuer.close()
    })
    const login = await fetch(`${base}/auth/login`, { redirect: "manual" })
    const to = login.headers.get("location")!
    // The reader is sent to the public address...
    expect(to.startsWith(`${PUBLIC}/authorize?`)).toBe(true)
    // ...which a browser would reach through the proxy; here, the issuer itself.
    const authorize = await fetch(to.replace(PUBLIC, issuer.listening), { redirect: "manual" })
    const callback = await fetch(authorize.headers.get("location")!, {
      redirect: "manual",
      headers: { cookie: `cwa_login=${setCookie(login, "cwa_login")!.value}` },
    })
    expect(callback.status).toBe(302)
    expect(setCookie(callback, "cwa_session")).toBeDefined()
  })

  it("reads the internal address from the environment, only beside the others", () => {
    const ALL = {
      OIDC_ISSUER: "https://dashboard.example/dex",
      OIDC_CLIENT_ID: "c",
      OIDC_CLIENT_SECRET: "s",
      OIDC_REDIRECT_URI: "https://dashboard.example/api/auth/callback",
    }
    expect(
      authConfigFrom({ ...ALL, OIDC_ISSUER_INTERNAL: "http://dashboard-dex:5556/dex" })?.internal,
    ).toBe("http://dashboard-dex:5556/dex")
    expect(authConfigFrom(ALL)?.internal).toBeUndefined()
  })
})
