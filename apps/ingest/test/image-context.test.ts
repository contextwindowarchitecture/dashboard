// The ingest image copies the build context whole (deploy/Containerfile.ingest), so nothing git
// ignores may be in it: a developer's local tool settings, a plan, the prototype, an .env file. Every
// pattern of .gitignore has its counterpart in .containerignore.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = resolve(import.meta.dirname, "../../..")
const patterns = (file: string) =>
  readFileSync(resolve(ROOT, file), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
// `node_modules/`, `**/node_modules` and `node_modules` name the same thing to both tools.
const bare = (pattern: string) => pattern.replace(/^\*\*\//, "").replace(/\/$/, "")

describe("the image's build context", () => {
  it("leaves out everything git ignores", () => {
    const left = new Set(patterns(".containerignore").map(bare))
    const missing = patterns(".gitignore").filter((pattern) => !left.has(bare(pattern)))
    expect(missing).toEqual([])
  })
})
