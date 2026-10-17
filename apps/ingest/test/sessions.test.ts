// The sessions sign-in keeps (ADR-0010): a login in flight, used once and short-lived, and a session
// that ends after two idle hours or twelve in all. The store sees only hashed ids. Held on PGlite and,
// with TEST_DATABASE_URL, on a PostgreSQL server.

import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"

import { createPostgresStore } from "../src/postgres-store.ts"
import { IDLE_MS, LOGIN_MS, MAX_MS, type SessionStore } from "../src/sessions.ts"
import { emptyServerDatabase, SERVER } from "./server-database.ts"

const T0 = new Date("2026-10-17T12:00:00.000Z")
const at = (ms: number) => new Date(T0.getTime() + ms)
const LOGIN = { state: "s", nonce: "n", verifier: "v", returnTo: "/traces" }
const WHO = { subject: "github|42", name: "Ada", email: "ada@example.com", groups: ["cwa:owners"] }
const HASH = "a".repeat(64)

function sessionContract(
  name: string,
  open: () => Promise<{ sessions: SessionStore; done: () => Promise<void> }>,
) {
  describe(name, () => {
    const withStore = async (test: (sessions: SessionStore) => Promise<void>) => {
      const { sessions, done } = await open()
      try {
        await test(sessions)
      } finally {
        await done()
      }
    }

    it("gives a login back once, and not after ten minutes", () =>
      withStore(async (sessions) => {
        await sessions.saveLogin(HASH, LOGIN, T0)
        expect(await sessions.takeLogin(HASH, at(1000))).toEqual(LOGIN)
        expect(await sessions.takeLogin(HASH, at(1000))).toBeUndefined()
        await sessions.saveLogin(HASH, LOGIN, T0)
        expect(await sessions.takeLogin(HASH, at(LOGIN_MS + 1))).toBeUndefined()
      }))

    it("keeps a session while it is used, and knows who it is", () =>
      withStore(async (sessions) => {
        await sessions.createSession(HASH, WHO, T0)
        const seen = await sessions.session(HASH, at(IDLE_MS - 1))
        expect(seen).toMatchObject({ ...WHO, expiresAt: at(MAX_MS) })
        // Used just now, so idle time starts again from here.
        expect(await sessions.session(HASH, at(2 * IDLE_MS - 2))).toBeDefined()
      }))

    it("ends a session left idle for two hours", () =>
      withStore(async (sessions) => {
        await sessions.createSession(HASH, WHO, T0)
        expect(await sessions.session(HASH, at(IDLE_MS + 1))).toBeUndefined()
      }))

    it("ends a session after twelve hours however it is used", () =>
      withStore(async (sessions) => {
        await sessions.createSession(HASH, WHO, T0)
        for (let t = IDLE_MS / 2; t < MAX_MS; t += IDLE_MS / 2) {
          expect(await sessions.session(HASH, at(t)), String(t)).toBeDefined()
        }
        expect(await sessions.session(HASH, at(MAX_MS + 1))).toBeUndefined()
      }))

    it("ends a session on request, and knows no other", () =>
      withStore(async (sessions) => {
        expect(await sessions.session(HASH, T0)).toBeUndefined()
        await sessions.createSession(HASH, WHO, T0)
        expect(await sessions.endSession(HASH)).toBe(true)
        expect(await sessions.session(HASH, T0)).toBeUndefined()
        expect(await sessions.endSession(HASH)).toBe(false)
      }))
  })
}

sessionContract("sessions in PGlite", async () => {
  const db = new PGlite()
  const store = await createPostgresStore(db, { end: () => db.close() })
  return { sessions: store.sessions, done: () => store.close() }
})

if (SERVER !== undefined) {
  sessionContract("sessions on a PostgreSQL server", async () => {
    const pool = await emptyServerDatabase()
    const store = await createPostgresStore(pool, { end: () => pool.end() })
    return { sessions: store.sessions, done: () => store.close() }
  })
}
