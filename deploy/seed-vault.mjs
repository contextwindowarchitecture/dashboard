#!/usr/bin/env node
// Deposits a directory vault's bodies (ADR-0009) through an ingest service's PUT /bodies/<sha256>,
// as the wrapper of a route opted into the vault would, so a store that starts empty holds the
// demo's bodies. Idempotent: a body already held answers 200 and counts as held. The directory has
// the directory vault's layout, <two hex digits>/<sha256>.txt|.json, as packages/demo-traffic/vault.
//
//   node deploy/seed-vault.mjs <vault directory> <ingest base URL> [--token <token>]
//   INGEST_TOKEN=… node deploy/seed-vault.mjs packages/demo-traffic/vault http://127.0.0.1:8090

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const args = process.argv.slice(2)
const at = args.indexOf("--token")
const token = at >= 0 ? args[at + 1] : process.env.INGEST_TOKEN
const [dir, base] = args.filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--token")
if (!dir || !base || !token) {
  process.stderr.write(
    "usage: seed-vault.mjs <vault directory> <ingest base URL> [--token <token>]\n",
  )
  process.exit(2)
}
const url = base.replace(/\/+$/, "")
const TYPES = { txt: "text/plain; charset=utf-8", json: "application/json" }

const files = readdirSync(dir)
  .sort()
  .flatMap((prefix) =>
    readdirSync(join(dir, prefix))
      .sort()
      .map((name) => [prefix, name]),
  )
const counts = { deposited: 0, held: 0 }
for (const [prefix, name] of files) {
  const [sha256, extension] = name.split(".")
  const response = await fetch(`${url}/bodies/${sha256}`, {
    method: "PUT",
    headers: { "content-type": TYPES[extension] ?? "", authorization: `Bearer ${token}` },
    body: readFileSync(join(dir, prefix, name)),
  })
  if (response.status === 201) counts.deposited += 1
  else if (response.status === 200) counts.held += 1
  else {
    process.stderr.write(
      `seed-vault: ${name} answered ${response.status}: ${await response.text()}\n`,
    )
    process.exit(1)
  }
}
process.stdout.write(
  `seed-vault: ${counts.deposited} deposited, ${counts.held} already held, of ${files.length}\n`,
)
