import { describe, expect, it } from "vitest"

import { sourceFiles } from "../test/source-files"

// STYLE.md 7 and 9: hairlines and squares, hover is instant. Outside the generated stylesheet and
// primitives, nothing declares a shadow, a radius other than the pill, a gradient, a transition or
// an animation. Section 7's allowances (the site's cwaRise, the three choreographies) are added
// here by name when they land. In TypeScript, classes are read where they are written, in className
// values and cn() and cva() arguments, so a word like a route's name is not taken for a utility.
const CLASS_SITE = /className=|\b(?:cn|cva)\(/g
const CLOSE: Record<string, string> = { "(": ")", "{": "}", '"': '"' }

function classText(text: string): string {
  const found: string[] = []
  for (const site of text.matchAll(CLASS_SITE)) {
    let at = site.index + site[0].length
    const open = site[0].endsWith("(") ? "(" : text[at]!
    if (!site[0].endsWith("(")) at += 1
    if (!(open in CLOSE)) continue
    let depth = 1
    let end = at
    for (; end < text.length && depth > 0; end += 1) {
      const char = text[end]!
      if (open !== '"' && char === open) depth += 1
      else if (char === CLOSE[open]) depth -= 1
    }
    found.push(text.slice(at, end - 1))
  }
  return found.join("\n")
}

describe("the app's own source keeps STYLE.md's shapes and stillness", () => {
  const files = sourceFiles().filter((file) => file.name !== "styles/globals.css")

  const classes: [string, RegExp][] = [
    ["a shadow utility", /\b(?:shadow|drop-shadow)(?:-[\w[\]/.-]+)?\b(?![-\w])/],
    ["a radius other than the pill", /\brounded(?:-(?!full\b)[\w[\]/.-]+)?\b(?![-\w])/],
    ["a gradient", /\bbg-(?:gradient|linear|radial|conic)-/],
    ["a transition utility", /\btransition(?:-[\w]+)?\b(?![-\w])/],
    ["an animation utility", /\banimate-[\w[\]-]+/],
  ]
  const declarations: [string, RegExp][] = [
    ["a box-shadow", /\bbox-shadow\s*:/],
    ["a border-radius", /\bborder-radius\s*:(?!\s*(?:var\(--pill\)|0\b))/],
    ["a gradient", /\b(?:linear|radial|conic)-gradient\(/],
    ["a transition", /\btransition(?:-[\w]+)?\s*:/],
    ["an animation", /\banimation(?:-[\w]+)?\s*:|@keyframes\b/],
  ]

  it("reads classes where they are written, and only there", () => {
    const tsx = `const to = "/shadow"
      <div className="flex shadow-sm" />
      <p className={cn("gap-2", open && "rounded-md")} />
      const v = cva("px-2", { variants: { a: { b: "animate-spin" } } })`
    const read = classText(tsx)
    expect(read).toContain("shadow-sm")
    expect(read).toContain("rounded-md")
    expect(read).toContain("animate-spin")
    expect(read).not.toContain("/shadow")
  })

  it("has no shadow, radius, gradient, transition or animation", () => {
    expect(files.length).toBeGreaterThan(0)
    for (const { name, text } of files) {
      const rules = name.endsWith(".css") ? declarations : classes
      const scanned = name.endsWith(".css") ? text : classText(text)
      for (const [what, pattern] of rules) {
        expect(scanned.match(pattern)?.[0], `${name} has ${what}`).toBeUndefined()
      }
    }
  })
})
