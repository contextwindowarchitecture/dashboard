// The Phase 1 Node service's HTTP face (dashboard-plan.md 7.8, 11; D9, D12), on Node's own http:
// GET /healthz; GET /replay/components, the published tokenizers and renderers with whether each is
// required and whether this assembler provides it; POST /replay, a JSON snapshot in, the replay's
// result out, which writes nothing; and POST /events, an assembly event in, written into the tree
// for a caller with the bearer token; and the vault's /bodies/<sha256> (ADR-0009), deposited with
// that token and read or erased with the operator's. Bodies are size-limited and the replay queue
// bounded.

import { timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { RENDERERS, TOKENIZERS } from "@cwa-dashboard/assembler"
import { COMPONENTS } from "@cwa-dashboard/contract/data"

import {
  type Access,
  mayOwn,
  mayRead,
  type Role,
  rolesOf,
  routeOf,
  withholdBodies,
} from "./access.ts"
import type { Auth } from "./auth.ts"
import type { Session } from "./sessions.ts"
import { ReplayTimeoutError, type Runner } from "./runner.ts"
import { buildBundle, type SigningKey } from "./bundle.ts"
import { CORPUS_NAME, type EventStore as Store } from "./event-store.ts"
import { shadowReport, type Candidate } from "./shadow.ts"
import { type BodyVault, checkDeposit, SHA256 } from "./vault.ts"

export interface IngestOptions {
  readonly runner: Runner
  /** The largest request body read, in bytes. */
  readonly maxBodyBytes: number
  /** How many replays may wait or run at once before the service answers 503. */
  readonly maxQueue: number
  /** The event tree POST /events writes into; without it the route takes no writes. */
  readonly store?: Store
  /** The bearer token POST /events requires; without it the route takes no writes. */
  readonly token?: string
  /** The Ed25519 key compliance bundles are signed with; without it none is signed. */
  readonly signingKey?: SigningKey
  /** Where deposited bodies are kept (ADR-0009); without it PUT /bodies takes none. */
  readonly vault?: BodyVault
  /** The operator token GET and DELETE /bodies require; never the ingest token. */
  readonly vaultToken?: string
  /** Sign-in (ADR-0010); without it /auth answers 503 and every reader is anonymous. */
  readonly auth?: Auth
  /** Who may read what (ADR-0011); without it every reader reads everything. */
  readonly access?: Access
}

/** Who asks: their session, and with an access file, the roles it gives them. */
interface Reader {
  readonly session: Session | undefined
  readonly held: Set<Role> | undefined
}

/** A corpus's most events (ADR-0008): a shadow run is two replays an event. */
const MAX_CORPUS = 200

function send(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  })
  response.end(JSON.stringify(body))
}

const fail = (response: ServerResponse, status: number, kind: string, problems: string[]) =>
  send(response, status, { ok: false, kind, problems })

class TooLargeError extends Error {}

const readBody = async (request: IncomingMessage, limit: number) =>
  (await readBytes(request, limit)).toString("utf8")

function readBytes(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(request.headers["content-length"])
  if (Number.isFinite(declared) && declared > limit) return Promise.reject(new TooLargeError())
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        request.removeAllListeners("data")
        reject(new TooLargeError())
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => resolve(Buffer.concat(chunks)))
    request.on("error", reject)
  })
}

const components = () => ({
  tokenizers: COMPONENTS.tokenizers.map((c) => ({
    ...c,
    provided: Object.hasOwn(TOKENIZERS, c.id),
  })),
  renderers: COMPONENTS.renderers.map((c) => ({ ...c, provided: RENDERERS.includes(c.id) })),
})

/** Whether the request carries the token, compared in constant time. */
function authorised(request: IncomingMessage, token: string) {
  const header = request.headers["authorization"] ?? ""
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "")
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** A JSON body, or the response already sent saying why there is none. */
async function readJsonBody(
  request: IncomingMessage,
  response: ServerResponse,
  limit: number,
  what: string,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const type = request.headers["content-type"] ?? ""
  if (!/^application\/json\b/.test(type)) {
    fail(response, 415, "unsupported-media-type", [`Send the ${what} as application/json.`])
    return { ok: false }
  }
  let text: string
  try {
    text = await readBody(request, limit)
  } catch (error) {
    if (error instanceof TooLargeError) {
      response.setHeader("connection", "close")
      fail(response, 413, "too-large", [`The body is over ${limit} bytes.`])
      return { ok: false }
    }
    throw error
  }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    fail(response, 400, "invalid-json", [error instanceof Error ? error.message : "Not JSON."])
    return { ok: false }
  }
}

export function createIngestServer(options: IngestOptions): Server {
  // A wrapper holds the ingest token; reading every body with it would make every wrapper an operator.
  if (options.vaultToken !== undefined && options.vaultToken === options.token) {
    throw new Error("VAULT_TOKEN must differ from INGEST_TOKEN: a wrapper holds the ingest token.")
  }
  let inFlight = 0

  async function readerOf(request: IncomingMessage): Promise<Reader> {
    const session = await options.auth?.identify(request)
    return {
      session,
      held: options.access === undefined ? undefined : rolesOf(options.access, session),
    }
  }

  /** Runs a read for a reader who holds a role at all; every role reads what a viewer reads. */
  async function asReader(
    request: IncomingMessage,
    response: ServerResponse,
    then: (reader: Reader) => Promise<void>,
  ) {
    const reader = await readerOf(request)
    if (reader.held !== undefined && !mayRead(reader.held)) return refuse(response, reader)
    return then(reader)
  }

  /** A reader without the role: sign in, if they have not; else, the role does not reach. */
  const refuse = (response: ServerResponse, reader: Reader) =>
    reader.session === undefined
      ? fail(response, 401, "sign-in", ["Sign in to read this."])
      : fail(response, 403, "forbidden", ["Your roles do not include this."])

  // The vault (ADR-0009): a deposit with the ingest token; a read or an erasure with the operator's.
  async function bodiesRoute(request: IncomingMessage, response: ServerResponse, path: string) {
    const { vault, token, vaultToken } = options
    const match = /^\/bodies\/([^/]+)$/.exec(path)
    const sha256 = match?.[1]
    if (vault === undefined) {
      return fail(response, 503, "not-configured", [
        "No vault: set DATABASE_URL, or VAULT_DIR outside EVENTS_DIR, to keep bodies.",
      ])
    }
    const writing = request.method === "PUT"
    const needed = writing ? token : vaultToken
    if (needed === undefined || needed === "") {
      return fail(response, 503, "not-configured", [
        writing
          ? "No token: set INGEST_TOKEN to take deposits."
          : "No operator token: set VAULT_TOKEN to resolve and erase bodies.",
      ])
    }
    if (!authorised(request, needed)) {
      response.setHeader("www-authenticate", "Bearer")
      return fail(response, 401, "unauthorised", [
        writing
          ? "Send the ingest token as a bearer token."
          : "Send the operator token as a bearer token.",
      ])
    }
    if (writing) {
      let bytes: Buffer
      try {
        bytes = await readBytes(request, options.maxBodyBytes)
      } catch (error) {
        if (error instanceof TooLargeError) {
          response.setHeader("connection", "close")
          return fail(response, 413, "too-large", [
            `The body is over ${options.maxBodyBytes} bytes.`,
          ])
        }
        throw error
      }
      const checked = checkDeposit(
        sha256 ?? "",
        new Uint8Array(bytes),
        request.headers["content-type"],
      )
      if (!checked.ok) return fail(response, 400, "invalid", checked.problems)
      const kept = await vault.put(sha256!, checked.deposit)
      return send(response, kept === "stored" ? 201 : 200, { ok: true, sha256, kept })
    }
    if (sha256 === undefined || !SHA256.test(sha256)) {
      return fail(response, 404, "not-found", [`No body at ${path}.`])
    }
    if (request.method === "DELETE") {
      if (!(await vault.delete(sha256)))
        return fail(response, 404, "not-found", [`No body ${sha256}.`])
      response.writeHead(204, { "cache-control": "no-store" })
      return void response.end()
    }
    const held = await vault.get(sha256)
    if (held === undefined)
      return fail(response, 404, "not-found", [`The vault holds no body ${sha256}.`])
    response.writeHead(200, {
      "content-type": held.mediaType,
      "content-length": String(held.bytes.byteLength),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    })
    return void response.end(Buffer.from(held.bytes))
  }

  async function eventsRoute(request: IncomingMessage, response: ServerResponse) {
    const { store, token } = options
    if (store === undefined) {
      return fail(response, 503, "not-configured", [
        "No event tree: set EVENTS_DIR to write events.",
      ])
    }
    if (token === undefined || token === "") {
      return fail(response, 503, "not-configured", ["No token: set INGEST_TOKEN to take writes."])
    }
    if (!authorised(request, token)) {
      response.setHeader("www-authenticate", "Bearer")
      return fail(response, 401, "unauthorised", ["Send the ingest token as a bearer token."])
    }
    const body = await readJsonBody(request, response, options.maxBodyBytes, "event")
    if (!body.ok) return
    const result = await store.write(body.value)
    if (result.ok) return send(response, 201, { ok: true, event_id: result.eventId })
    return fail(response, result.kind === "duplicate" ? 409 : 400, result.kind, result.problems)
  }

  async function replayRoute(request: IncomingMessage, response: ServerResponse) {
    const body = await readJsonBody(request, response, options.maxBodyBytes, "snapshot")
    if (!body.ok) return
    const snapshot = body.value
    if (inFlight >= options.maxQueue) {
      return fail(response, 503, "busy", ["Too many replays are waiting; try again shortly."])
    }
    inFlight += 1
    try {
      const result = await options.runner.run(snapshot)
      send(response, result.status, result.body)
    } catch (error) {
      if (error instanceof ReplayTimeoutError)
        return fail(response, 504, "timeout", [error.message])
      throw error
    } finally {
      inFlight -= 1
    }
  }

  // The tree's documents at the tree's paths, from the store (ADR-0007), with the cache rules nginx
  // gives the tree: an event never changes; every other document does.
  async function dataRoute(path: string, response: ServerResponse, reader: Reader) {
    const { store } = options
    if (store === undefined) {
      return fail(response, 503, "not-configured", [
        "No event store: set DATABASE_URL or EVENTS_DIR to serve events.",
      ])
    }
    const id = (pattern: RegExp) => {
      const match = pattern.exec(path)
      if (match === null) return undefined
      try {
        return decodeURIComponent(match[1]!)
      } catch {
        return undefined
      }
    }
    const NO_CACHE = { "cache-control": "no-cache" }
    let document: unknown
    let headers = NO_CACHE
    if (path === "/data/events/index.json") document = await store.index()
    else if (path === "/data/fleet.json") document = await store.fleet()
    else if (path === "/data/sources.json") document = await store.sources()
    else if (id(/^\/data\/events\/index\/([^/]+)\.json$/) !== undefined) {
      document = await store.window(id(/^\/data\/events\/index\/([^/]+)\.json$/)!)
    } else if (id(/^\/data\/events\/([^/]+)\.json$/) !== undefined) {
      const event = await store.event(id(/^\/data\/events\/([^/]+)\.json$/)!)
      document =
        event === undefined || reader.held === undefined || mayOwn(reader.held, routeOf(event))
          ? event
          : withholdBodies(event)
      headers = { "cache-control": "public, max-age=31536000, immutable" }
    } else if (id(/^\/data\/sessions\/([^/]+)\.json$/) !== undefined) {
      document = await store.session(id(/^\/data\/sessions\/([^/]+)\.json$/)!)
    }
    if (document === undefined) return fail(response, 404, "not-found", [`No document at ${path}.`])
    // What a reader gets depends on who they are: no cache may keep it for another (ADR-0011).
    if (options.access !== undefined) headers = { "cache-control": "private, no-cache" }
    return send(response, 200, document, headers)
  }

  // A compliance bundle for a stored event, its replay through the same bounded runner as /replay.
  async function bundleRoute(path: string, response: ServerResponse, reader: Reader) {
    const { store, signingKey } = options
    if (store === undefined || signingKey === undefined) {
      return fail(response, 503, "not-configured", [
        store === undefined
          ? "No event store: set DATABASE_URL or EVENTS_DIR to serve events."
          : "No signing key: set SIGNING_KEY to sign compliance bundles.",
      ])
    }
    const match = /^\/bundles\/([^/]+)\.json$/.exec(path)
    let eventId: string | undefined
    try {
      eventId = match === null ? undefined : decodeURIComponent(match[1]!)
    } catch {
      eventId = undefined
    }
    const event = eventId === undefined ? undefined : await store.event(eventId)
    if (event === undefined) return fail(response, 404, "not-found", [`No event at ${path}.`])
    // A bundle holds the event as stored, bodies and all: an auditor's, or the route's owner's.
    if (
      reader.held !== undefined &&
      !reader.held.has("auditor") &&
      !mayOwn(reader.held, routeOf(event))
    ) {
      return refuse(response, reader)
    }
    if (inFlight >= options.maxQueue) {
      return fail(response, 503, "busy", ["Too many replays are waiting; try again shortly."])
    }
    inFlight += 1
    try {
      const bundle = await buildBundle(
        event,
        (snapshot) => options.runner.run(snapshot),
        signingKey,
        new Date().toISOString(),
      )
      return send(response, 200, bundle)
    } catch (error) {
      if (error instanceof ReplayTimeoutError)
        return fail(response, 504, "timeout", [error.message])
      throw error
    } finally {
      inFlight -= 1
    }
  }

  // Corpora (ADR-0008): frozen with the ingest token, at most MAX_CORPUS events, read by anyone.
  async function corporaPost(request: IncomingMessage, response: ServerResponse) {
    const { store, token } = options
    if (store === undefined) {
      return fail(response, 503, "not-configured", [
        "No event store: set DATABASE_URL or EVENTS_DIR.",
      ])
    }
    if (token === undefined || token === "") {
      return fail(response, 503, "not-configured", ["No token: set INGEST_TOKEN to take writes."])
    }
    if (!authorised(request, token)) {
      response.setHeader("www-authenticate", "Bearer")
      return fail(response, 401, "unauthorised", ["Send the ingest token as a bearer token."])
    }
    const body = await readJsonBody(request, response, options.maxBodyBytes, "corpus")
    if (!body.ok) return
    const {
      name,
      event_ids: given,
      from,
    } = (body.value ?? {}) as {
      name?: unknown
      event_ids?: unknown
      from?: { route?: unknown; outcome?: unknown; profile?: unknown; limit?: unknown }
    }
    if (typeof name !== "string" || !CORPUS_NAME.test(name)) {
      return fail(response, 400, "invalid", [
        "name must be lowercase letters, digits, dots, dashes or underscores, at most 64.",
      ])
    }
    let ids: string[]
    if (Array.isArray(given)) ids = given.map(String)
    else {
      const limit = typeof from?.limit === "number" ? Math.min(from.limit, MAX_CORPUS) : MAX_CORPUS
      ids = (await store.index()).events
        .filter((row) => from?.route === undefined || row.route === from.route)
        .filter((row) => from?.outcome === undefined || row.outcome === from.outcome)
        .filter((row) => from?.profile === undefined || row.profile?.id === from.profile)
        .slice(0, limit)
        .map((row) => row.event_id)
    }
    if (ids.length === 0) return fail(response, 400, "invalid", ["The corpus names no event."])
    if (ids.length > MAX_CORPUS) {
      return fail(response, 400, "invalid", [`A corpus holds at most ${MAX_CORPUS} events.`])
    }
    const events = await Promise.all(ids.map((id) => store.event(id)))
    const missing = ids.filter((_, i) => events[i] === undefined)
    if (missing.length > 0) {
      return fail(response, 400, "invalid", [`The store holds no event ${missing.join(", ")}.`])
    }
    const corpus = {
      $schema: "cwa-dashboard/corpus/v1" as const,
      name,
      created_at: new Date().toISOString(),
      events: events.map((event) => ({
        event_id: event!.event_id,
        ...(event!.trace ? { snapshot_digest: event!.trace.context.snapshot_digest } : {}),
      })),
    }
    if ((await store.saveCorpus(corpus)) === "exists") {
      return fail(response, 409, "duplicate", [
        `A corpus ${name} exists; a corpus is never overwritten.`,
      ])
    }
    return send(response, 201, { ok: true, name, events: corpus.events.length })
  }

  // One shadow run at a time: each is many replays, and a public deployment answers anyone.
  let shadowing = false
  async function shadowPost(request: IncomingMessage, response: ServerResponse) {
    const { store } = options
    if (store === undefined) {
      return fail(response, 503, "not-configured", [
        "No event store: set DATABASE_URL or EVENTS_DIR.",
      ])
    }
    const body = await readJsonBody(request, response, options.maxBodyBytes, "shadow request")
    if (!body.ok) return
    const { corpus: name, candidate } = (body.value ?? {}) as {
      corpus?: unknown
      candidate?: Candidate
    }
    const isObject = (value: unknown) =>
      typeof value === "object" && value !== null && !Array.isArray(value)
    if (
      !isObject(candidate) ||
      (!isObject(candidate!.route_policy) && !isObject(candidate!.profile))
    ) {
      return fail(response, 400, "invalid", [
        "candidate must hold a route_policy, a profile, or both.",
      ])
    }
    const corpus = typeof name === "string" ? await store.corpus(name) : undefined
    if (corpus === undefined)
      return fail(response, 404, "not-found", [`No corpus ${String(name)}.`])
    if (shadowing)
      return fail(response, 503, "busy", ["A shadow run is under way; try again shortly."])
    shadowing = true
    try {
      const report = await shadowReport(
        { name: corpus.name, event_ids: corpus.events.map((e) => e.event_id) },
        {
          candidate: candidate!,
          load: (id) => store.event(id),
          run: (snapshot) => options.runner.run(snapshot),
          generatedAt: new Date().toISOString(),
        },
      )
      return send(response, 200, report)
    } catch (error) {
      if (error instanceof ReplayTimeoutError)
        return fail(response, 504, "timeout", [error.message])
      throw error
    } finally {
      shadowing = false
    }
  }

  async function corporaGet(path: string, response: ServerResponse) {
    const { store } = options
    if (store === undefined) {
      return fail(response, 503, "not-configured", [
        "No event store: set DATABASE_URL or EVENTS_DIR.",
      ])
    }
    if (path === "/corpora.json")
      return send(
        response,
        200,
        { corpora: await store.corpora() },
        { "cache-control": "no-cache" },
      )
    const match = /^\/corpora\/([^/]+)\.json$/.exec(path)
    const corpus = match === null ? undefined : await store.corpus(decodeURIComponent(match[1]!))
    if (corpus === undefined) return fail(response, 404, "not-found", [`No corpus at ${path}.`])
    return send(response, 200, corpus, { "cache-control": "no-cache" })
  }

  return createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname
    const route = async () => {
      if (path === "/healthz") {
        if (request.method !== "GET") return send(response, 405, { ok: false }, { allow: "GET" })
        return send(response, 200, { ok: true })
      }
      if (path === "/replay/components") {
        if (request.method !== "GET") return send(response, 405, { ok: false }, { allow: "GET" })
        return send(response, 200, components())
      }
      if (path === "/events") {
        if (request.method !== "POST") return send(response, 405, { ok: false }, { allow: "POST" })
        return eventsRoute(request, response)
      }
      if (path === "/corpora") {
        if (request.method !== "POST") return send(response, 405, { ok: false }, { allow: "POST" })
        return corporaPost(request, response)
      }
      if (path === "/corpora.json" || path.startsWith("/corpora/")) {
        if (request.method !== "GET") return send(response, 405, { ok: false }, { allow: "GET" })
        return asReader(request, response, () => corporaGet(path, response))
      }
      if (path === "/shadow") {
        if (request.method !== "POST") return send(response, 405, { ok: false }, { allow: "POST" })
        return asReader(request, response, () => shadowPost(request, response))
      }
      if (path === "/signing-key.pem") {
        if (request.method !== "GET") return send(response, 405, { ok: false }, { allow: "GET" })
        if (options.signingKey === undefined) {
          return fail(response, 503, "not-configured", ["No signing key: set SIGNING_KEY."])
        }
        response.writeHead(200, {
          "content-type": "application/x-pem-file",
          "cache-control": "no-cache",
        })
        return void response.end(options.signingKey.publicPem)
      }
      if (path.startsWith("/bundles/")) {
        if (request.method !== "GET") return send(response, 405, { ok: false }, { allow: "GET" })
        return asReader(request, response, (reader) => bundleRoute(path, response, reader))
      }
      if (path === "/me") {
        if (request.method !== "GET") return send(response, 405, { ok: false }, { allow: "GET" })
        const reader = await readerOf(request)
        const session = reader.session
        return send(response, 200, {
          sign_in: options.auth === undefined ? "not-configured" : "configured",
          signed_in: session !== undefined,
          ...(session === undefined
            ? {}
            : {
                name: session.name,
                ...(session.email === undefined ? {} : { email: session.email }),
                groups: session.groups,
                expires_at: session.expiresAt.toISOString(),
              }),
          ...(reader.held === undefined ? {} : { roles: [...reader.held].sort() }),
        })
      }
      if (path.startsWith("/auth/")) {
        const auth = options.auth
        if (auth === undefined) {
          return fail(response, 503, "not-configured", [
            "Sign-in is not configured: set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and OIDC_REDIRECT_URI, with DATABASE_URL.",
          ])
        }
        const url = new URL(request.url ?? "/", "http://localhost")
        const routes: Record<string, [string, () => Promise<void>]> = {
          "/auth/login": ["GET", () => auth.login(response, url)],
          "/auth/callback": ["GET", () => auth.callback(request, response, url)],
          "/auth/logout": ["POST", () => auth.logout(request, response)],
        }
        const found = routes[path]
        if (found === undefined) return fail(response, 404, "not-found", [`No route ${path}.`])
        if (request.method !== found[0]) {
          return send(response, 405, { ok: false }, { allow: found[0] })
        }
        return found[1]()
      }
      if (path.startsWith("/bodies/")) {
        if (!["GET", "PUT", "DELETE"].includes(request.method ?? "")) {
          return send(response, 405, { ok: false }, { allow: "GET, PUT, DELETE" })
        }
        return bodiesRoute(request, response, path)
      }
      if (path.startsWith("/data/")) {
        // HEAD as GET: Node's server sends the headers and leaves the body out.
        if (request.method !== "GET" && request.method !== "HEAD") {
          return send(response, 405, { ok: false }, { allow: "GET, HEAD" })
        }
        return asReader(request, response, (reader) => dataRoute(path, response, reader))
      }
      if (path === "/replay") {
        if (request.method !== "POST") return send(response, 405, { ok: false }, { allow: "POST" })
        return asReader(request, response, () => replayRoute(request, response))
      }
      return fail(response, 404, "not-found", [`No route ${path}.`])
    }
    route().catch((error: unknown) => {
      if (!response.headersSent) {
        // The detail stays in the service's log: it can name the store's internals.
        process.stderr.write(
          `ingest: ${request.method} ${path} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
        )
        fail(response, 500, "internal", ["The service failed; its log has the detail."])
      }
    })
  })
}
