// The images' install check (deploy/check-native.mjs): pnpm skips an optional dependency it cannot
// fetch without failing, so an install can lack the native binding for the platform it runs on and
// fail later, or at run time. Every package the lockfile constrains to a platform this one matches
// must be installed; packages for other platforms are not looked for.

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

const SCRIPT = resolve(import.meta.dirname, "../../../deploy/check-native.mjs")
const ROOT = resolve(import.meta.dirname, "../../..")
const { platform, arch } = process
const other = platform === "linux" ? "darwin" : "linux"

function workspace(lock: string, installed: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), "cwa-native-"))
  writeFileSync(join(root, "pnpm-lock.yaml"), lock)
  for (const dir of installed) mkdirSync(join(root, "node_modules/.pnpm", dir), { recursive: true })
  return root
}
const check = (root: string) =>
  spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" })

const LOCK = `lockfileVersion: '9.0'

importers:

  .: {}

packages:

  '@x/binding-here@1.0.0':
    resolution: {integrity: sha512-a}
    cpu: [${arch}]
    os: [${platform}]

  '@x/binding-elsewhere@1.0.0':
    resolution: {integrity: sha512-b}
    cpu: [${arch}]
    os: [${other}]

  '@x/binding-not-here@1.0.0':
    resolution: {integrity: sha512-c}
    os: ['!${platform}']

  plain@2.0.0:
    resolution: {integrity: sha512-d}

snapshots:

  plain@2.0.0: {}
`

describe("the native binding check", () => {
  it("passes when this platform's packages are installed, whatever is missing for others", () => {
    const run = check(workspace(LOCK, ["@x+binding-here@1.0.0", "plain@2.0.0"]))
    expect(run.stdout).toContain(`1 platform package for ${platform} ${arch}`)
    expect(run.status).toBe(0)
  })

  it("fails, naming it, when this platform's package was not installed", () => {
    const run = check(workspace(LOCK, ["plain@2.0.0"]))
    expect(run.stderr).toContain("@x/binding-here@1.0.0")
    expect(run.stderr).not.toContain("binding-elsewhere")
    expect(run.stderr).not.toContain("binding-not-here")
    expect(run.status).toBe(1)
  })

  it("leaves out pnpm's own lock, a document of its own installed elsewhere", () => {
    const manager = `lockfileVersion: '9.0'

importers:

  .:
    configDependencies: {}
    packageManagerDependencies:
      pnpm:
        specifier: 12.3.4
        version: 12.3.4

packages:

  '@pnpm/exe.here@12.3.4':
    resolution: {integrity: sha512-e}
    cpu: [${arch}]
    os: [${platform}]

snapshots:

  pnpm@12.3.4: {}

---
`
    const run = check(workspace(manager + LOCK, ["@x+binding-here@1.0.0"]))
    expect(run.stderr).toBe("")
    expect(run.status).toBe(0)
  })

  it("looks for a package whose negated list admits this platform", () => {
    const lock = LOCK.replace(
      "  plain@2.0.0:",
      `  '@x/binding-anywhere-but@1.0.0':
    resolution: {integrity: sha512-f}
    os: ['!${other}']

  plain@2.0.0:`,
    )
    const run = check(workspace(lock, ["@x+binding-here@1.0.0"]))
    expect(run.stderr).toContain("@x/binding-anywhere-but@1.0.0")
    expect(run.status).toBe(1)
  })

  it("finds a package installed with its peers' suffix", () => {
    const run = check(workspace(LOCK, ["@x+binding-here@1.0.0_react@19.3.0"]))
    expect(run.status).toBe(0)
  })

  it("cannot run without a lockfile", () => {
    expect(check(mkdtempSync(join(tmpdir(), "cwa-native-"))).status).toBe(2)
  })

  it("holds for this repository's own install", () => {
    const run = check(ROOT)
    expect(run.stderr).toBe("")
    expect(run.status).toBe(0)
  })
})
