// GitHub's REST API in this process, for the publish tests (ADR-0014): the App's installation token,
// a repository's default branch, refs, contents and pull requests, kept in memory. It checks what
// GitHub checks: the App's JWT is RS256 over the App's key, issued by the App, at most ten minutes
// long; every repository call carries an installation token it issued, for that repository. It can
// be told to answer as GitHub does when something is wrong, one way at a time. No network leaves the
// machine.

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  verify,
} from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

export type GitHubFault =
  /** The App is not installed on the repository: GitHub answers 404 to its token. */
  | "not-installed"
  /** The installation lacks a permission: 403 on the write. */
  | "forbidden"
  /** A rule on the branch refuses the commit: 409. */
  | "protected"
  /** Nothing is committed yet: the default branch does not exist. */
  | "empty"
  /** GitHub answers 502 to everything. */
  | "down"

export interface PullRequest {
  readonly number: number
  readonly head: string
  readonly base: string
  title: string
  body: string
  readonly html_url: string
}

export interface FakeGitHub {
  readonly url: string
  readonly appId: string
  readonly installationId: string
  /** The App's private key, PKCS#1 PEM, as GitHub hands it out. */
  readonly privateKey: string
  readonly repository: string
  /** Files by branch, then path: what each branch holds. */
  readonly branches: Map<string, Map<string, string>>
  readonly pulls: PullRequest[]
  /** The commits made, by branch, with their messages. */
  readonly commits: { branch: string; path: string; message: string }[]
  /** The installation tokens asked for, with what they were scoped to. */
  readonly tokens: { repositories: unknown; permissions: unknown }[]
  fault: GitHubFault | undefined
  close(): Promise<void>
}

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
}
const read = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return chunks.length === 0
    ? {}
    : (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>)
}

export interface GitHubOptions {
  readonly repository?: string
  readonly port?: number
  /** The App's private key, PKCS#1 PEM, for a browser test that hands it to the API; a new one when absent. */
  readonly privateKey?: string
  readonly appId?: string
  readonly installationId?: string
}

export async function startGitHub(options: GitHubOptions = {}): Promise<FakeGitHub> {
  const privateKey =
    options.privateKey === undefined
      ? generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
      : createPrivateKey(options.privateKey)
  const publicKey = createPublicKey(privateKey)
  const appId = options.appId ?? "424242"
  const installationId = options.installationId ?? "171717"
  const repository = options.repository ?? "acme/policies"
  const [owner] = repository.split("/")
  const defaultBranch = "main"
  const issued = new Set<string>()
  const state: FakeGitHub = {
    url: "",
    appId,
    installationId,
    privateKey: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    repository,
    branches: new Map([[defaultBranch, new Map([["README.md", "# Policies\n"]])]]),
    pulls: [],
    commits: [],
    tokens: [],
    fault: undefined,
    close: async () => {},
  }

  function appJwt(request: IncomingMessage): boolean {
    const header = request.headers.authorization ?? ""
    const token = header.startsWith("Bearer ") ? header.slice(7) : ""
    const [head, payload, signature] = token.split(".")
    if (!head || !payload || !signature) return false
    const ok = verify(
      "RSA-SHA256",
      Buffer.from(`${head}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url"),
    )
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      number | string
    >
    const now = Math.floor(Date.now() / 1000)
    return (
      ok &&
      JSON.parse(Buffer.from(head, "base64url").toString("utf8")).alg === "RS256" &&
      String(claims["iss"]) === appId &&
      Number(claims["iat"]) <= now + 1 &&
      Number(claims["exp"]) > now &&
      Number(claims["exp"]) - Number(claims["iat"]) <= 600
    )
  }

  const installed = (request: IncomingMessage) => {
    const header = request.headers.authorization ?? ""
    return header.startsWith("token ") && issued.has(header.slice(6))
  }

  async function route(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", "http://github.test")
    const method = request.method ?? "GET"
    if (url.pathname === "/healthz") return json(response, 200, { ok: true })
    if (state.fault === "down") return json(response, 502, { message: "Bad Gateway" })
    if (
      method === "POST" &&
      url.pathname === `/app/installations/${installationId}/access_tokens`
    ) {
      if (!appJwt(request))
        return json(response, 401, { message: "A JSON web token could not be decoded" })
      const body = await read(request)
      state.tokens.push({ repositories: body["repositories"], permissions: body["permissions"] })
      const token = `ghs_${randomBytes(12).toString("hex")}`
      issued.add(token)
      return json(response, 201, {
        token,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      })
    }
    const prefix = `/repos/${repository}`
    if (
      !url.pathname.startsWith(`${prefix}`) ||
      !installed(request) ||
      state.fault === "not-installed"
    ) {
      return json(response, 404, { message: "Not Found" })
    }
    const rest = url.pathname.slice(prefix.length)
    if (method === "GET" && rest === "") {
      return json(response, 200, { full_name: repository, default_branch: defaultBranch })
    }
    const ref = /^\/git\/ref\/heads\/(.+)$/.exec(rest)
    if (method === "GET" && ref) {
      const branch = decodeURIComponent(ref[1]!)
      if (state.fault === "empty" && branch === defaultBranch) {
        return json(response, 409, { message: "Git Repository is empty." })
      }
      return state.branches.has(branch)
        ? json(response, 200, { ref: `refs/heads/${branch}`, object: { sha: `sha-${branch}` } })
        : json(response, 404, { message: "Not Found" })
    }
    if (method === "POST" && rest === "/git/refs") {
      if (state.fault === "forbidden") {
        return json(response, 403, { message: "Resource not accessible by integration" })
      }
      const body = await read(request)
      const branch = String(body["ref"]).replace(/^refs\/heads\//, "")
      const from = [...state.branches.keys()].find((b) => body["sha"] === `sha-${b}`)
      if (from === undefined) return json(response, 422, { message: "Object does not exist" })
      if (state.branches.has(branch))
        return json(response, 422, { message: "Reference already exists" })
      state.branches.set(branch, new Map(state.branches.get(from)))
      return json(response, 201, { ref: body["ref"], object: { sha: `sha-${branch}` } })
    }
    const contents = /^\/contents\/(.+)$/.exec(rest)
    if (contents) {
      const path = contents[1]!.split("/").map(decodeURIComponent).join("/")
      if (method === "GET") {
        const files = state.branches.get(url.searchParams.get("ref") ?? defaultBranch)
        const text = files?.get(path)
        return text === undefined
          ? json(response, 404, { message: "Not Found" })
          : json(response, 200, {
              path,
              sha: `blob-${Buffer.from(text).toString("base64url").slice(0, 16)}`,
              content: Buffer.from(text).toString("base64"),
            })
      }
      if (method === "PUT") {
        if (state.fault === "forbidden") {
          return json(response, 403, { message: "Resource not accessible by integration" })
        }
        if (state.fault === "protected") {
          return json(response, 409, { message: "Repository rule violations found" })
        }
        const body = await read(request)
        const branch = String(body["branch"])
        const files = state.branches.get(branch)
        if (files === undefined) return json(response, 404, { message: "Branch not found" })
        const existing = files.get(path)
        const sha =
          existing === undefined
            ? undefined
            : `blob-${Buffer.from(existing).toString("base64url").slice(0, 16)}`
        if (existing !== undefined && body["sha"] !== sha) {
          return json(response, 409, { message: `${path} does not match ${String(body["sha"])}` })
        }
        if (existing === undefined && body["sha"] !== undefined) {
          return json(response, 422, { message: "sha wasn't supplied for a new file" })
        }
        files.set(path, Buffer.from(String(body["content"]), "base64").toString("utf8"))
        state.commits.push({ branch, path, message: String(body["message"]) })
        return json(response, existing === undefined ? 201 : 200, {
          commit: { sha: `commit-${state.commits.length}` },
        })
      }
    }
    if (rest === "/pulls") {
      if (method === "GET") {
        const head = url.searchParams.get("head")
        return json(
          response,
          200,
          state.pulls.filter(
            (p) => `${owner}:${p.head}` === head && url.searchParams.get("state") === "open",
          ),
        )
      }
      if (method === "POST") {
        const body = await read(request)
        const pull: PullRequest = {
          number: state.pulls.length + 1,
          head: String(body["head"]),
          base: String(body["base"]),
          title: String(body["title"]),
          body: String(body["body"]),
          html_url: `https://github.test/${repository}/pull/${state.pulls.length + 1}`,
        }
        state.pulls.push(pull)
        return json(response, 201, pull)
      }
    }
    const pull = /^\/pulls\/(\d+)$/.exec(rest)
    if (method === "PATCH" && pull) {
      const found = state.pulls.find((p) => p.number === Number(pull[1]))
      if (found === undefined) return json(response, 404, { message: "Not Found" })
      const body = await read(request)
      if (typeof body["title"] === "string") found.title = body["title"]
      if (typeof body["body"] === "string") found.body = body["body"]
      return json(response, 200, found)
    }
    return json(response, 404, { message: "Not Found" })
  }

  const server: Server = createServer((request, response) => {
    route(request, response).catch((error: unknown) =>
      json(response, 500, { message: String(error) }),
    )
  })
  await new Promise<void>((done) => server.listen(options.port ?? 0, "127.0.0.1", done))
  const { port } = server.address() as AddressInfo
  return Object.assign(state, {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  })
}
