import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { BUILT_ASSEMBLER, BUILT_CONTRACT_FILES } from "../index.js"

const built = resolve(import.meta.dirname, "../.build/assembler-typescript")
const pin = JSON.parse(readFileSync(resolve(import.meta.dirname, "../pin.json"), "utf8"))

// What an assembly event says about the assembler that produced it, read from the build itself.
describe("BUILT_ASSEMBLER", () => {
  it("names the built package, its pin and the contract its lock pins", () => {
    const manifest = JSON.parse(readFileSync(join(built, "package.json"), "utf8"))
    const lockBytes = readFileSync(join(built, "vendor/cwa.lock.json"))
    const lock = JSON.parse(lockBytes.toString("utf8"))
    expect(BUILT_ASSEMBLER).toEqual({
      language: "typescript",
      name: manifest.name,
      version: manifest.version,
      tag: pin.tag,
      commit: pin.commit,
      contract: {
        repository: lock.repository,
        commit: lock.spec_commit,
        lock_sha256: createHash("sha256").update(lockBytes).digest("hex"),
      },
    })
    expect(BUILT_ASSEMBLER.name).toBe("@contextwindowarchitecture/assembler")
  })
})

describe("BUILT_CONTRACT_FILES", () => {
  it("is every file the assembler's lock pins, with its SHA-256, and cannot be changed", () => {
    const lock = JSON.parse(readFileSync(join(built, "vendor/cwa.lock.json"), "utf8"))
    expect(BUILT_CONTRACT_FILES).toEqual(lock.files)
    expect(Object.isFrozen(BUILT_CONTRACT_FILES)).toBe(true)
  })
})
