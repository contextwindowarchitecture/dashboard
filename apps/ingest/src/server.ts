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
  mayAudit,
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
import { CORPUS_NAME, DEFAULT_TENANT, type EventStore as Store, TENANT } from "./event-store.ts"
import { shadowReport, type Candidate } from "./shadow.ts"
import { validateDraftV1 } from "@cwa-dashboard/telemetry/validators"
import { validateProfile, validateRoutePolicy } from "@cwa-dashboard/contract/validators"
import type { DraftV1, ShadowReportV1 } from "@cwa-dashboard/telemetry/types"
import { DRAFT_ID, type DraftStore } from "./drafts.ts"
import type { Published, PublishRequest } from "./github.ts"
import { fileText, policyPath } from "./policy-layout.ts"
import { byHandCommands, commitMessage, pullBody, pullTitle, type ShadowRun } from "./publish.ts"
import { type BodyVault, checkDeposit, type Deposit, SHA256 } from "./vault.ts"

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
  /** Drafts of route policies and profiles, per author (ADR-0013); PostgreSQL's. */
  readonly drafts?: DraftStore
  /** Publishing drafts as a GitHub App (ADR-0014); without it, Publish answers with the commands. */
  readonly publish?: {
    readonly publisher: { publish(request: PublishRequest): Promise<Published> }
    /** Each tenant's policy repository, owner/name. */
    readonly repositories: Readonly<Record<string, string>>
  }
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
    tenant: string,
    then: (reader: Reader) => Promise<void>,
  ) {
    const reader = await readerOf(request)
    if (reader.held !== undefined && !mayRead(reader.held, tenant)) return refuse(response, reader)
    return then(reader)
  }

  /** A reader without the role: sign in, if they have not; else, the role does not reach. */
  const refuse = (response: ServerResponse, reader: Reader) =>
    reader.session === undefined
      ? fail(response, 401, "sign-in", ["Sign in to read this."])
      : fail(response, 403, "forbidden", ["Your roles do not include this."])

  // The vault (ADR-0009): a deposit with the ingest token; a read or an erasure with the operator's.
  async function bodiesRoute(
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    url: URL,
    tenant: string,
  ) {
    const { vault, token, vaultToken } = options
    const match = /^\/bodies\/([^/]+)$/.exec(path)
    const sha256 = match?.[1]
    if (vault === undefined) {
      return fail(response, 503, "not-configured", [
        "No vault: set DATABASE_URL, or VAULT_DIR outside EVENTS_DIR, to keep bodies.",
      ])
    }
    const writing = request.method === "PUT"
    // A route's owner resolves by session, naming the event whose digest it is (ADR-0012); the
    // operator token, when sent, keeps its own way.
    const eventId = url.searchParams.get("event")
    const byToken = vaultToken !== undefined && vaultToken !== "" && authorised(request, vaultToken)
    if (request.method === "GET" && eventId !== null && !byToken) {
      return resolveBySession(response, request, vault, sha256, eventId, tenant)
    }
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
    audit(sha256, "the operator token")
    return serveBody(response, held)
  }

  /** Every resolution, in the service's log (ADR-0012): the digest, who, the event, when. */
  const audit = (sha256: string, who: string, event?: string) =>
    process.stdout.write(
      `vault: resolved ${sha256} for ${who}${event === undefined ? "" : ` via ${event}`} at ${new Date().toISOString()}\n`,
    )

  async function resolveBySession(
    response: ServerResponse,
    request: IncomingMessage,
    vault: BodyVault,
    sha256: string | undefined,
    eventId: string,
    tenant: string,
  ) {
    if (options.access === undefined || options.store === undefined) {
      response.setHeader("www-authenticate", "Bearer")
      return fail(response, 401, "unauthorised", [
        "Send the operator token as a bearer token; resolving by session needs an access file.",
      ])
    }
    if (sha256 === undefined || !SHA256.test(sha256) || !TENANT.test(tenant)) {
      return fail(response, 404, "not-found", ["No such body."])
    }
    const reader = await readerOf(request)
    // By session only: an anonymous reader never resolves, whatever the access file grants them.
    if (reader.session === undefined) {
      return fail(response, 401, "sign-in", [
        "Sign in as an owner of the event's route to resolve its bodies.",
      ])
    }
    const event = await options.store.forTenant(tenant).event(eventId)
    if (event === undefined) return fail(response, 404, "not-found", [`No event ${eventId}.`])
    if (!mayOwn(reader.held!, routeOf(event), tenant)) return refuse(response, reader)
    // Only a digest the event holds: a session never fetches a body by guessing one.
    const digests = JSON.stringify(event.snapshot ?? event.rejection?.snapshot ?? {}).match(
      /(?<="content_sha256":")[0-9a-f]{64}/g,
    )
    if (!(digests ?? ([] as string[])).includes(sha256)) {
      return fail(response, 404, "not-found", [`Event ${eventId} holds no body ${sha256}.`])
    }
    const held = await vault.get(sha256)
    if (held === undefined) {
      return fail(response, 404, "not-found", [`The vault holds no body ${sha256}.`])
    }
    audit(sha256, reader.session.subject, eventId)
    return serveBody(response, held)
  }

  function serveBody(response: ServerResponse, held: Deposit) {
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
  async function dataRoute(path: string, response: ServerResponse, reader: Reader, tenant: string) {
    if (options.store === undefined) {
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
    // Another tenant's documents are its own store's (ADR-0012).
    const store = options.store.forTenant(tenant)
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
        event === undefined ||
        reader.held === undefined ||
        mayOwn(reader.held, routeOf(event), tenant)
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
  async function bundleRoute(
    path: string,
    response: ServerResponse,
    reader: Reader,
    tenant: string,
  ) {
    const { signingKey } = options
    const store = options.store?.forTenant(tenant)
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
      !mayAudit(reader.held, tenant) &&
      !mayOwn(reader.held, routeOf(event), tenant)
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
      tenant?: unknown
    }
    const tenant = (body.value as { tenant?: unknown } | undefined)?.tenant ?? DEFAULT_TENANT
    if (typeof tenant !== "string" || !TENANT.test(tenant)) {
      return fail(response, 400, "invalid", ["tenant must name a tenant, as an event does."])
    }
    // A corpus is one tenant's events (ADR-0012).
    const scoped = options.store!.forTenant(tenant)
    if (typeof name !== "string" || !CORPUS_NAME.test(name)) {
      return fail(response, 400, "invalid", [
        "name must be lowercase letters, digits, dots, dashes or underscores, at most 64.",
      ])
    }
    let ids: string[]
    if (Array.isArray(given)) ids = given.map(String)
    else {
      const limit = typeof from?.limit === "number" ? Math.min(from.limit, MAX_CORPUS) : MAX_CORPUS
      ids = (await scoped.index()).events
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
    const events = await Promise.all(ids.map((id) => scoped.event(id)))
    const missing = ids.filter((_, i) => events[i] === undefined)
    if (missing.length > 0) {
      return fail(response, 400, "invalid", [`The store holds no event ${missing.join(", ")}.`])
    }
    const corpus = {
      $schema: "cwa-dashboard/corpus/v1" as const,
      name,
      ...(tenant === DEFAULT_TENANT ? {} : { tenant }),
      created_at: new Date().toISOString(),
      events: events.map((event) => ({
        event_id: event!.event_id,
        ...(event!.trace ? { snapshot_digest: event!.trace.context.snapshot_digest } : {}),
      })),
    }
    if ((await scoped.saveCorpus(corpus)) === "exists") {
      return fail(response, 409, "duplicate", [
        `A corpus ${name} exists; a corpus is never overwritten.`,
      ])
    }
    return send(response, 201, { ok: true, name, events: corpus.events.length })
  }

  // One shadow run at a time: each is many replays, and a public deployment answers anyone.
  let shadowing = false
  async function shadowPost(request: IncomingMessage, response: ServerResponse, tenant: string) {
    if (options.store === undefined) {
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
    const run = await shadow(tenant, name, candidate!)
    if (run.kind !== "ok") {
      const status = { "not-found": 404, busy: 503, timeout: 504 }[run.kind]
      return fail(response, status, run.kind, [run.message])
    }
    return send(response, 200, run.report)
  }

  /** A shadow run over one of the tenant's corpora, one at a time; for /shadow and for Publish. */
  async function shadow(
    tenant: string,
    name: unknown,
    candidate: Candidate,
  ): Promise<
    | { readonly kind: "ok"; readonly report: ShadowReportV1 }
    | { readonly kind: "not-found" | "busy" | "timeout"; readonly message: string }
  > {
    const store = options.store!.forTenant(tenant)
    const corpus = typeof name === "string" ? await store.corpus(name) : undefined
    if (corpus === undefined) return { kind: "not-found", message: `No corpus ${String(name)}.` }
    if (shadowing) {
      return { kind: "busy", message: "A shadow run is under way; try again shortly." }
    }
    shadowing = true
    try {
      const report = await shadowReport(
        { name: corpus.name, event_ids: corpus.events.map((e) => e.event_id) },
        {
          candidate,
          load: (id) => store.event(id),
          run: (snapshot) => options.runner.run(snapshot),
          generatedAt: new Date().toISOString(),
        },
      )
      return { kind: "ok", report }
    } catch (error) {
      if (error instanceof ReplayTimeoutError) return { kind: "timeout", message: error.message }
      throw error
    } finally {
      shadowing = false
    }
  }

  // Drafts (ADR-0013): a signed-in author's own, for routes they own in the page's tenant.
  async function draftsRoute(
    request: IncomingMessage,
    response: ServerResponse,
    path: string,
    tenant: string,
  ) {
    const { drafts } = options
    const listing = path === "/drafts.json"
    const one = /^\/drafts\/([^/]+)\.json$/.exec(path)
    const allowed = listing ? ["GET"] : ["GET", "PUT", "DELETE"]
    if (!allowed.includes(request.method ?? "")) {
      return send(response, 405, { ok: false }, { allow: allowed.join(", ") })
    }
    if (drafts === undefined) {
      return fail(response, 503, "not-configured", [
        "Drafts are kept in PostgreSQL, with sign-in: set DATABASE_URL and OIDC_*.",
      ])
    }
    const reader = await readerOf(request)
    if (reader.session === undefined) {
      return fail(response, 401, "sign-in", ["Sign in to keep drafts."])
    }
    const author = reader.session.subject
    const PRIVATE = { "cache-control": "private, no-store" }
    if (listing) return send(response, 200, { drafts: await drafts.list(author, tenant) }, PRIVATE)
    const id = one?.[1]
    if (id === undefined || !DRAFT_ID.test(id)) {
      return fail(response, 404, "not-found", [`No draft at ${path}.`])
    }
    if (request.method === "GET") {
      const draft = await drafts.get(author, tenant, id)
      if (draft === undefined) return fail(response, 404, "not-found", [`No draft ${id}.`])
      return send(response, 200, draft, PRIVATE)
    }
    // A write carries the session's cookie: one from another site is refused (ADR-0010).
    if (options.auth?.fromOtherSite(request)) {
      return fail(response, 403, "forbidden", ["A draft is written from this site only."])
    }
    if (request.method === "DELETE") {
      if (!(await drafts.delete(author, tenant, id))) {
        return fail(response, 404, "not-found", [`No draft ${id}.`])
      }
      response.writeHead(204, { "cache-control": "no-store" })
      return void response.end()
    }
    const body = await readJsonBody(request, response, options.maxBodyBytes, "draft")
    if (!body.ok) return
    const given = (body.value ?? {}) as {
      kind?: unknown
      started_from?: unknown
      document?: unknown
    }
    const route = (given.document as { route?: unknown } | null | undefined)?.route
    if (typeof route !== "string" || route.trim() === "") {
      return fail(response, 400, "invalid", ["A draft's document names its route."])
    }
    // Authoring is the route's owner's (ADR-0013).
    if (reader.held !== undefined && !mayOwn(reader.held, route, tenant)) {
      return refuse(response, reader)
    }
    // The pull request it was published to stays with it (ADR-0014).
    const kept = (await drafts.get(author, tenant, id))?.published
    const draft = {
      $schema: "cwa-dashboard/draft/v1" as const,
      id,
      kind: given.kind,
      started_from: given.started_from ?? null,
      route,
      ...(tenant === DEFAULT_TENANT ? {} : { tenant }),
      document: given.document,
      updated_at: new Date().toISOString(),
      ...(kept === undefined ? {} : { published: kept }),
    }
    if (!validateDraftV1(draft)) {
      return fail(
        response,
        400,
        "invalid",
        (validateDraftV1.errors ?? []).map(
          (e) => `${e.instancePath || "the draft"} ${e.message ?? "is invalid"}`,
        ),
      )
    }
    if ((await drafts.put(author, tenant, draft)) === "taken") {
      return fail(response, 404, "not-found", [`No draft ${id}.`])
    }
    return send(response, 200, draft, PRIVATE)
  }

  // Publish (ADR-0014): the draft's author, signed in and still its route's owner, opens a pull
  // request in the tenant's policy repository; without the App, the answer is the commands.
  async function publishRoute(
    request: IncomingMessage,
    response: ServerResponse,
    id: string,
    tenant: string,
  ) {
    if (request.method !== "POST") return send(response, 405, { ok: false }, { allow: "POST" })
    const { drafts } = options
    if (drafts === undefined) {
      return fail(response, 503, "not-configured", [
        "Drafts are kept in PostgreSQL, with sign-in: set DATABASE_URL and OIDC_*.",
      ])
    }
    const reader = await readerOf(request)
    if (reader.session === undefined) {
      return fail(response, 401, "sign-in", ["Sign in to publish a draft."])
    }
    if (options.auth?.fromOtherSite(request)) {
      return fail(response, 403, "forbidden", ["A draft is published from this site only."])
    }
    const author = reader.session.subject
    const draft = DRAFT_ID.test(id) ? await drafts.get(author, tenant, id) : undefined
    if (draft === undefined) return fail(response, 404, "not-found", [`No draft ${id}.`])
    if (reader.held !== undefined && !mayOwn(reader.held, draft.route, tenant)) {
      return refuse(response, reader)
    }
    const body = await readJsonBody(request, response, options.maxBodyBytes, "publish request")
    if (!body.ok) return
    const { corpus } = (body.value ?? {}) as { corpus?: unknown }
    const validate = draft.kind === "profile" ? validateProfile : validateRoutePolicy
    if (!validate(draft.document)) {
      return fail(
        response,
        400,
        "invalid",
        (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`),
      )
    }
    const placed = policyPath(draft.kind, draft.document)
    if (!placed.ok) return fail(response, 400, "invalid", [placed.problem])
    const { path } = placed
    const branch = `cwa-dashboard/${draft.id}`
    const file = fileText(draft.document)
    const repository = options.publish?.repositories[tenant]
    if (options.publish === undefined || repository === undefined) {
      return send(
        response,
        200,
        {
          kind: "by-hand",
          path,
          file,
          branch,
          commands: byHandCommands({ draft, path, branch }),
          problems: [
            options.publish === undefined
              ? "No GitHub App is configured: set GITHUB_APP_DIR and POLICY_REPOSITORIES."
              : `POLICY_REPOSITORIES names no repository for the tenant ${tenant}.`,
          ],
        },
        { "cache-control": "no-store" },
      )
    }
    let run: ShadowRun = { kind: "not-asked" }
    if (corpus !== undefined && options.store !== undefined) {
      const ran = await shadow(tenant, corpus, { [draft.kind]: draft.document } as Candidate)
      if (ran.kind === "not-found") return fail(response, 404, "not-found", [ran.message])
      run =
        ran.kind === "ok"
          ? { kind: "ran", report: ran.report }
          : { kind: "did-not-finish", reason: ran.message }
    }
    const answer = await options.publish.publisher.publish({
      repository,
      path,
      text: file,
      head: branch,
      message: commitMessage(draft),
      title: pullTitle(draft),
      body: pullBody({
        draft,
        author: {
          name: reader.session.name,
          subject: author,
          ...(reader.session.username === undefined ? {} : { username: reader.session.username }),
        },
        tenant,
        path,
        shadow: run,
      }),
    })
    switch (answer.kind) {
      case "published": {
        const published: NonNullable<DraftV1["published"]> = {
          repository: answer.repository,
          path: answer.path,
          branch: answer.branch,
          number: answer.number,
          url: answer.url,
          at: new Date().toISOString(),
        }
        await drafts.put(author, tenant, { ...draft, published })
        return send(response, 200, answer, { "cache-control": "no-store" })
      }
      case "conflict":
        return send(response, 409, {
          ok: false,
          kind: "conflict",
          path: answer.path,
          problems: [
            `${answer.repository} already holds ${answer.path}: a published version is not edited in place, so raise the version.`,
          ],
        })
      case "empty":
        return fail(response, 409, "empty", [
          `${answer.repository} has no default branch to branch from: commit its layout first (deploy/policy-repository/README.md).`,
        ])
      default:
        return fail(response, 502, answer.kind, [answer.message])
    }
  }

  // The tenants a reader may read, with their events (ADR-0012).
  async function tenantsRoute(request: IncomingMessage, response: ServerResponse) {
    if (options.store === undefined) {
      return fail(response, 503, "not-configured", [
        "No event store: set DATABASE_URL or EVENTS_DIR.",
      ])
    }
    const reader = await readerOf(request)
    const tenants = (await options.store.tenants()).filter(
      (each) => reader.held === undefined || mayRead(reader.held, each.tenant),
    )
    if (
      reader.held !== undefined &&
      tenants.length === 0 &&
      !mayRead(reader.held, DEFAULT_TENANT)
    ) {
      return refuse(response, reader)
    }
    return send(
      response,
      200,
      { $schema: "cwa-dashboard/tenants/v1", tenants },
      { "cache-control": options.access === undefined ? "no-cache" : "private, no-cache" },
    )
  }

  async function corporaGet(path: string, response: ServerResponse, tenant: string) {
    if (options.store === undefined) {
      return fail(response, 503, "not-configured", [
        "No event store: set DATABASE_URL or EVENTS_DIR.",
      ])
    }
    const store = options.store.forTenant(tenant)
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
    const url = new URL(request.url ?? "/", "http://localhost")
    const path = url.pathname
    // The tenant a route other than /data reads (ADR-0012): ?tenant=, the default when absent.
    const tenant = url.searchParams.get("tenant") ?? DEFAULT_TENANT
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
        if (!TENANT.test(tenant)) return fail(response, 404, "not-found", [`No tenant ${tenant}.`])
        return asReader(request, response, tenant, () => corporaGet(path, response, tenant))
      }
      if (path === "/shadow") {
        if (request.method !== "POST") return send(response, 405, { ok: false }, { allow: "POST" })
        if (!TENANT.test(tenant)) return fail(response, 404, "not-found", [`No tenant ${tenant}.`])
        return asReader(request, response, tenant, () => shadowPost(request, response, tenant))
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
        if (!TENANT.test(tenant)) return fail(response, 404, "not-found", [`No tenant ${tenant}.`])
        return asReader(request, response, tenant, (reader) =>
          bundleRoute(path, response, reader, tenant),
        )
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
                ...(session.username === undefined ? {} : { username: session.username }),
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
      if (path === "/drafts.json" || path.startsWith("/drafts/")) {
        if (!TENANT.test(tenant)) return fail(response, 404, "not-found", [`No tenant ${tenant}.`])
        const publishing = /^\/drafts\/([^/]+)\/publish$/.exec(path)
        if (publishing) return publishRoute(request, response, publishing[1]!, tenant)
        return draftsRoute(request, response, path, tenant)
      }
      if (path.startsWith("/bodies/")) {
        if (!["GET", "PUT", "DELETE"].includes(request.method ?? "")) {
          return send(response, 405, { ok: false }, { allow: "GET, PUT, DELETE" })
        }
        return bodiesRoute(request, response, path, url, tenant)
      }
      if (path.startsWith("/data/")) {
        // HEAD as GET: Node's server sends the headers and leaves the body out.
        if (request.method !== "GET" && request.method !== "HEAD") {
          return send(response, 405, { ok: false }, { allow: "GET, HEAD" })
        }
        if (path === "/data/tenants.json") return tenantsRoute(request, response)
        // Another tenant's documents, at /data/tenants/<tenant>/ in the default's layout (ADR-0012).
        const other = /^\/data\/tenants\/([^/]+)(\/.*)$/.exec(path)
        if (other !== null && !TENANT.test(other[1]!)) {
          return fail(response, 404, "not-found", [`No tenant ${other[1]}.`])
        }
        const scope = other === null ? DEFAULT_TENANT : other[1]!
        const inner = other === null ? path : `/data${other[2]}`
        return asReader(request, response, scope, (reader) =>
          dataRoute(inner, response, reader, scope),
        )
      }
      if (path === "/replay") {
        if (request.method !== "POST") return send(response, 405, { ok: false }, { allow: "POST" })
        return asReader(request, response, DEFAULT_TENANT, () => replayRoute(request, response))
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
