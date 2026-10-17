// Publishing as a GitHub App (ADR-0014), against GitHub's API in this process: an installation token
// scoped to one repository, a branch from the default branch, the file committed to it, one pull
// request, kept on a second publish; a version the default branch holds is a conflict; and each way
// GitHub refuses has its own answer.

import { generateKeyPairSync } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import {
  createPublisher,
  loadGitHubApp,
  publishConfigFrom,
  type PublishRequest,
} from "../src/github.ts"
import { startGitHub, type FakeGitHub } from "./github-fake.ts"
import { freePort } from "./sign-in.ts"

let github: FakeGitHub
beforeAll(async () => {
  github = await startGitHub({ repository: "acme/policies" })
})
afterAll(() => github.close())
afterEach(() => {
  github.fault = undefined
  github.pulls.length = 0
  github.commits.length = 0
  github.tokens.length = 0
  for (const branch of [...github.branches.keys()])
    if (branch !== "main") github.branches.delete(branch)
  github.branches.get("main")!.delete("profiles/cache-first-chat/2.json")
})

const app = () => ({
  appId: github.appId,
  installationId: github.installationId,
  privateKey: github.privateKey,
})
const REQUEST: PublishRequest = {
  repository: "acme/policies",
  path: "profiles/cache-first-chat/2.json",
  text: '{\n  "id": "cache-first-chat",\n  "version": 2\n}\n',
  head: "cwa-dashboard/a1b2c3d4-0000-4000-8000-000000000001",
  message: "Add profile cache-first-chat v2",
  title: "Profile cache-first-chat v2",
  body: "Drafted by Ada.",
}

describe("publishing a file as the App", () => {
  it("branches from the default branch, commits the file and opens a pull request", async () => {
    const publisher = createPublisher(app(), { api: github.url })
    const answer = await publisher.publish(REQUEST)
    expect(answer).toEqual({
      kind: "published",
      repository: "acme/policies",
      path: REQUEST.path,
      branch: REQUEST.head,
      number: 1,
      url: "https://github.test/acme/policies/pull/1",
    })
    expect(github.branches.get(REQUEST.head)!.get(REQUEST.path)).toBe(REQUEST.text)
    expect(github.branches.get("main")!.has(REQUEST.path)).toBe(false)
    expect(github.commits).toEqual([
      { branch: REQUEST.head, path: REQUEST.path, message: REQUEST.message },
    ])
    expect(github.pulls).toMatchObject([
      { head: REQUEST.head, base: "main", title: REQUEST.title, body: REQUEST.body },
    ])
    // The token reaches one repository, with the two permissions and no more.
    expect(github.tokens).toEqual([
      { repositories: ["policies"], permissions: { contents: "write", pull_requests: "write" } },
    ])
  })

  it("commits a second publish to the same branch and keeps the one pull request", async () => {
    const publisher = createPublisher(app(), { api: github.url })
    await publisher.publish(REQUEST)
    const again = await publisher.publish({
      ...REQUEST,
      text: REQUEST.text.replace("2\n", '2,\n  "model_family": []\n'),
      body: "Drafted by Ada, again.",
    })
    expect(again).toMatchObject({ kind: "published", number: 1 })
    expect(github.commits).toHaveLength(2)
    expect(github.branches.get(REQUEST.head)!.get(REQUEST.path)).toContain("model_family")
    expect(github.pulls).toHaveLength(1)
    expect(github.pulls[0]!.body).toBe("Drafted by Ada, again.")
  })

  it("will not change a version the default branch already holds", async () => {
    github.branches.get("main")!.set(REQUEST.path, "{}\n")
    const answer = await createPublisher(app(), { api: github.url }).publish(REQUEST)
    expect(answer).toEqual({ kind: "conflict", repository: "acme/policies", path: REQUEST.path })
    expect(github.branches.has(REQUEST.head)).toBe(false)
    expect(github.commits).toEqual([])
  })
})

describe("when GitHub refuses", () => {
  const publish = () => createPublisher(app(), { api: github.url }).publish(REQUEST)

  it("says the App cannot reach a repository it is not installed on", async () => {
    github.fault = "not-installed"
    expect(await publish()).toMatchObject({ kind: "no-access", repository: "acme/policies" })
  })

  it("says the App lacks a permission", async () => {
    github.fault = "forbidden"
    expect(await publish()).toMatchObject({
      kind: "no-access",
      message: expect.stringContaining("Resource not accessible by integration"),
    })
  })

  it("says the App lacks a permission when the branch is there and only the commit is refused", async () => {
    await publish()
    github.fault = "forbidden"
    expect(await publish()).toMatchObject({
      kind: "no-access",
      message: expect.stringContaining("Resource not accessible by integration"),
    })
    expect(github.commits).toHaveLength(1)
  })

  it("says a rule refused the commit, in GitHub's words", async () => {
    github.fault = "protected"
    expect(await publish()).toMatchObject({
      kind: "refused",
      message: expect.stringContaining("Repository rule violations found"),
    })
    expect(github.pulls).toEqual([])
  })

  it("says the repository has nothing to branch from", async () => {
    github.fault = "empty"
    expect(await publish()).toEqual({ kind: "empty", repository: "acme/policies" })
  })

  it("says GitHub did not answer", async () => {
    github.fault = "down"
    expect(await publish()).toMatchObject({ kind: "unreachable" })
    const closed = await freePort()
    expect(
      await createPublisher(app(), { api: `http://127.0.0.1:${closed}` }).publish(REQUEST),
    ).toMatchObject({ kind: "unreachable" })
  })

  it("says GitHub refused the App's own credentials", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs1", format: "pem" })
      .toString()
    const answer = await createPublisher(
      { ...app(), privateKey: other },
      { api: github.url },
    ).publish(REQUEST)
    expect(answer).toMatchObject({ kind: "no-access", message: expect.stringContaining("App") })
    expect(github.tokens).toEqual([])
  })
})

describe("the App's credentials", () => {
  it("are read from the secret's mount, one file each", () => {
    const dir = mkdtempSync(join(tmpdir(), "github-app-"))
    writeFileSync(join(dir, "app-id"), `${github.appId}\n`)
    writeFileSync(join(dir, "installation-id"), github.installationId)
    writeFileSync(join(dir, "private-key.pem"), github.privateKey)
    expect(loadGitHubApp(dir)).toEqual(app())
    expect(() => loadGitHubApp(join(dir, "nowhere"))).toThrow(/app-id/)
  })
})

describe("the configuration", () => {
  const dir = () => {
    const at = mkdtempSync(join(tmpdir(), "github-app-"))
    writeFileSync(join(at, "app-id"), github.appId)
    writeFileSync(join(at, "installation-id"), github.installationId)
    writeFileSync(join(at, "private-key.pem"), github.privateKey)
    return at
  }

  it("is absent without GITHUB_APP_DIR, and Publish answers with the commands", () => {
    expect(publishConfigFrom({})).toBeUndefined()
    expect(publishConfigFrom({ GITHUB_APP_DIR: "" })).toBeUndefined()
  })

  it("names the App, each tenant's repository and GitHub's API", () => {
    const at = dir()
    expect(
      publishConfigFrom({
        GITHUB_APP_DIR: at,
        POLICY_REPOSITORIES: '{"default":"acme/policies","northwind":"northwind/policies"}',
      }),
    ).toEqual({
      app: app(),
      api: "https://api.github.com",
      repositories: { default: "acme/policies", northwind: "northwind/policies" },
    })
    expect(
      publishConfigFrom({
        GITHUB_APP_DIR: at,
        POLICY_REPOSITORIES: '{"default":"acme/policies"}',
        GITHUB_API: "https://github.example/api/v3",
      })?.api,
    ).toBe("https://github.example/api/v3")
  })

  it("stops the service when it cannot be what it says", () => {
    const at = dir()
    expect(() => publishConfigFrom({ GITHUB_APP_DIR: at })).toThrow(/POLICY_REPOSITORIES/)
    expect(() =>
      publishConfigFrom({ GITHUB_APP_DIR: at, POLICY_REPOSITORIES: "acme/policies" }),
    ).toThrow(/POLICY_REPOSITORIES/)
    expect(() =>
      publishConfigFrom({ GITHUB_APP_DIR: at, POLICY_REPOSITORIES: '{"default":"policies"}' }),
    ).toThrow(/owner\/name/)
    expect(() =>
      publishConfigFrom({ GITHUB_APP_DIR: at, POLICY_REPOSITORIES: '{"Not A Tenant":"a/b"}' }),
    ).toThrow(/tenant/)
  })
})
