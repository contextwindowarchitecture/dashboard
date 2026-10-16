#!/usr/bin/env node
// Holds a build in dist/ to the budgets in budgets.json (dashboard-plan.md 11), gzipped:
//
//   initial JS and CSS   what index.html loads: its scripts, module preloads and stylesheets
//   a lazy chunk         every other script, each on its own
//   a worker             a script named *.worker-*.js, each on its own
//
// It fails when the initial JS holds a library budgets.json keeps out of it (`keptOut`: a name and a
// string only that library's code carries), and on eval or new Function in any script, which the
// Content Security Policy would refuse at runtime (dev/csp.ts); the TypeScript assembler compiles
// its validators that way, so this also keeps it out of every browser chunk.
//
//   node scripts/check-budgets.mjs [--root <dir>]   (after `pnpm build`; the root holds budgets.json)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

const args = process.argv.slice(2)
const rootIndex = args.indexOf("--root")
const root =
  rootIndex >= 0
    ? resolve(args[rootIndex + 1] ?? ".")
    : resolve(dirname(fileURLToPath(import.meta.url)), "..")
const distDir = join(root, "dist")
const budgets = JSON.parse(readFileSync(join(root, "budgets.json"), "utf8"))

if (!existsSync(join(distDir, "index.html"))) {
  process.stderr.write(`check-budgets: no build at ${distDir}; run \`pnpm build\` first\n`)
  process.exit(2)
}

const KB = 1024
const kb = (bytes) => `${(bytes / KB).toFixed(1)} kB`
const gzipped = (path) => gzipSync(readFileSync(join(distDir, path)), { level: 9 }).length

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory()
      ? walk(path)
      : [relative(distDir, path).split(sep).join("/")]
  })
}

// What index.html loads before anything else.
const html = readFileSync(join(distDir, "index.html"), "utf8")
const referenced = (pattern) =>
  [...html.matchAll(pattern)].map((match) => match[1].replace(/^\//, "").split("?")[0])
const initialJs = [
  ...referenced(/<script\b[^>]*\bsrc="([^"]+)"/g),
  ...referenced(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g),
]
const initialCss = referenced(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)

const scripts = walk(distDir).filter((path) => path.endsWith(".js"))
const isWorker = (path) => /\.worker-[^/]*\.js$/.test(path)
const lazy = scripts.filter((path) => !initialJs.includes(path) && !isWorker(path))
const workers = scripts.filter(isWorker)

const problems = []
const report = []

function total(label, paths, budgetKb) {
  const bytes = paths.reduce((sum, path) => sum + gzipped(path), 0)
  report.push(`${label} ${kb(bytes)} of ${budgetKb} kB (${paths.length} files)`)
  if (bytes > budgetKb * KB) problems.push(`${label} is ${kb(bytes)}, over ${budgetKb} kB`)
}

function each(label, paths, budgetKb) {
  const sizes = paths.map((path) => [path, gzipped(path)]).sort((a, b) => b[1] - a[1])
  const largest = sizes[0]
  report.push(
    largest
      ? `largest ${label} ${kb(largest[1])} of ${budgetKb} kB (${largest[0]}, ${sizes.length} in all)`
      : `no ${label}`,
  )
  for (const [path, bytes] of sizes) {
    if (bytes > budgetKb * KB)
      problems.push(`${label} ${path} is ${kb(bytes)}, over ${budgetKb} kB`)
  }
}

total("initial JS", initialJs, budgets.initialJsKb)
total("initial CSS", initialCss, budgets.initialCssKb)
each("lazy chunk", lazy, budgets.lazyChunkKb)
each("worker", workers, budgets.workerKb)

for (const [name, marker] of Object.entries(budgets.keptOut ?? {})) {
  for (const path of initialJs) {
    if (readFileSync(join(distDir, path), "utf8").includes(marker)) {
      problems.push(`${path} holds ${name}, which belongs in a lazy chunk`)
    }
  }
}

for (const path of scripts) {
  const code = readFileSync(join(distDir, path), "utf8")
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(code)) {
    problems.push(`${path} calls eval or new Function, which the Content Security Policy refuses`)
  }
}

process.stdout.write(`${report.map((line) => `check-budgets: ${line}`).join("\n")}\n`)
if (problems.length > 0) {
  process.stderr.write(`check-budgets: ${problems.length} problem(s):\n`)
  for (const problem of problems) process.stderr.write(`  ${problem}\n`)
  process.exit(1)
}
