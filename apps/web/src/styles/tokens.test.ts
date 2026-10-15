import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { contrast, hexToSrgb8, oklchToSrgb8 } from "../test/color"

const web = resolve(import.meta.dirname, "../..")
const style = readFileSync(resolve(web, "../../STYLE.md"), "utf8")
const tokensCss = readFileSync(resolve(web, "src/styles/tokens.css"), "utf8")
const globalsCss = readFileSync(resolve(web, "src/styles/globals.css"), "utf8")
const mainTsx = readFileSync(resolve(web, "src/main.tsx"), "utf8")

// --- STYLE.md, read as the source of truth ------------------------------------------------------

function section(heading: string): string {
  const start = style.indexOf(heading)
  if (start < 0) throw new Error(`STYLE.md has no "${heading}"`)
  const next = style.slice(start + heading.length).search(/\n#{2,3} /)
  return next < 0 ? style.slice(start) : style.slice(start, start + heading.length + next)
}

function tableRows(markdown: string): string[][] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/^`|`$/g, "")),
    )
}

const tokensSection = section("## 2. Tokens")
const verbatimBlock =
  /The block that `tokens\.css` carries, verbatim:\n\n```css\n([\s\S]*?)```/.exec(
    tokensSection,
  )?.[1]
const colourRows = tableRows(tokensSection.slice(0, tokensSection.indexOf("Non-colour tokens")))
const ownRows = tableRows(section("### The dashboard's own tokens"))

// --- tokens.css, read as declarations per selector ----------------------------------------------

// Every block with exactly this selector, merged in order, as the cascade would.
function declarations(css: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const blocks = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"))]
  if (blocks.length === 0) throw new Error(`no ${selector} block`)
  return new Map(
    blocks.flatMap((block) =>
      [...block[1]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
        (m) => [m[1]!, m[2]!.trim()] as const,
      ),
    ),
  )
}

const light = declarations(verbatimBlock ?? "", ":root")
const dark = declarations(verbatimBlock ?? "", 'html[data-theme="dark"]')

describe("tokens.css carries the website's tokens", () => {
  it("holds STYLE.md 2's block verbatim", () => {
    expect(verbatimBlock).toBeDefined()
    expect(tokensCss).toContain(verbatimBlock)
  })

  it("agrees with STYLE.md 2's table, in both themes", () => {
    expect(colourRows).toHaveLength(11)
    for (const [token, , lightValue, , darkValue] of colourRows) {
      expect(light.get(token!), token).toBe(lightValue)
      expect(dark.get(token!), token).toBe(darkValue)
    }
  })

  it("gives each colour the hex STYLE.md 2 lists as its sRGB conversion", () => {
    for (const [token, , lightValue, lightHex, darkValue, darkHex] of colourRows) {
      for (const [value, hex] of [
        [lightValue!, lightHex!],
        [darkValue!, darkHex!],
      ] as const) {
        const converted = oklchToSrgb8(value)
        const listed = hexToSrgb8(hex)
        for (const channel of ["r", "g", "b"] as const) {
          expect(
            Math.abs(converted[channel] - listed[channel]),
            `${token} ${value} ${hex}`,
          ).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  // STYLE.md 2: every colour used as text, at 4.5:1 against --bg and --surface in both themes.
  // Text is --fg, --muted, --accent and the plane colours (slot badges); the loudest chip sets
  // --bg text on an --accent fill.
  it("keeps every text colour at 4.5:1 or more in both themes", () => {
    const text = ["--fg", "--muted", "--accent", "--p-gov", "--p-state", "--p-evid", "--p-inter"]
    for (const [theme, tokens] of [
      ["light", light],
      ["dark", new Map([...light, ...dark])],
    ] as const) {
      for (const foreground of text) {
        for (const background of ["--bg", "--surface"]) {
          const ratio = contrast(tokens.get(foreground)!, tokens.get(background)!)
          expect(ratio, `${theme}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
        }
      }
      const loud = contrast(tokens.get("--bg")!, tokens.get("--accent")!)
      expect(loud, `${theme}: --bg on --accent`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("declares the dashboard's own tokens as STYLE.md 2 lists them", () => {
    const own = declarations(tokensCss, ":root")
    expect(ownRows).toHaveLength(13)
    for (const [token, value] of ownRows) expect(own.get(token!), token).toBe(value)
  })
})

describe("tokens.css sets shadcn's tokens from the website's", () => {
  // STYLE.md 9, One token stylesheet.
  const mapping: Record<string, string> = {
    "--background": "var(--bg)",
    "--card": "var(--bg)",
    "--popover": "var(--bg)",
    "--muted": "var(--surface)",
    "--secondary": "var(--surface)",
    "--sidebar": "var(--surface)",
    "--foreground": "var(--fg)",
    "--card-foreground": "var(--fg)",
    "--muted-foreground": "var(--muted)",
    "--border": "var(--line)",
    "--input": "var(--line)",
    "--primary": "var(--accent)",
    "--ring": "var(--accent)",
    "--accent": "var(--accent-soft)",
    "--chart-1": "var(--p-gov)",
    "--chart-2": "var(--p-state)",
    "--chart-3": "var(--p-evid)",
    "--chart-4": "var(--p-inter)",
    "--radius": "0",
  }

  it("maps them in html:root and again in html[data-theme=dark]", () => {
    for (const selector of ["html:root", 'html[data-theme="dark"]']) {
      const set = declarations(tokensCss, selector)
      for (const [token, value] of Object.entries(mapping)) {
        expect(set.get(token), `${selector} ${token}`).toBe(value)
      }
    }
  })

  it("drives Tailwind's dark variant from the same attribute", () => {
    expect(globalsCss).toContain(
      "@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));",
    )
    expect(globalsCss).not.toContain("@custom-variant dark (&:is(.dark *));")
  })

  it("is loaded after the generated stylesheet, so it wins", () => {
    const globals = mainTsx.indexOf('import "./styles/globals.css"')
    const tokens = mainTsx.indexOf('import "./styles/tokens.css"')
    expect(globals).toBeGreaterThanOrEqual(0)
    expect(tokens).toBeGreaterThan(globals)
  })
})

// STYLE.md 3 and 9: no literal colour and no palette class outside tokens.css. The generated
// stylesheet and primitives are kept as generated and restyled through tokens.css.
describe("src/ names no colour of its own", () => {
  const src = resolve(web, "src")
  const exempt = new Set(["styles/tokens.css", "styles/globals.css", "test/color.ts"])
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === "ui" ? [] : files(path)
      return /\.(ts|tsx|css)$/.test(name) && !name.endsWith(".test.ts") ? [path] : []
    })
  const PALETTE =
    "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose"
  const forbidden = [
    /#[0-9a-f]{3,8}\b/i,
    /\b(?:oklch|oklab|rgba?|hsla?|lab|lch|hwb)\(/i,
    new RegExp(
      `\\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|shadow|accent|caret)-(?:${PALETTE})-\\d{2,3}\\b`,
    ),
    /\b(?:bg|text|border|fill|stroke)-(?:white|black)\b/,
  ]

  it("finds the files it checks", () => {
    expect(files(src).map((path) => relative(src, path))).toContain("main.tsx")
  })

  it("has no colour literal or palette class", () => {
    for (const path of files(src)) {
      const name = relative(src, path)
      if (exempt.has(name)) continue
      const text = readFileSync(path, "utf8")
      for (const pattern of forbidden) expect(text.match(pattern), `${name}: ${pattern}`).toBeNull()
    }
  })
})
