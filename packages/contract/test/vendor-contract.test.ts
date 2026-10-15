import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

const packageRoot = resolve(import.meta.dirname, "..")
const script = join(packageRoot, "scripts/vendor-contract.mjs")
// The specification checkout: $CWA_SPEC_CHECKOUT (as CI sets it), else the one beside the repository.
const sibling =
  process.env["CWA_SPEC_CHECKOUT"] ?? resolve(packageRoot, "../../../../contextwindowarchitecture")

// The fixture checkouts are real git repositories with a config of their own, so neither the
// developer's global hooks nor commit signing reach them, and the tests run the same in CI.
const isolated = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
}

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: isolated })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`)
  return result.stdout.trim()
}

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

// What the dashboard vendors (dashboard-plan.md 2.1), and what it leaves behind.
const VENDORED: Record<string, string> = {
  LICENSE: "license\n",
  NOTICE: "notice\n",
  "schema/trace.schema.json": '{"title":"trace"}\n',
  "contract/reasons.json": '{"reasons":[]}\n',
  "contract/model.json": '{"planes":[]}\n',
  "conformance/README.md": "# cases\n",
  "conformance/cases/minimal/case.json": '{"id":"minimal"}\n',
  "conformance/rejections/bad/case.json": '{"id":"bad"}\n',
  "conformance/registry/lock.json": "{}\n",
  "implementations/go.json": '{"language":"go"}\n',
  "examples/trace.json": "{}\n",
}
const LEFT_BEHIND: Record<string, string> = {
  "SPEC.md": "# spec\n",
  "conformance/check.py": "print()\n",
  "conformance/generators/all.py": "print()\n",
  "guides/one.md": "# guide\n",
}

describe("vendor-contract", () => {
  let checkout: string
  let root: string
  let commit: string

  beforeAll(() => {
    checkout = mkdtempSync(join(tmpdir(), "cwa-spec-"))
    root = mkdtempSync(join(tmpdir(), "cwa-contract-"))
    git(checkout, "init", "-q", "-b", "main")
    git(
      checkout,
      "remote",
      "add",
      "origin",
      "git@github.com:contextwindowarchitecture/contextwindowarchitecture.git",
    )
    for (const [path, content] of Object.entries({ ...VENDORED, ...LEFT_BEHIND })) {
      write(checkout, path, content)
    }
    git(checkout, "add", ".")
    git(checkout, "commit", "-q", "-m", "fixture")
    commit = git(checkout, "rev-parse", "HEAD")
    // Untracked files beside the contract are not part of what the commit publishes.
    write(checkout, "schema/scratch.schema.json", "{}\n")
  })

  afterAll(() => {
    rmSync(checkout, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  it("copies the contract's tracked files and pins each by SHA-256 in the lock", () => {
    const result = run(checkout, "--root", root)
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      `vendored 11 files from contextwindowarchitecture/contextwindowarchitecture at ${commit.slice(0, 7)}`,
    )

    const lock = JSON.parse(readFileSync(join(root, "vendor/cwa.lock.json"), "utf8"))
    expect(lock).toEqual({
      repository: "contextwindowarchitecture/contextwindowarchitecture",
      spec_commit: commit,
      dirty: false,
      files: Object.fromEntries(
        Object.entries(VENDORED)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([path, content]) => [path, sha256(content)]),
      ),
    })
    for (const [path, content] of Object.entries(VENDORED)) {
      expect(readFileSync(join(root, "vendor/cwa", path), "utf8")).toBe(content)
    }
    for (const path of [...Object.keys(LEFT_BEHIND), "schema/scratch.schema.json"]) {
      expect(existsSync(join(root, "vendor/cwa", path))).toBe(false)
    }
  })

  it("passes the check on an unmodified copy, against the lock and the checkout", () => {
    const lockOnly = run("--check", "--no-checkout", "--root", root)
    expect(lockOnly.stderr).toBe("")
    expect(lockOnly.status).toBe(0)
    expect(lockOnly.stdout).toContain("11 files match")
    expect(lockOnly.stdout).toContain("against the lock only")

    const withCheckout = run("--check", checkout, "--root", root)
    expect(withCheckout.stderr).toBe("")
    expect(withCheckout.status).toBe(0)
    expect(withCheckout.stdout).toContain(`against the lock and ${checkout}`)
  })

  it("fails the check when a vendored file is edited by hand, naming it", () => {
    const path = join(root, "vendor/cwa/contract/reasons.json")
    const original = readFileSync(path)
    writeFileSync(path, '{"reasons":["invented"]}\n')
    try {
      const result = run("--check", "--no-checkout", "--root", root)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("contract/reasons.json: differs from the lock")
    } finally {
      writeFileSync(path, original)
    }
  })

  it("fails the check when a file is added to the copy or missing from it", () => {
    const extra = join(root, "vendor/cwa/contract/extra.json")
    writeFileSync(extra, "{}\n")
    const added = run("--check", "--no-checkout", "--root", root)
    rmSync(extra)
    expect(added.status).toBe(1)
    expect(added.stderr).toContain("contract/extra.json: vendored but not in the lock")

    const path = join(root, "vendor/cwa/conformance/cases/minimal/case.json")
    const original = readFileSync(path)
    rmSync(path)
    try {
      const missing = run("--check", "--no-checkout", "--root", root)
      expect(missing.status).toBe(1)
      expect(missing.stderr).toContain(
        "conformance/cases/minimal/case.json: in the lock but not vendored",
      )
    } finally {
      writeFileSync(path, original)
    }
  })

  it("fails the check when the lock disagrees with the checkout at the locked commit", () => {
    const copy = mkdtempSync(join(tmpdir(), "cwa-contract-copy-"))
    cpSync(join(root, "vendor"), join(copy, "vendor"), { recursive: true })
    try {
      // The copy and the lock agree with each other, but not with what the commit published.
      const lockPath = join(copy, "vendor/cwa.lock.json")
      const lock = JSON.parse(readFileSync(lockPath, "utf8"))
      lock.files["contract/model.json"] = sha256('{"planes":["edited"]}\n')
      writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
      writeFileSync(join(copy, "vendor/cwa/contract/model.json"), '{"planes":["edited"]}\n')

      const result = run("--check", checkout, "--root", copy)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        `contract/model.json: the lock differs from ${commit.slice(0, 7)}`,
      )

      lock.spec_commit = "0".repeat(40)
      writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
      const unknown = run("--check", checkout, "--root", copy)
      expect(unknown.status).toBe(1)
      expect(unknown.stderr).toContain(`commit ${"0".repeat(40)} is not in ${checkout}`)
    } finally {
      rmSync(copy, { recursive: true, force: true })
    }
  })

  it("records a checkout with uncommitted changes as dirty", () => {
    const dirtyRoot = mkdtempSync(join(tmpdir(), "cwa-contract-dirty-"))
    const path = join(checkout, "contract/reasons.json")
    const original = readFileSync(path)
    writeFileSync(path, '{"reasons":["uncommitted"]}\n')
    try {
      const result = run(checkout, "--root", dirtyRoot)
      expect(result.status).toBe(0)
      expect(result.stderr).toContain("uncommitted changes")
      const lock = JSON.parse(readFileSync(join(dirtyRoot, "vendor/cwa.lock.json"), "utf8"))
      expect(lock.dirty).toBe(true)
    } finally {
      writeFileSync(path, original)
      rmSync(dirtyRoot, { recursive: true, force: true })
    }
  })

  it("refuses a directory that is not a git work tree", () => {
    const plain = mkdtempSync(join(tmpdir(), "cwa-plain-"))
    try {
      const result = run(plain, "--root", root)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain("is not a git work tree")
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })

  it.skipIf(!existsSync(join(packageRoot, "vendor/cwa.lock.json")))(
    "passes the check on this repository's own copy",
    () => {
      const result = run("--check", "--no-checkout", "--root", packageRoot)
      expect(result.stderr).toBe("")
      expect(result.status).toBe(0)
    },
  )

  it.skipIf(
    !existsSync(join(packageRoot, "vendor/cwa.lock.json")) || !existsSync(join(sibling, ".git")),
  )("matches the specification checkout beside the repository at the locked commit", () => {
    const result = run("--check", sibling, "--root", packageRoot)
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
  })
})
