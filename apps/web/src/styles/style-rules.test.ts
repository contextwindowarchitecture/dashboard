import { describe, expect, it } from "vitest"

import { sourceFiles } from "../test/source-files"

// STYLE.md 7 and 9: hairlines and squares, hover is instant. Outside the generated stylesheet and
// primitives, nothing declares a shadow, a radius other than the pill, a gradient, a transition or
// an animation. Section 7's allowances (the site's cwaRise, the three choreographies) are added
// here by name when they land.
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

  it("has no shadow, radius, gradient, transition or animation", () => {
    expect(files.length).toBeGreaterThan(0)
    for (const { name, text } of files) {
      const rules = name.endsWith(".css") ? declarations : classes
      for (const [what, pattern] of rules) {
        expect(text.match(pattern)?.[0], `${name} has ${what}`).toBeUndefined()
      }
    }
  })
})
