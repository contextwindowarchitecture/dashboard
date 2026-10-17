// What sign-in keeps (ADR-0010): a login in flight, between the redirect to the issuer and its
// redirect back, and a session once the issuer has said who someone is. Both are found by the
// SHA-256 of the random id their cookie carries, never the id itself. The PostgreSQL store keeps
// them (migration 6); the tree has none, and its readers stay anonymous.

/** How long a login may take, from the redirect to the issuer to its redirect back. */
export const LOGIN_MS = 10 * 60_000
/** A session ends after this long unused... */
export const IDLE_MS = 2 * 3_600_000
/** ...and after this long in all. */
export const MAX_MS = 12 * 3_600_000

export interface Login {
  readonly state: string
  readonly nonce: string
  readonly verifier: string
  /** The path on this site to return to. */
  readonly returnTo: string
}

/** Who the issuer said someone is: its subject, a name to show, and the groups roles come from. */
export interface Identity {
  readonly subject: string
  readonly name: string
  readonly email?: string
  readonly groups: readonly string[]
}

export interface Session extends Identity {
  readonly createdAt: Date
  readonly expiresAt: Date
}

export interface SessionStore {
  saveLogin(idHash: string, login: Login, now: Date): Promise<void>
  /** The login, removed so it is used once; undefined when there is none or it is too old. */
  takeLogin(idHash: string, now: Date): Promise<Login | undefined>
  createSession(idHash: string, identity: Identity, now: Date): Promise<void>
  /** The session, its last use moved to now; undefined when there is none or it has ended. */
  session(idHash: string, now: Date): Promise<Session | undefined>
  /** Ends a session; false when there was none. */
  endSession(idHash: string): Promise<boolean>
}
