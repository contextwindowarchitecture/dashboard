import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import {
  CONTRACT_SOURCE,
  MODEL,
  REASONS,
  REQUIREMENTS,
  SCOPE,
  SLOT_DEFAULTS,
} from "../generated/data.ts"
import { IMPLEMENTATIONS } from "../generated/implementations.ts"
import { REGISTRY } from "../generated/registry.ts"
import {
  validateConflictGroup,
  validateConformanceReport,
  validateContextItem,
  validateProducerBatch,
  validateProfile,
  validateRegistryLock,
  validateRoutePolicy,
  validateSnapshot,
  validateTrace,
} from "../generated/validators.js"

const packageRoot = resolve(import.meta.dirname, "..")
const vendor = join(packageRoot, "vendor/cwa")
const read = (path: string): unknown => JSON.parse(readFileSync(join(vendor, path), "utf8"))
const dirs = (path: string) => readdirSync(join(vendor, path)).sort()

type Validator = ((data: unknown) => boolean) & { errors?: unknown }

function expectValid(validate: Validator, data: unknown, where: string) {
  const ok = validate(data)
  expect(ok ? null : { where, errors: validate.errors }).toBeNull()
}

describe("the generated validators", () => {
  it("accept every conformance case's snapshot and expected trace", () => {
    const cases = dirs("conformance/cases")
    expect(cases).toHaveLength(65)
    for (const id of cases) {
      expectValid(validateSnapshot, read(`conformance/cases/${id}/snapshot.json`), id)
      expectValid(validateTrace, read(`conformance/cases/${id}/expected.trace.json`), id)
    }
  })

  // Each rejection breaks exactly one Snapshot check, and the snapshot schema is one of them
  // (conformance/README.md; check.py's snapshot_checks). These four break the schema. The other 21
  // break a check only an assembler makes, which the dashboard never reimplements: the replay
  // service rejects them through the real assembler.
  const SCHEMA_REJECTIONS = [
    "batch-entry-not-object",
    "producer-reason-unknown",
    "schema-missing-budget",
    "schema-profile-spec",
  ]

  it("reject the snapshots of the rejections that break the schema, and only those", () => {
    const rejections = dirs("conformance/rejections")
    expect(rejections).toHaveLength(25)
    const rejected = rejections.filter(
      (id) => !validateSnapshot(read(`conformance/rejections/${id}/snapshot.json`)),
    )
    expect(rejected).toEqual(SCHEMA_REJECTIONS)
  })

  it("report every error, not only the first", () => {
    const snapshot = read("conformance/cases/fixture-three-slot/snapshot.json") as Record<
      string,
      unknown
    >
    const { budget: _budget, tokenizer: _tokenizer, ...broken } = snapshot
    expect(validateSnapshot(broken)).toBe(false)
    const missing = (validateSnapshot.errors ?? []).map((error) => error.params["missingProperty"])
    expect(missing).toEqual(expect.arrayContaining(["budget", "tokenizer"]))
  })

  it("assert date-time formats, not only their pattern", () => {
    const snapshot = read("conformance/cases/fixture-three-slot/snapshot.json") as Record<
      string,
      unknown
    >
    expect(validateSnapshot({ ...snapshot, assembly_time: "2026-02-30T00:00:00Z" })).toBe(false)
  })

  it("accept the examples, the registry and the implementations' reports", () => {
    expectValid(validateSnapshot, read("examples/messages-snapshot.json"), "messages-snapshot")
    expectValid(validateTrace, read("examples/trace.json"), "trace")
    expectValid(validateTrace, read("examples/messages-trace.json"), "messages-trace")
    expectValid(validateContextItem, read("examples/context-item.json"), "context-item")
    expectValid(validateProducerBatch, read("examples/producer-batch.json"), "producer-batch")
    expectValid(validateProfile, read("examples/fixture-profile.json"), "fixture-profile")
    for (const group of read("examples/conflict-groups.json") as unknown[]) {
      expectValid(validateConflictGroup, group, "conflict-groups")
    }
    for (const profile of REGISTRY.profiles) expectValid(validateProfile, profile, profile.id)
    for (const policy of REGISTRY.route_policies) {
      expectValid(validateRoutePolicy, policy, policy.route)
    }
    expectValid(validateRegistryLock, REGISTRY.lock, "registry lock")
    for (const implementation of IMPLEMENTATIONS) {
      expectValid(validateConformanceReport, implementation.report, implementation.id)
    }
  })
})

describe("the generated contract data", () => {
  it("names the commit the lock pins", () => {
    const lock = JSON.parse(readFileSync(join(packageRoot, "vendor/cwa.lock.json"), "utf8"))
    expect(CONTRACT_SOURCE).toEqual({
      repository: lock.repository,
      commit: lock.spec_commit,
      dirty: lock.dirty,
    })
  })

  it("holds the 35 reason codes in the order R-21 ranks them", () => {
    expect(REASONS.map((reason) => reason.code)).toEqual(
      (read("contract/reasons.json") as { code: string }[]).map((reason) => reason.code),
    )
    expect(REASONS).toHaveLength(35)
    expect(REASONS.filter((reason) => reason.kind === "exclusion")).toHaveLength(29)
    expect(REASONS.filter((reason) => reason.kind === "refusal")).toHaveLength(6)
  })

  it("holds the 26 requirements, each with the scope that owns it", () => {
    expect(REQUIREMENTS.map((requirement) => requirement.id)).toEqual(
      Array.from({ length: 26 }, (_, i) => `R-${i + 1}`),
    )
    expect(SCOPE.map((entry) => entry.id)).toEqual(
      REQUIREMENTS.map((requirement) => requirement.id),
    )
  })

  it("maps the eleven slots onto the four planes", () => {
    expect(MODEL.planes.map((plane) => plane.id)).toEqual([
      "governance",
      "state",
      "evidence",
      "interaction",
    ])
    expect(MODEL.slots).toHaveLength(11)
    expect(Object.keys(SLOT_DEFAULTS).sort()).toEqual(MODEL.slots.map((slot) => slot.id).sort())
    for (const slot of MODEL.slots) {
      // A slot's id begins with its plane's, and its default names the plane by a short form.
      const plane = slot.id.split(".")[0] ?? ""
      expect(MODEL.planes.map((p) => p.id)).toContain(plane)
      expect(plane.startsWith(SLOT_DEFAULTS[slot.id].plane)).toBe(true)
    }
  })

  it("holds the registry and the four implementations' reports", () => {
    expect(REGISTRY.profiles.map((profile) => profile.id)).toHaveLength(7)
    expect(IMPLEMENTATIONS.map((implementation) => implementation.id)).toEqual([
      "python",
      "typescript",
      "go",
      "rust",
    ])
  })
})

describe("generate --check", () => {
  const script = join(packageRoot, "scripts/generate.mjs")
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], { encoding: "utf8", cwd: packageRoot })

  it("passes when the generated files match the vendored contract", () => {
    const result = run("--check")
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
  })

  it("fails, naming the file, when a generated file is edited by hand", () => {
    const path = join(packageRoot, "generated/data.ts")
    const original = readFileSync(path)
    writeFileSync(path, `${original.toString()}// edited\n`)
    try {
      const result = run("--check")
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("generated/data.ts")
    } finally {
      writeFileSync(path, original)
    }
  })
})
