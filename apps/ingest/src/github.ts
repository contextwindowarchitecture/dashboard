// Publishing as a GitHub App (ADR-0014): a JWT signed with the App's private key buys an installation
// token scoped to one repository and two permissions, which branches from the default branch,
// commits one file and opens (or keeps) the pull request. Nothing here reaches the browser. Each way
// GitHub can refuse is named, so the page can say which.

import { sign } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

export interface GitHubApp {
  readonly appId: string
  readonly installationId: string
  /** PEM, as GitHub hands it out. */
  readonly privateKey: string
}

export interface PublishRequest {
  /** owner/name */
  readonly repository: string
  readonly path: string
  readonly text: string
  /** The branch the file is committed to, made from the default branch when it is not there. */
  readonly head: string
  readonly message: string
  readonly title: string
  readonly body: string
}

export type Published =
  | {
      readonly kind: "published"
      readonly repository: string
      readonly path: string
      readonly branch: string
      readonly number: number
      readonly url: string
    }
  /** The default branch already holds the path: a published version is never edited in place. */
  | { readonly kind: "conflict"; readonly repository: string; readonly path: string }
  /** The repository has no default branch to branch from: nothing is committed yet. */
  | { readonly kind: "empty"; readonly repository: string }
  /** The App is not installed there, lacks a permission, or its credentials are refused. */
  | { readonly kind: "no-access"; readonly repository: string; readonly message: string }
  /** A rule or a protected branch refused the commit. */
  | { readonly kind: "refused"; readonly repository: string; readonly message: string }
  | { readonly kind: "unreachable"; readonly message: string }

/** The App's credentials from the secret's mount: app-id, installation-id and private-key.pem. */
export function loadGitHubApp(dir: string): GitHubApp {
  const read = (name: string) => {
    try {
      return readFileSync(join(dir, name), "utf8").trim()
    } catch {
      throw new Error(`GITHUB_APP_DIR holds no ${name}: ${join(dir, name)}`)
    }
  }
  return {
    appId: read("app-id"),
    installationId: read("installation-id"),
    privateKey: `${read("private-key.pem")}\n`.replace(/\n+$/, "\n"),
  }
}

export interface PublishConfig {
  readonly app: GitHubApp
  readonly api: string
  /** Each tenant's policy repository, owner/name. */
  readonly repositories: Readonly<Record<string, string>>
}

const TENANT = /^[a-z0-9][a-z0-9._-]{0,63}$/
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/**
 * Publishing's configuration from the environment: GITHUB_APP_DIR (the App's secret, mounted),
 * POLICY_REPOSITORIES (a JSON object, tenant to owner/name) and GITHUB_API. Undefined without
 * GITHUB_APP_DIR; a configuration that cannot be what it says stops the service.
 */
export function publishConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
): PublishConfig | undefined {
  const dir = env["GITHUB_APP_DIR"]
  if (dir === undefined || dir === "") return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(env["POLICY_REPOSITORIES"] ?? "")
  } catch {
    throw new Error('POLICY_REPOSITORIES must be a JSON object: {"<tenant>": "<owner>/<name>"}')
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error('POLICY_REPOSITORIES must be a JSON object: {"<tenant>": "<owner>/<name>"}')
  }
  const repositories: Record<string, string> = {}
  for (const [tenant, repository] of Object.entries(parsed)) {
    if (!TENANT.test(tenant)) throw new Error(`POLICY_REPOSITORIES: ${tenant} is not a tenant`)
    if (typeof repository !== "string" || !REPOSITORY.test(repository)) {
      throw new Error(`POLICY_REPOSITORIES: ${tenant}'s repository must be owner/name`)
    }
    repositories[tenant] = repository
  }
  const api = env["GITHUB_API"]
  return {
    app: loadGitHubApp(dir),
    api: api === undefined || api === "" ? "https://api.github.com" : api,
    repositories,
  }
}

const base64url = (data: string | Buffer) => Buffer.from(data).toString("base64url")

/** The App's JWT: RS256, issued a minute back for clock skew, nine minutes long (GitHub's limit is ten). */
function appJwt(app: GitHubApp, now = Math.floor(Date.now() / 1000)) {
  const head = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: app.appId }))
  const signature = sign("RSA-SHA256", Buffer.from(`${head}.${payload}`), app.privateKey)
  return `${head}.${payload}.${base64url(signature)}`
}

class Unreachable extends Error {}
interface Answer {
  readonly status: number
  readonly body: Record<string, unknown> & { message?: string }
}
const message = (answer: Answer) =>
  `GitHub answered ${answer.status}${typeof answer.body.message === "string" ? `: ${answer.body.message}` : ""}`
const contentsPath = (path: string) => path.split("/").map(encodeURIComponent).join("/")

export function createPublisher(
  app: GitHubApp,
  options: { readonly api?: string; readonly fetchFn?: typeof fetch } = {},
) {
  const api = (options.api ?? "https://api.github.com").replace(/\/+$/, "")
  const fetchFn = options.fetchFn ?? fetch

  async function call(
    method: string,
    path: string,
    authorization: string,
    body?: unknown,
  ): Promise<Answer> {
    let response: Response
    try {
      response = await fetchFn(`${api}${path}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization,
          "x-github-api-version": "2022-11-28",
          "user-agent": "cwa-dashboard",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      throw new Unreachable(
        `GitHub did not answer: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (response.status >= 500) throw new Unreachable(`GitHub answered ${response.status}`)
    const parsed: unknown = await response.json().catch(() => ({}))
    const record =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Answer["body"])
        : ({ items: parsed } as Answer["body"])
    return { status: response.status, body: record }
  }

  async function publish(request: PublishRequest): Promise<Published> {
    const { repository } = request
    const [owner, name] = repository.split("/") as [string, string]
    const noAccess = (text: string): Published => ({ kind: "no-access", repository, message: text })
    try {
      const minted = await call(
        "POST",
        `/app/installations/${encodeURIComponent(app.installationId)}/access_tokens`,
        `Bearer ${appJwt(app)}`,
        { repositories: [name], permissions: { contents: "write", pull_requests: "write" } },
      )
      if (minted.status !== 201 || typeof minted.body["token"] !== "string") {
        return noAccess(
          `GitHub refused the App's credentials (App ${app.appId}, installation ${app.installationId}): ${message(minted)}`,
        )
      }
      const auth = `token ${minted.body["token"]}`
      const at = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`

      const repo = await call("GET", at, auth)
      if (repo.status !== 200 || typeof repo.body["default_branch"] !== "string") {
        return noAccess(
          `The App cannot reach ${repository}; is it installed there? ${message(repo)}`,
        )
      }
      const base = repo.body["default_branch"]
      const baseRef = await call("GET", `${at}/git/ref/heads/${encodeURIComponent(base)}`, auth)
      if (baseRef.status === 404 || baseRef.status === 409) return { kind: "empty", repository }
      const baseSha = (baseRef.body["object"] as { sha?: unknown } | undefined)?.sha
      if (baseRef.status !== 200 || typeof baseSha !== "string") return noAccess(message(baseRef))

      const onBase = await call(
        "GET",
        `${at}/contents/${contentsPath(request.path)}?ref=${encodeURIComponent(base)}`,
        auth,
      )
      if (onBase.status === 200) return { kind: "conflict", repository, path: request.path }
      if (onBase.status !== 404) return noAccess(message(onBase))

      const headRef = await call("GET", `${at}/git/ref/heads/${contentsPath(request.head)}`, auth)
      if (headRef.status === 404) {
        const made = await call("POST", `${at}/git/refs`, auth, {
          ref: `refs/heads/${request.head}`,
          sha: baseSha,
        })
        if (made.status === 403 || made.status === 404) return noAccess(message(made))
        if (made.status !== 201) return { kind: "refused", repository, message: message(made) }
      } else if (headRef.status !== 200) {
        return noAccess(message(headRef))
      }

      const onHead = await call(
        "GET",
        `${at}/contents/${contentsPath(request.path)}?ref=${encodeURIComponent(request.head)}`,
        auth,
      )
      const sha =
        onHead.status === 200 && typeof onHead.body["sha"] === "string"
          ? onHead.body["sha"]
          : undefined
      const put = await call("PUT", `${at}/contents/${contentsPath(request.path)}`, auth, {
        message: request.message,
        content: Buffer.from(request.text, "utf8").toString("base64"),
        branch: request.head,
        ...(sha === undefined ? {} : { sha }),
      })
      if (put.status === 403 || put.status === 404) return noAccess(message(put))
      if (put.status !== 200 && put.status !== 201)
        return { kind: "refused", repository, message: message(put) }

      const open = await call(
        "GET",
        `${at}/pulls?state=open&head=${encodeURIComponent(`${owner}:${request.head}`)}`,
        auth,
      )
      const existing = Array.isArray(open.body["items"])
        ? (open.body["items"] as { number?: unknown; html_url?: unknown }[])[0]
        : undefined
      const pull =
        existing !== undefined && typeof existing.number === "number"
          ? await call("PATCH", `${at}/pulls/${existing.number}`, auth, {
              title: request.title,
              body: request.body,
            })
          : await call("POST", `${at}/pulls`, auth, {
              title: request.title,
              head: request.head,
              base,
              body: request.body,
            })
      const number = pull.body["number"]
      const url = pull.body["html_url"]
      if (
        (pull.status !== 200 && pull.status !== 201) ||
        typeof number !== "number" ||
        typeof url !== "string"
      ) {
        return pull.status === 403 || pull.status === 404
          ? noAccess(message(pull))
          : { kind: "refused", repository, message: message(pull) }
      }
      return {
        kind: "published",
        repository,
        path: request.path,
        branch: request.head,
        number,
        url,
      }
    } catch (error) {
      if (error instanceof Unreachable) return { kind: "unreachable", message: error.message }
      throw error
    }
  }

  return { publish }
}
