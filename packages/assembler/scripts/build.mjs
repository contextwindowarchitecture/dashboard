#!/usr/bin/env node
// Builds the TypeScript assembler at the tag pin.json names, for the packages that run it: the
// demo-traffic generator and the ingest service's replay (ADR-0003). The tag's tree has no compiled
// dist/ and no prepare script, so a git dependency would have no entry point; this repository
// compiles it instead, with the assembler's own lockfile and toolchain.
//
//   node scripts/build.mjs [--source <git url or directory>] [--root <dir>]
//
// It clones the tag into <root>/.build/<repository name>, fails when the tag no longer points at
// the pinned commit, installs from the clone's own lockfile outside this workspace, runs its build,
// and stamps the result; a later run at the same pin does nothing. The default source is the
// pinned repository on GitHub; --source names another, a local checkout say.

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const root = resolve(option("--root") ?? join(dirname(fileURLToPath(import.meta.url)), ".."))
const pin = JSON.parse(readFileSync(join(root, "pin.json"), "utf8"))
const name = pin.repository.split("/")[1]
const target = join(root, ".build", name)
const stampPath = join(target, ".cwa-build.json")
const short = pin.commit.slice(0, 7)

function fail(message, code = 1) {
  process.stderr.write(`assembler: ${message}\n`)
  process.exit(code)
}

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(" ")} failed:\n${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

// --- already built -------------------------------------------------------------------------------

if (existsSync(stampPath) && existsSync(join(target, "dist/index.js"))) {
  const stamp = JSON.parse(readFileSync(stampPath, "utf8"))
  if (stamp.tag === pin.tag && stamp.commit === pin.commit) {
    process.stdout.write(`assembler: up to date, ${pin.tag} at ${short}\n`)
    process.exit(0)
  }
}

// --- clone, check, install, build ----------------------------------------------------------------

const given = option("--source") ?? `https://github.com/${pin.repository}.git`
// A shallow clone of a local directory needs a file:// URL; git ignores --depth on a plain path.
const source = existsSync(given) ? pathToFileURL(resolve(given)).href : given

rmSync(target, { recursive: true, force: true })
mkdirSync(dirname(target), { recursive: true })
run("git", ["clone", "--quiet", "--depth", "1", "--branch", pin.tag, source, target])

const head = run("git", ["-C", target, "rev-parse", "HEAD"])
if (head !== pin.commit) {
  rmSync(target, { recursive: true, force: true })
  fail(`${pin.tag} is at ${head}, the pin says ${pin.commit}`)
}

// The clone sits inside this repository's pnpm workspace, and pnpm would take the workspace's
// lockfile for its own. A workspace file of the clone's own makes it its own root, so it installs
// from its own lockfile.
if (!existsSync(join(target, "pnpm-workspace.yaml"))) {
  writeFileSync(join(target, "pnpm-workspace.yaml"), "packages: []\n")
}
run("pnpm", ["install", "--frozen-lockfile"], target)
run("pnpm", ["run", "build"], target)
if (!existsSync(join(target, "dist/index.js")))
  fail(`the build wrote no dist/index.js in ${target}`)

writeFileSync(stampPath, `${JSON.stringify({ tag: pin.tag, commit: pin.commit }, null, 2)}\n`)
process.stdout.write(`assembler: built ${pin.tag} at ${short} into .build/${name}\n`)
