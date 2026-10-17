#!/usr/bin/env node
// Shadow regression as a check (ADR-0008): runs a candidate route policy or profile against a corpus
// on a dashboard's ingest service (POST /shadow), prints what changed, and fails over its thresholds.
// Node only, nothing to install, so a pull request check in a policy repository can run it.
//
//   node deploy/shadow-check.mjs --api <base> --corpus <name> [--route-policy <file>] [--profile <file>]
//        [--max-refusals-added 0] [--max-shedding-increase 0] [--max-candidate-rejected 0] [--report <file>]
//
// Exits 0 within every threshold, 1 over one, 2 when it could not run (a usage error, a corpus the
// service does not hold, a service that does not answer).

import { readFileSync, writeFileSync } from "node:fs"

const args = process.argv.slice(2)
const option = (name) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const cannot = (message) => {
  process.stderr.write(`shadow-check: ${message}\n`)
  process.exit(2)
}
const limit = (name) => {
  const value = Number(option(name) ?? 0)
  if (!Number.isInteger(value) || value < 0) cannot(`${name} must be a whole number of 0 or more`)
  return value
}

const api = option("--api")
const corpus = option("--corpus")
if (!api || !corpus)
  cannot(
    "usage: shadow-check.mjs --api <base> --corpus <name> [--route-policy <file>] [--profile <file>]",
  )
const read = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    cannot(`cannot read ${path}: ${error.message}`)
  }
}
const candidate = {
  ...(option("--route-policy") ? { route_policy: read(option("--route-policy")) } : {}),
  ...(option("--profile") ? { profile: read(option("--profile")) } : {}),
}
if (Object.keys(candidate).length === 0)
  cannot("give the candidate: --route-policy <file>, --profile <file>, or both")
const limits = {
  refusals_added: limit("--max-refusals-added"),
  shedding_increase: limit("--max-shedding-increase"),
  candidate_rejected: limit("--max-candidate-rejected"),
}

let response
try {
  response = await fetch(`${api.replace(/\/+$/, "")}/shadow`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ corpus, candidate }),
  })
} catch (error) {
  cannot(`${api} did not answer: ${error.message}`)
}
const body = await response.json().catch(() => undefined)
if (!response.ok)
  cannot(`${api}/shadow answered ${response.status}: ${(body?.problems ?? []).join(" ")}`)
const report = body
if (option("--report")) writeFileSync(option("--report"), `${JSON.stringify(report, null, 2)}\n`)

const s = report.summary
const skipped =
  Object.entries(s.skipped)
    .map(([why, n]) => `${n} ${why}`)
    .join(", ") || "none"
process.stdout.write(
  `shadow-check: corpus ${report.corpus.name} (${report.corpus.events} events), ` +
    `replayed through ${report.assembler.name} ${report.assembler.version}\n` +
    `  replayed ${s.replayed}, skipped ${skipped}, changed ${s.changed}\n` +
    `  refusals added ${s.refusals_added}, removed ${s.refusals_removed}; ` +
    `candidate rejected ${s.candidate_rejected}; shedding change ${s.shedding_change}; ` +
    `placement changed ${s.placement_changed}; baselines differing from the record ${s.baseline_differs}\n`,
)
const breaches = [
  s.refusals_added > limits.refusals_added &&
    `refusals added ${s.refusals_added}, over the limit of ${limits.refusals_added}`,
  s.shedding_change > limits.shedding_increase &&
    `shedding increase ${s.shedding_change}, over the limit of ${limits.shedding_increase}`,
  s.candidate_rejected > limits.candidate_rejected &&
    `candidate rejected ${s.candidate_rejected} times, over the limit of ${limits.candidate_rejected}`,
].filter(Boolean)
if (breaches.length > 0) {
  process.stdout.write(`shadow-check: over a threshold:\n  ${breaches.join("\n  ")}\n`)
  process.exit(1)
}
process.stdout.write("shadow-check: within every threshold\n")
