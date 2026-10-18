#!/usr/bin/env node
// Fails an install that lacks a native binding for the platform it runs on. pnpm skips an optional
// dependency it cannot fetch without failing the install, so a timed-out download of, say, rolldown's
// linux-x64 binding leaves an image that fails at its build or, worse, at run time. Every package
// pnpm-lock.yaml constrains to an os, cpu or libc this machine matches must be in node_modules/.pnpm;
// packages for other platforms are not looked for. The images run it after `pnpm install`.
//
//   node deploy/check-native.mjs [--root .]
//
// Exits 0 when every one is installed, 1 naming those that are not, 2 when it cannot run.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const args = process.argv.slice(2)
const at = args.indexOf("--root")
const root = resolve(at >= 0 ? args[at + 1] : ".")
const cannot = (message) => {
  process.stderr.write(`check-native: ${message}\n`)
  process.exit(2)
}

let lock
try {
  lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8")
} catch (error) {
  cannot(`cannot read ${join(root, "pnpm-lock.yaml")}: ${error.message}`)
}

const { platform, arch } = process
// On Linux a package may name its C library; glibc's version is in the process report, musl has none.
const libc =
  platform === "linux"
    ? process.report.getReport().header.glibcVersionRuntime
      ? "glibc"
      : "musl"
    : undefined

/** Whether a lockfile list (`[x64]`, `['!win32']`) admits a value: by name, or by not naming it negated. */
function admits(list, value) {
  if (list === undefined) return true
  const negated = list.filter((entry) => entry.startsWith("!")).map((entry) => entry.slice(1))
  if (negated.length > 0) return !negated.includes(value)
  return list.includes(value)
}
const parseList = (text) =>
  text
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((entry) => entry.trim().replace(/^'|'$/g, ""))
    .filter(Boolean)

// pnpm writes its own lock, packageManagerDependencies, as a document of its own before the
// workspace's; it installs those elsewhere, so only the workspace's documents count.
const documents = lock
  .split(/^---$/m)
  .filter((document) => !/^ {4}packageManagerDependencies:/m.test(document))
// The packages section: a two-space key per package, its fields indented four.
const sections = documents
  .map((document) => document.split(/\npackages:\n/)[1]?.split(/\nsnapshots:\n/)[0])
  .filter((section) => section !== undefined)
if (sections.length === 0) cannot("pnpm-lock.yaml has no packages section")
const section = sections.join("\n")
const packages = []
let current
for (const line of section.split("\n")) {
  const key = /^ {2}'?(.+?)'?:$/.exec(line)
  if (key) {
    const name = key[1].slice(0, key[1].lastIndexOf("@"))
    const version = key[1].slice(key[1].lastIndexOf("@") + 1)
    current = { name, version, constraints: {} }
    packages.push(current)
    continue
  }
  const field = /^ {4}(os|cpu|libc): (\[.*\])$/.exec(line)
  if (field && current) current.constraints[field[1]] = parseList(field[2])
}

const forHere = packages.filter(({ constraints: { os, cpu, libc: libcs } }) => {
  if (os === undefined && cpu === undefined && libcs === undefined) return false
  return admits(os, platform) && admits(cpu, arch) && (libc === undefined || admits(libcs, libc))
})

const store = join(root, "node_modules/.pnpm")
const installed = existsSync(store) ? readdirSync(store) : []
const missing = forHere.filter(({ name, version }) => {
  const dir = `${name.replace("/", "+")}@${version}`
  return !installed.some((entry) => entry === dir || entry.startsWith(`${dir}_`))
})

const where = [platform, arch, libc].filter(Boolean).join(" ")
if (missing.length > 0) {
  process.stderr.write(
    `check-native: not installed for ${where}, though the lockfile has them (a download pnpm skipped?):\n${missing
      .map(({ name, version }) => `  ${name}@${version}`)
      .join("\n")}\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `check-native: ${forHere.length} platform package${forHere.length === 1 ? "" : "s"} for ${where}, all installed\n`,
)
