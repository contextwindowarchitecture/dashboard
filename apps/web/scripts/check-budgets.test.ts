import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { randomBytes } from "node:crypto"

import { afterEach, describe, expect, it } from "vitest"

const script = resolve(import.meta.dirname, "check-budgets.mjs")
const BUDGETS = {
  initialJsKb: 1,
  initialCssKb: 1,
  lazyChunkKb: 1,
  workerKb: 2,
  keptOut: { GSAP: "GreenSock" },
}
const dirs: string[] = []

// A dist/ tree: index.html loading the entry and its stylesheet, and the other files as given.
function dist(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "cwa-budgets-"))
  dirs.push(dir)
  mkdirSync(join(dir, "dist/assets"), { recursive: true })
  writeFileSync(join(dir, "budgets.json"), JSON.stringify(BUDGETS))
  writeFileSync(
    join(dir, "dist/index.html"),
    '<script src="/theme.js"></script><script type="module" src="/assets/index-a.js"></script>' +
      '<link rel="modulepreload" href="/assets/vendor-b.js"><link rel="stylesheet" href="/assets/index-c.css">',
  )
  const defaults = {
    "theme.js": "x",
    "assets/index-a.js": "x",
    "assets/vendor-b.js": "x",
    "assets/index-c.css": "x",
  }
  for (const [path, text] of Object.entries({ ...defaults, ...files })) {
    writeFileSync(join(dir, "dist", path), text)
  }
  return dir
}

// Bytes that gzip barely compresses, so a size in the test is a size after gzip.
const incompressible = (kb: number) => randomBytes(kb * 1024).toString("latin1")

const run = (root: string) =>
  spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" })

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("check-budgets", () => {
  it("passes a build within its budgets, reporting each class", () => {
    const result = run(dist({ "assets/route-d.js": "lazy" }))
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/initial JS .* of 1 kB/)
    expect(result.stdout).toMatch(/initial CSS .* of 1 kB/)
    expect(result.stdout).toMatch(/largest lazy chunk .* of 1 kB/)
  })

  it("counts index.html's scripts, preloads and stylesheets as initial, together", () => {
    const result = run(
      dist({ "assets/index-a.js": incompressible(0.6), "assets/vendor-b.js": incompressible(0.6) }),
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("initial JS")
  })

  it("holds every other chunk to the lazy budget, naming it", () => {
    const result = run(dist({ "assets/sandbox-e.js": incompressible(1.5) }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("assets/sandbox-e.js")
  })

  it("holds a worker to the worker budget, not the lazy one", () => {
    expect(run(dist({ "assets/events.worker-f.js": incompressible(1.5) })).status).toBe(0)
    const over = run(dist({ "assets/events.worker-f.js": incompressible(2.5) }))
    expect(over.status).toBe(1)
    expect(over.stderr).toContain("assets/events.worker-f.js")
  })

  it("fails on eval or new Function in any chunk, which the policy would refuse", () => {
    for (const code of ["const f = new Function('return 1')", "eval('1')"]) {
      const result = run(dist({ "assets/route-d.js": code }))
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("assets/route-d.js")
    }
  })

  it("fails when a library kept out of the initial load is in it, and not when a lazy chunk has it", () => {
    expect(run(dist({ "assets/motion-g.js": "/* GreenSock */" })).status).toBe(0)
    const result = run(dist({ "assets/vendor-b.js": "/* GreenSock */" }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("GSAP")
    expect(result.stderr).toContain("assets/vendor-b.js")
  })

  it("fails when there is no build to check", () => {
    const dir = mkdtempSync(join(tmpdir(), "cwa-budgets-"))
    dirs.push(dir)
    writeFileSync(join(dir, "budgets.json"), JSON.stringify(BUDGETS))
    const result = run(dir)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("pnpm build")
  })
})
