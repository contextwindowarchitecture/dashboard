#!/usr/bin/env node
// A policy repository's check (ADR-0014), run in a checkout of the repository on every pull request:
//
//   node deploy/policy-check.mjs --base <git ref> [--root .] [--config shadow.json] [--report-dir <dir>]
//
// Every file under route-policies/ and profiles/ must be where the layout puts it
// (route-policies/<route>/<version>.json, profiles/<id>/<version>.json) and hold what its path names.
// Against --base, a pull request adds versions; it never edits or removes a published one. Each route
// it changes is shadowed over the route's corpus in shadow.json, its changed route policy and profile
// together, within shadow.json's limits (deploy/shadow-check.mjs, through the dashboard's API). The
// assembler behind the API checks each candidate against the contract, so nothing here is installed.
//
// Exits 0 when all holds, 1 when something does not, 2 when it cannot run (no shadow.json, no base,
// a dashboard that does not answer): a check that cannot run never passes.

import { spawnSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { checkFile, identityOf } from "../apps/ingest/src/policy-layout.ts"

const args = process.argv.slice(2)
const option = (name) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const cannot = (message) => {
  process.stderr.write(`policy-check: ${message}\n`)
  process.exit(2)
}
const say = (line) => process.stdout.write(`${line}\n`)

const root = resolve(option("--root") ?? ".")
const base = option("--base")
if (!base) cannot("usage: policy-check.mjs --base <git ref> [--root .] [--config shadow.json]")
const reportDir = option("--report-dir") ?? tmpdir()
mkdirSync(reportDir, { recursive: true })

const git = (...command) => {
  const run = spawnSync("git", command, { cwd: root, encoding: "utf8" })
  return run.status === 0 ? run.stdout : undefined
}
if (git("rev-parse", "--verify", "--quiet", `${base}^{commit}`) === undefined) {
  cannot(`${base} is not a commit in ${root}; fetch the base branch with its history`)
}

let config
try {
  config = JSON.parse(readFileSync(join(root, option("--config") ?? "shadow.json"), "utf8"))
} catch (error) {
  cannot(`cannot read shadow.json: ${error.message}`)
}
if (
  typeof config !== "object" ||
  config === null ||
  typeof config.api !== "string" ||
  typeof config.corpora !== "object" ||
  config.corpora === null
) {
  cannot('shadow.json must name the dashboard\'s "api" and a "corpora" object, route to corpus')
}

const problems = []
const documents = new Map()

// Every file in the layout's two directories, whatever the pull request changed.
function walk(dir) {
  let entries
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(path)
    else if (entry.name !== ".gitkeep") {
      let document
      try {
        document = JSON.parse(readFileSync(join(root, path), "utf8"))
      } catch (error) {
        problems.push(`${path}: not JSON (${error.message})`)
        continue
      }
      const found = checkFile(path, document)
      problems.push(...found)
      if (found.length === 0) documents.set(path, document)
    }
  }
}
walk("route-policies")
walk("profiles")

// What the pull request changes: added versions only.
const diff = git(
  "diff",
  "--name-status",
  "--no-renames",
  `${base}...HEAD`,
  "--",
  "route-policies",
  "profiles",
)
if (diff === undefined) cannot(`cannot compare with ${base}`)
const added = []
for (const line of diff.split("\n").filter(Boolean)) {
  const [status, path] = line.split("\t")
  if (path.endsWith("/.gitkeep")) continue
  if (status === "A") added.push(path)
  else if (status === "D") problems.push(`${path}: a published version is never removed`)
  else problems.push(`${path}: a published version is never edited; add a new version`)
}

// Each route the pull request changes, its route policy and profile shadowed together.
const routes = new Map()
for (const path of added) {
  const document = documents.get(path)
  const identity = identityOf(path)
  if (document === undefined || identity === undefined) continue
  const route = identity.kind === "route_policy" ? identity.name : String(document.route)
  const changed = routes.get(route) ?? { route_policy: [], profile: [] }
  changed[identity.kind].push(path)
  routes.set(route, changed)
}

const SHADOW = resolve(import.meta.dirname, "shadow-check.mjs")
const LIMITS = ["max-refusals-added", "max-shedding-increase", "max-candidate-rejected"]
let unreachable = false
for (const [route, changed] of routes) {
  const label = [...changed.route_policy, ...changed.profile].join(" with ")
  if (changed.route_policy.length > 1 || changed.profile.length > 1) {
    problems.push(`${label}: one route policy and one profile a route in a pull request`)
    continue
  }
  const corpus = config.corpora[route]
  if (typeof corpus !== "string") {
    problems.push(`${label}: shadow.json names no corpus for the route ${route}`)
    continue
  }
  const command = [
    SHADOW,
    "--api",
    config.api,
    "--corpus",
    corpus,
    "--report",
    join(reportDir, `shadow-report-${route}.json`),
  ]
  if (typeof config.tenant === "string" && config.tenant !== "")
    command.push("--tenant", config.tenant)
  if (changed.route_policy[0]) command.push("--route-policy", join(root, changed.route_policy[0]))
  if (changed.profile[0]) command.push("--profile", join(root, changed.profile[0]))
  for (const limit of LIMITS) {
    const value = config.limits?.[limit]
    if (value !== undefined) command.push(`--${limit}`, String(value))
  }
  const run = spawnSync(process.execPath, command, { encoding: "utf8" })
  process.stdout.write(run.stdout ?? "")
  process.stderr.write(run.stderr ?? "")
  if (run.status === 0) say(`${label}: shadowed over ${corpus}, within its limits`)
  else if (run.status === 1) problems.push(`${label}: shadowed over ${corpus}, over its limits`)
  else {
    unreachable = true
    say(`${label}: the shadow run over ${corpus} could not run`)
  }
}

for (const problem of problems) say(`problem: ${problem}`)
if (problems.length > 0) process.exit(1)
if (unreachable) process.exit(2)
say(`policy-check: ${documents.size} files in the layout, ${routes.size} routes shadowed`)
