// The Phase 1 Node service's HTTP face (dashboard-plan.md 7.8, 11; D9, D12), on Node's own http:
// GET /healthz; GET /replay/components, the published tokenizers and renderers with whether each is
// required and whether this assembler provides it; POST /replay, a JSON snapshot in, the replay's
// result out, which writes nothing; and POST /events, an assembly event in, written into the tree
// for a caller with the bearer token. Bodies are size-limited and the replay queue bounded.

import { timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { RENDERERS, TOKENIZERS } from "@cwa-dashboard/assembler"
import { COMPONENTS } from "@cwa-dashboard/contract/data"

import { ReplayTimeoutError, type Runner } from "./runner.ts"
import { buildBundle, type SigningKey } from "./bundle.ts"
import type { EventStore as Store } from "./event-store.ts"

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
}

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

function readBody(request: IncomingMessage, limit: number): Promise<string> {
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
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
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
  let inFlight = 0

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
  async function dataRoute(path: string, response: ServerResponse) {
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
      document = await store.event(id(/^\/data\/events\/([^/]+)\.json$/)!)
      headers = { "cache-control": "public, max-age=31536000, immutable" }
    } else if (id(/^\/data\/sessions\/([^/]+)\.json$/) !== undefined) {
      document = await store.session(id(/^\/data\/sessions\/([^/]+)\.json$/)!)
    }
    if (document === undefined) return fail(response, 404, "not-found", [`No document at ${path}.`])
    return send(response, 200, document, headers)
  }

  // A compliance bundle for a stored event, its replay through the same bounded runner as /replay.
  async function bundleRoute(path: string, response: ServerResponse) {
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
        return bundleRoute(path, response)
      }
      if (path.startsWith("/data/")) {
        // HEAD as GET: Node's server sends the headers and leaves the body out.
        if (request.method !== "GET" && request.method !== "HEAD") {
          return send(response, 405, { ok: false }, { allow: "GET, HEAD" })
        }
        return dataRoute(path, response)
      }
      if (path === "/replay") {
        if (request.method !== "POST") return send(response, 405, { ok: false }, { allow: "POST" })
        return replayRoute(request, response)
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
