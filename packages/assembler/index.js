// The TypeScript assembler at the pinned tag, as scripts/build.mjs built it (ADR-0003), and what an
// assembly event says about it, read from the build itself.

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

export * from "./.build/assembler-typescript/dist/index.js"

const built = new URL("./.build/assembler-typescript/", import.meta.url)
const manifest = JSON.parse(readFileSync(new URL("package.json", built), "utf8"))
const pin = JSON.parse(readFileSync(new URL("./pin.json", import.meta.url), "utf8"))
const lockBytes = readFileSync(new URL("vendor/cwa.lock.json", built))
const lock = JSON.parse(lockBytes.toString("utf8"))

export const BUILT_ASSEMBLER = Object.freeze({
  language: "typescript",
  name: manifest.name,
  version: manifest.version,
  tag: pin.tag,
  commit: pin.commit,
  contract: Object.freeze({
    repository: lock.repository,
    commit: lock.spec_commit,
    lock_sha256: createHash("sha256").update(lockBytes).digest("hex"),
  }),
})
