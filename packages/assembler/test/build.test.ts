import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

const script = resolve(import.meta.dirname, "../scripts/build.mjs")

// A throwaway assembler repository: a package whose build writes dist/index.js, tagged. Its git
// config is its own, so neither the developer's hooks nor signing reach it.
const isolated = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
}

function sh(cwd: string, command: string, ...args: string[]) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: isolated })
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")}: ${result.stderr}`)
  return result.stdout.trim()
}

let source: string
let root: string
let first: string

function pin(tag: string, commit: string) {
  writeFileSync(
    join(root, "pin.json"),
    JSON.stringify({ repository: "contextwindowarchitecture/assembler-typescript", tag, commit }),
  )
}

function run() {
  const result = spawnSync(process.execPath, [script, "--root", root, "--source", source], {
    encoding: "utf8",
    env: isolated,
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

beforeAll(() => {
  source = mkdtempSync(join(tmpdir(), "cwa-assembler-src-"))
  root = mkdtempSync(join(tmpdir(), "cwa-assembler-root-"))
  writeFileSync(
    join(source, "package.json"),
    JSON.stringify({
      name: "fixture-assembler",
      version: "0.0.1",
      type: "module",
      scripts: { build: "node build.js" },
    }),
  )
  writeFileSync(
    join(source, "build.js"),
    'import { mkdirSync, writeFileSync } from "node:fs"\nmkdirSync("dist", { recursive: true })\nwriteFileSync("dist/index.js", "export const BUILT = 1\\n")\n',
  )
  sh(source, "git", "init", "-q", "-b", "main")
  sh(source, "pnpm", "install", "--ignore-workspace", "--silent")
  writeFileSync(join(source, ".gitignore"), "node_modules/\ndist/\n")
  sh(source, "git", "add", ".")
  sh(source, "git", "commit", "-q", "-m", "first")
  sh(source, "git", "tag", "draft-release")
  first = sh(source, "git", "rev-parse", "HEAD")
  // The build directory sits inside this repository's pnpm workspace, as .build/ does; the clone's
  // install must not take the workspace's lockfile for its own.
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n")
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture-workspace", private: true }),
  )
  sh(root, "pnpm", "install", "--silent")
})

afterAll(() => {
  rmSync(source, { recursive: true, force: true })
  rmSync(root, { recursive: true, force: true })
})

describe("build.mjs", () => {
  it("builds the pinned tag into .build/ and stamps it", () => {
    pin("draft-release", first)
    const result = run()
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`built draft-release at ${first.slice(0, 7)}`)
    const built = join(root, ".build/assembler-typescript")
    expect(readFileSync(join(built, "dist/index.js"), "utf8")).toContain("BUILT")
    expect(JSON.parse(readFileSync(join(built, ".cwa-build.json"), "utf8"))).toEqual({
      tag: "draft-release",
      commit: first,
    })
  })

  it("does nothing when the build is already at the pin", () => {
    pin("draft-release", first)
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("up to date")
  })

  it("fails when the tag no longer points at the pinned commit", () => {
    rmSync(join(root, ".build"), { recursive: true, force: true })
    pin("draft-release", "0".repeat(40))
    const result = run()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`draft-release is at ${first}, the pin says ${"0".repeat(40)}`)
    expect(existsSync(join(root, ".build/assembler-typescript/.cwa-build.json"))).toBe(false)
  })

  it("rebuilds when the pin moves to another tag", () => {
    pin("draft-release", first)
    expect(run().status).toBe(0)
    writeFileSync(join(source, "CHANGES.md"), "second\n")
    sh(source, "git", "add", ".")
    sh(source, "git", "commit", "-q", "-m", "second")
    sh(source, "git", "tag", "next-release")
    const second = sh(source, "git", "rev-parse", "HEAD")
    pin("next-release", second)
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`built next-release at ${second.slice(0, 7)}`)
  })
})
