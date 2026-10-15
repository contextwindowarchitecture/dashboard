#!/usr/bin/env node
// Vendors the published CWA contract into packages/contract/vendor/cwa/ by copy at a pinned commit,
// and pins every file by SHA-256 in vendor/cwa.lock.json with the repository and commit it came
// from. The dashboard reads every code, requirement, slot and field name from this copy and from
// nothing else (AGENTS.md, "The contract and the assembler are pinned").
//
//   node scripts/vendor-contract.mjs <checkout>           copy, hash and rewrite the lock
//   node scripts/vendor-contract.mjs --check [checkout]   fail on drift between the lock, the
//                                                         vendored copy and the checkout at the
//                                                         locked commit
//
// Options: --root <dir> (the package root; defaults to the script's parent directory) and
// --no-checkout (with --check: compare the copy with the lock only). With --check and no checkout
// argument, $CWA_SPEC_CHECKOUT is used, then the specification checkout beside the repository
// (../../contextwindowarchitecture from the repository root) when it is a git work tree; otherwise
// the checkout comparison is skipped and said so.
//
// Only the files the checkout's git tracks are copied, so an editor's or a tool's files beside the
// contract never enter the copy. Only Node built-ins, so the script runs before `pnpm install`.

import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const VENDOR_DIR = "vendor/cwa"
const LOCK_FILE = "vendor/cwa.lock.json"
const EXPECTED_REPOSITORY = "contextwindowarchitecture/contextwindowarchitecture"

// What the dashboard reads from the specification (dashboard-plan.md 2.1): the schemas, the
// contract data, the conformance cases, rejections and registry, the implementations' reports, the
// examples, and the license and notice that come with them. The generators and checker stay behind.
const PATHSPECS = [
  "LICENSE",
  "NOTICE",
  "schema",
  "contract",
  "conformance/README.md",
  "conformance/cases",
  "conformance/rejections",
  "conformance/registry",
  "implementations",
  "examples",
]

function main(argv) {
  const args = parseArgs(argv)
  const root = args.root ?? resolve(dirname(fileURLToPath(import.meta.url)), "..")
  if (args.check) return check(root, args)
  if (!args.checkout) {
    usage()
    return 2
  }
  return vendor(root, resolve(args.checkout))
}

function parseArgs(argv) {
  const args = { check: false, noCheckout: false, root: null, checkout: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--check") args.check = true
    else if (arg === "--no-checkout") args.noCheckout = true
    else if (arg === "--root") args.root = resolve(argv[++i] ?? ".")
    else if (arg === "--help" || arg === "-h") {
      usage()
      process.exit(0)
    } else if (arg.startsWith("-")) fail(`unknown option ${arg}`)
    else if (args.checkout === null) args.checkout = arg
    else fail(`unexpected argument ${arg}`)
  }
  return args
}

function usage() {
  process.stderr.write(
    "usage: vendor-contract.mjs <checkout> | --check [checkout] [--no-checkout] [--root <dir>]\n",
  )
}

function fail(message) {
  process.stderr.write(`vendor-contract: ${message}\n`)
  process.exit(2)
}

// --- git -----------------------------------------------------------------------------------------

function git(checkout, args, options = {}) {
  const result = spawnSync("git", ["-C", checkout, ...args], {
    ...(options.binary ? {} : { encoding: "utf8" }),
    input: options.input === undefined ? undefined : Buffer.from(options.input),
    maxBuffer: 1024 * 1024 * 1024,
  })
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString() : result.stderr
    throw new Error(`git ${args.join(" ")} failed in ${checkout}: ${stderr.trim()}`)
  }
  return result.stdout
}

function isWorkTree(dir) {
  if (!existsSync(dir)) return false
  const result = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  })
  // The checkout must be the top of its work tree, not a directory inside another repository.
  return result.status === 0 && realpathSync(result.stdout.trim()) === realpathSync(dir)
}

// The owner/name the origin remote names on GitHub, over ssh, ssh:// or https.
function repositorySlug(url) {
  return /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url)?.[1] ?? null
}

function splitPaths(out) {
  return out
    .split("\0")
    .filter((path) => path.length > 0)
    .sort()
}

function listTracked(checkout) {
  return splitPaths(git(checkout, ["ls-files", "-z", "--", ...PATHSPECS]))
}

function listAtCommit(checkout, commit) {
  return splitPaths(
    git(checkout, ["ls-tree", "-r", "-z", "--name-only", commit, "--", ...PATHSPECS]),
  )
}

// Hashes every path as it is at the commit, through one `git cat-file --batch` process.
function hashesAtCommit(checkout, commit, paths) {
  const input = paths.map((path) => `${commit}:${path}\n`).join("")
  const out = git(checkout, ["cat-file", "--batch"], { input, binary: true })
  const hashes = new Map()
  let offset = 0
  for (const path of paths) {
    const newline = out.indexOf(0x0a, offset)
    if (newline < 0) throw new Error(`git cat-file --batch: truncated output at ${path}`)
    const fields = out.subarray(offset, newline).toString().split(" ")
    offset = newline + 1
    if (fields[1] === "missing") throw new Error(`${path} is not at ${commit}`)
    const size = Number.parseInt(fields[2], 10)
    hashes.set(path, sha256(out.subarray(offset, offset + size)))
    offset += size + 1 // the content and the newline after it
  }
  return hashes
}

// --- files ---------------------------------------------------------------------------------------

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function walk(dir, base = dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(path, base))
    else files.push(relative(base, path).split(sep).join("/"))
  }
  return files.sort()
}

function readLock(root) {
  const path = join(root, LOCK_FILE)
  if (!existsSync(path)) fail(`${LOCK_FILE} is missing; run the script with a checkout first`)
  return JSON.parse(readFileSync(path, "utf8"))
}

// --- vendor --------------------------------------------------------------------------------------

function vendor(root, checkout) {
  if (!isWorkTree(checkout)) fail(`${checkout} is not a git work tree`)
  const commit = git(checkout, ["rev-parse", "HEAD"]).trim()
  const origin = git(checkout, ["remote", "get-url", "origin"]).trim()
  const repository = repositorySlug(origin)
  if (!repository) fail(`cannot derive a GitHub repository from origin ${origin}`)
  if (repository !== EXPECTED_REPOSITORY) {
    process.stderr.write(
      `vendor-contract: warning: origin is ${repository}, not ${EXPECTED_REPOSITORY}\n`,
    )
  }
  // Dirty means a tracked file differs from the commit; untracked files are not vendored.
  const dirty = git(checkout, ["status", "--porcelain", "--untracked-files=no"]).trim().length > 0
  if (dirty) {
    process.stderr.write(
      "vendor-contract: warning: the checkout has uncommitted changes; the lock says so\n",
    )
  }

  const paths = listTracked(checkout)
  if (paths.length === 0) fail(`nothing to vendor under ${checkout}`)
  const target = join(root, VENDOR_DIR)
  rmSync(target, { recursive: true, force: true })
  const files = {}
  for (const path of paths) {
    const bytes = readFileSync(join(checkout, path))
    const destination = join(target, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, bytes)
    files[path] = sha256(bytes)
  }
  const lock = { repository, spec_commit: commit, dirty, files }
  writeFileSync(join(root, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`)
  process.stdout.write(
    `vendored ${paths.length} files from ${repository} at ${commit.slice(0, 7)}${dirty ? " (dirty)" : ""} into ${VENDOR_DIR}\n`,
  )
  return 0
}

// --- check ---------------------------------------------------------------------------------------

function check(root, args) {
  const lock = readLock(root)
  const problems = []
  const locked = new Map(Object.entries(lock.files))

  // The copy against the lock.
  const target = join(root, VENDOR_DIR)
  const present = existsSync(target) ? walk(target) : []
  const presentSet = new Set(present)
  for (const path of present) {
    const expected = locked.get(path)
    if (expected === undefined) problems.push(`${path}: vendored but not in the lock`)
    else if (sha256(readFileSync(join(target, path))) !== expected)
      problems.push(`${path}: differs from the lock`)
  }
  for (const path of locked.keys()) {
    if (!presentSet.has(path)) problems.push(`${path}: in the lock but not vendored`)
  }

  // The lock against the checkout at the locked commit.
  let checkout = null
  if (!args.noCheckout) {
    checkout = args.checkout ?? process.env.CWA_SPEC_CHECKOUT ?? null
    if (checkout === null) {
      const sibling = resolve(root, "../../../../contextwindowarchitecture")
      if (isWorkTree(sibling)) checkout = sibling
    }
  }
  if (checkout !== null) {
    checkout = resolve(checkout)
    if (!isWorkTree(checkout)) fail(`${checkout} is not a git work tree`)
    const exists = spawnSync("git", [
      "-C",
      checkout,
      "cat-file",
      "-e",
      `${lock.spec_commit}^{commit}`,
    ])
    if (exists.status !== 0) {
      problems.push(`commit ${lock.spec_commit} is not in ${checkout}`)
    } else {
      const origin = git(checkout, ["remote", "get-url", "origin"]).trim()
      const repository = repositorySlug(origin)
      if (repository !== lock.repository)
        problems.push(`${checkout} is ${repository ?? origin}, the lock pins ${lock.repository}`)
      const short = lock.spec_commit.slice(0, 7)
      const hashes = hashesAtCommit(
        checkout,
        lock.spec_commit,
        listAtCommit(checkout, lock.spec_commit),
      )
      for (const [path, hash] of hashes) {
        const expected = locked.get(path)
        if (expected === undefined) problems.push(`${path}: at ${short} but not in the lock`)
        else if (hash !== expected) problems.push(`${path}: the lock differs from ${short}`)
      }
      for (const path of locked.keys()) {
        if (!hashes.has(path)) problems.push(`${path}: in the lock but not at ${short}`)
      }
    }
  }

  const where =
    checkout === null ? "against the lock only (no checkout)" : `against the lock and ${checkout}`
  if (problems.length > 0) {
    process.stderr.write(`vendor-contract: ${problems.length} problem(s) ${where}:\n`)
    for (const problem of problems) process.stderr.write(`  ${problem}\n`)
    return 1
  }
  process.stdout.write(
    `vendor-contract: ${locked.size} files match ${lock.repository} at ${lock.spec_commit.slice(0, 7)}${lock.dirty ? " (dirty)" : ""}, ${where}\n`,
  )
  return 0
}

process.exit(main(process.argv.slice(2)))
