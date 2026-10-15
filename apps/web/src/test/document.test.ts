import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

const root = resolve(import.meta.dirname, "../..")
const indexHtml = readFileSync(resolve(root, "index.html"), "utf8")
const themeScript = readFileSync(resolve(root, "public/theme.js"), "utf8")

// The deployed Content Security Policy is `script-src 'self'` with no inline script and no eval
// (AGENTS.md, "Never loosen the Content Security Policy").
describe("index.html", () => {
  const doc = new DOMParser().parseFromString(indexHtml, "text/html")
  const scripts = [...doc.querySelectorAll("script")]

  it("loads every script from a file, with none inline", () => {
    expect(scripts.length).toBeGreaterThan(0)
    for (const script of scripts) {
      expect(script.getAttribute("src")).toMatch(/^\//)
      expect(script.textContent?.trim()).toBe("")
    }
    expect(doc.querySelectorAll("[style]")).toHaveLength(0)
    expect(indexHtml).not.toMatch(/\son[a-z]+=/i)
  })

  it("applies the theme in the head, before the app's module", () => {
    expect(doc.head.querySelector('script[src="/theme.js"]')).not.toBeNull()
    const module = doc.querySelector('script[type="module"]')
    expect(module?.getAttribute("src")).toBe("/src/main.tsx")
    expect(doc.head.contains(module)).toBe(false)
  })
})

// STYLE.md 3, Dark mode: `cwa-theme` in localStorage, the website's key; light by default;
// prefers-color-scheme is not consulted.
describe("public/theme.js", () => {
  const run = () => {
    document.documentElement.removeAttribute("data-theme")
    // The script is a plain file the browser runs before the first paint; the test runs its text.
    new Function(themeScript)()
    return document.documentElement.getAttribute("data-theme")
  }

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it("applies the stored theme", () => {
    localStorage.setItem("cwa-theme", "dark")
    expect(run()).toBe("dark")
    localStorage.setItem("cwa-theme", "light")
    expect(run()).toBe("light")
  })

  it("defaults to light when nothing, or something else, is stored", () => {
    expect(run()).toBe("light")
    localStorage.setItem("cwa-theme", "blue")
    expect(run()).toBe("light")
  })

  it("defaults to light when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError")
    })
    expect(run()).toBe("light")
  })
})
