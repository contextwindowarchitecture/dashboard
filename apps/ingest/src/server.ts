// The Phase 1 Node service's HTTP face (dashboard-plan.md 7.8, 11; D9, D12), on Node's own http:
// GET /healthz; GET /replay/components, the published tokenizers and renderers with whether each is
// required and whether this assembler provides it; and POST /replay, a JSON snapshot in, the
// replay's result out. Bodies are size-limited and the queue bounded; the service is stateless and
// writes nothing.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { RENDERERS, TOKENIZERS } from "@cwa-dashboard/assembler"
import { COMPONENTS } from "@cwa-dashboard/contract/data"

import { ReplayTimeoutError, type Runner } from "./runner.ts"

export interface IngestOptions {
  readonly runner: Runner
  /** The largest request body read, in bytes. */
  readonly maxBodyBytes: number
  /** How many replays may wait or run at once before the service answers 503. */
  readonly maxQueue: number
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

export function createIngestServer(options: IngestOptions): Server {
  let inFlight = 0

  async function replayRoute(request: IncomingMessage, response: ServerResponse) {
    const type = request.headers["content-type"] ?? ""
    if (!/^application\/json\b/.test(type)) {
      return fail(response, 415, "unsupported-media-type", [
        "Send the snapshot as application/json.",
      ])
    }
    let text: string
    try {
      text = await readBody(request, options.maxBodyBytes)
    } catch (error) {
      if (error instanceof TooLargeError) {
        response.setHeader("connection", "close")
        return fail(response, 413, "too-large", [`The body is over ${options.maxBodyBytes} bytes.`])
      }
      throw error
    }
    let snapshot: unknown
    try {
      snapshot = JSON.parse(text)
    } catch (error) {
      return fail(response, 400, "invalid-json", [
        error instanceof Error ? error.message : "Not JSON.",
      ])
    }
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
      if (path === "/replay") {
        if (request.method !== "POST") return send(response, 405, { ok: false }, { allow: "POST" })
        return replayRoute(request, response)
      }
      return fail(response, 404, "not-found", [`No route ${path}.`])
    }
    route().catch((error: unknown) => {
      if (!response.headersSent) {
        fail(response, 500, "internal", [error instanceof Error ? error.message : String(error)])
      }
    })
  })
}
