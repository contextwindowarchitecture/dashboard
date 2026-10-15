import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

// docs/otel-semantic-conventions.md maps span attributes one to one onto assembly-event fields, so
// the four wrappers and the collector exporter have one target. This test reads its table and
// holds it to the event schema in both directions.

const root = resolve(import.meta.dirname, "../../..")
const doc = readFileSync(join(root, "docs/otel-semantic-conventions.md"), "utf8")

type Schema = {
  $ref?: string
  properties?: Record<string, Schema>
  items?: Schema
  anyOf?: Schema[]
  $defs?: Record<string, Schema>
}
const CONTRACT_BASE = "https://contextwindowarchitecture.io/schema/"
const contractDir = join(root, "packages/contract/vendor/cwa/schema")
const contract = new Map(
  readdirSync(contractDir).map((file) => [
    file,
    JSON.parse(readFileSync(join(contractDir, file), "utf8")) as Schema,
  ]),
)
const event = JSON.parse(
  readFileSync(join(root, "packages/telemetry/schemas/assembly-event.v1.schema.json"), "utf8"),
) as Schema

// Follows $refs within a schema and into the contract's.
function deref(schema: Schema, base: Schema): [Schema, Schema] {
  let node = schema
  let doc = base
  while (node.$ref) {
    const [file, pointer = ""] = node.$ref.startsWith(CONTRACT_BASE)
      ? node.$ref.slice(CONTRACT_BASE.length).split("#")
      : node.$ref.startsWith("#")
        ? ["", node.$ref.slice(1)]
        : node.$ref.split("#")
    if (file) doc = contract.get(file)!
    node = pointer
      .split("/")
      .filter(Boolean)
      .reduce<Schema>((at, key) => (at as Record<string, Schema>)[key]!, doc)
  }
  return [node, doc]
}

// A field path in the table: dots between properties, [] for an array's items.
function resolves(path: string): boolean {
  let [node, base] = [event, event]
  for (const part of path.split(".")) {
    const [name, ...brackets] = part.split("[]")
    ;[node, base] = deref(node, base)
    // A nullable member (trace.result) declares its properties in one of its anyOf branches.
    const branch = [node, ...(node.anyOf ?? [])].find((option) => option.properties?.[name!])
    const next = branch?.properties?.[name!]
    if (!next) return false
    node = next
    for (let i = 0; i < brackets.length; i += 1) {
      ;[node, base] = deref(node, base)
      if (!node.items) return false
      node = node.items
    }
  }
  return true
}

// The envelope's own leaves: every field the event adds around the snapshot and the trace.
function envelopeLeaves(schema: Schema, prefix = ""): string[] {
  return Object.entries(schema.properties ?? {}).flatMap(([name, child]) => {
    const path = prefix ? `${prefix}.${name}` : name
    if (["$schema", "snapshot", "trace", "rejection.snapshot"].includes(path)) return []
    if (child.properties) return envelopeLeaves(child, path)
    return [path]
  })
}

const table = (() => {
  const start = doc.indexOf("## Attributes")
  const end = doc.indexOf("\n## ", start + 1)
  const rows = doc
    .slice(start, end < 0 ? undefined : end)
    .split("\n")
    .filter((line) => line.startsWith("| `") || line.startsWith("| ("))
  return rows.map((line) => {
    const [attribute, field, type] = line
      .split("|")
      .slice(1, 4)
      .map((cell) => cell.trim().replace(/^`|`$/g, ""))
    return { attribute: attribute!, field: field!, type: type! }
  })
})()

describe("docs/otel-semantic-conventions.md", () => {
  it("has an attribute table", () => {
    expect(table.length).toBeGreaterThan(20)
  })

  it("names only fields the event has, following the contract's schemas", () => {
    for (const { attribute, field } of table)
      expect(resolves(field), `${attribute} → ${field}`).toBe(true)
  })

  it("maps every envelope field, one attribute each", () => {
    const mapped = table.map((row) => row.field)
    // An array of objects maps through its items' fields: payload.parts as payload.parts[].sha256.
    for (const leaf of envelopeLeaves(event)) {
      const covered = mapped.some((field) => field === leaf || field.startsWith(`${leaf}[].`))
      expect(covered, leaf).toBe(true)
    }
    const attributes = table.map((row) => row.attribute)
    expect(new Set(attributes).size).toBe(attributes.length)
  })

  it("names CWA attributes under gen_ai.cwa., and otherwise only OpenTelemetry's own", () => {
    for (const { attribute } of table) {
      expect(attribute, attribute).toMatch(
        /^(gen_ai\.cwa\.[a-z0-9_.]+|service\.name|service\.instance\.id|deployment\.environment\.name|\(span [a-z ]+\))$/,
      )
    }
  })

  it("types each attribute as OpenTelemetry can carry it", () => {
    for (const { attribute, type } of table) {
      expect(
        [
          "string",
          "int",
          "double",
          "string[]",
          "int[]",
          "timestamp",
          "duration",
          "trace id",
          "span id",
        ],
        attribute,
      ).toContain(type)
    }
  })

  it("names the wrapper setting that switches redaction (R-DASH-2)", () => {
    expect(doc).toMatch(/`routes\.<route>\.redaction_mode`/)
  })
})
