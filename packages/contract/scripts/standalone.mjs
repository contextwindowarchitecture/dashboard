// Standalone Ajv validators as one ES module, for every package that generates validators from JSON
// Schemas: the contract's (scripts/generate.mjs) and the telemetry envelope's, whose schemas refer to
// the contract's. Validators are compiled at build time so that no browser compiles a schema: the
// dashboard's Content Security Policy forbids eval, and Ajv's runtime compiler needs it.

import Ajv2020 from "ajv/dist/2020.js"
import standaloneCode from "ajv/dist/standalone/index.js"
import addFormats from "ajv-formats"

const FORMATS = 'import { fullFormats } from "ajv-formats/dist/formats.js"'

// The standalone code reaches its runtime helpers through require(), which an ES module cannot:
// ajv-formats' format table and Ajv's own helpers under ajv/dist/runtime/ (ucs2length, equal).
// Each becomes an ES import; any other require() left in the output fails the generation rather
// than the bundle. The runtime helpers are CommonJS with the function on exports.default: Node's
// default import is the exports object and the bundler's is the function, so each import is read
// as `.default ?? itself`.
function esmImports(code) {
  const imports = []
  code = code.replace(/require\("ajv-formats\/dist\/formats"\)\.fullFormats/g, () => {
    if (!imports.includes(FORMATS)) imports.unshift(FORMATS)
    return "fullFormats"
  })
  code = code.replace(/require\("ajv\/dist\/runtime\/([a-z0-9]+)"\)\.default/g, (_, helper) => {
    const line = `import ${helper}Module from "ajv/dist/runtime/${helper}.js"\nconst ${helper} = ${helper}Module.default ?? ${helper}Module`
    if (!imports.includes(line)) imports.push(line)
    return helper
  })
  return { code, imports }
}

/**
 * The module source of standalone validators: `schemas` are every schema the validators may refer
 * to, `names` maps each exported validator's name to the $id it validates against. The source has
 * no banner; the caller adds its own.
 */
export function standaloneValidators(schemas, names) {
  // The options the assemblers validate with: every error, strict mode, formats asserted. Strict
  // types and strict required are off because the published schemas use `properties` and
  // `required` inside `if` without restating `type`.
  const ajv = new Ajv2020({
    code: { source: true, esm: true, optimize: 2 },
    allErrors: true,
    strict: true,
    strictTypes: false,
    strictRequired: false,
  })
  addFormats(ajv)
  for (const schema of schemas) ajv.addSchema(schema)

  const { code: rewritten, imports } = esmImports(standaloneCode(ajv, names))
  const leftover = rewritten.match(/require\([^)]*\)/g)
  if (leftover) {
    throw new Error(
      `the standalone code still requires ${[...new Set(leftover)].join(", ")}; teach standalone.mjs about it`,
    )
  }
  return `${imports.join("\n")}\n${rewritten.replace(/^"use strict";?/, "")}\n`
}
