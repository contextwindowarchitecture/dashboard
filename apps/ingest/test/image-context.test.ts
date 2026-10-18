// The images' build. The ingest image copies the build context whole (deploy/Containerfile.ingest),
// so nothing git ignores may be in it: a developer's local tool settings, a plan, the prototype, an
// .env file; every pattern of .gitignore has its counterpart in .containerignore. Every base image is
// named by digest, so a build is the same build tomorrow, and every install is checked for the
// platform's native bindings, which pnpm skips without failing when a download times out.

import { readdirSync, readFileSync } from "node:fs"
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

const CONTAINERFILES = readdirSync(resolve(ROOT, "deploy"))
  .filter((name) => name.startsWith("Containerfile"))
  .map((name) => ({ name, text: readFileSync(resolve(ROOT, "deploy", name), "utf8") }))

describe("the images' build", () => {
  it("names every base image by digest", () => {
    expect(CONTAINERFILES.length).toBeGreaterThanOrEqual(2)
    const from = CONTAINERFILES.flatMap(({ name, text }) =>
      [...text.matchAll(/^FROM (\S+)/gm)].map((m) => ({ name, image: m[1]! })),
    )
    expect(from.filter(({ image }) => !/@sha256:[0-9a-f]{64}$/.test(image))).toEqual([])
  })

  it("checks every install for this platform's native bindings", () => {
    for (const { name, text } of CONTAINERFILES) {
      const installs = text.match(/pnpm install --frozen-lockfile[^\n]*/g) ?? []
      expect(installs.length, name).toBeGreaterThan(0)
      for (const install of installs) {
        expect(install, name).toMatch(/&& node deploy\/check-native\.mjs$/)
      }
    }
  })
})
